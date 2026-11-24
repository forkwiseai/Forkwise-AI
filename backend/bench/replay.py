"""Replay recorded runs from the server database and score the tool catalog on real data.

Run on the server:  cd backend && python3 -m bench.replay [path/to/forkwise.db]

For every finished run it counts, from the stored messages: steps, prompt tokens the provider reported, which tools
were called and at which step. It then computes exactly what the two-tier catalog changes:
  saved   = steps * (full catalog chars - two-tier chars) / chars_per_token
  at_risk = sum over distinct stubbed tools used of (average prompt tokens + schema tokens * steps left)
at_risk is the worst case, where every first call to a stubbed tool fails its schema check. The real cost is
q * at_risk; the live q per model is in data/toolcatalog.json once the new code has run."""

import json
import sqlite3
import sys

from app import config
from app.agent import specs, toolcatalog

CHARS_PER_TOKEN = 3.6


def runs(connection):
    connection.row_factory = sqlite3.Row
    return connection.execute("SELECT id, chat_id, started_at, ended_at, tokens_in FROM runs WHERE ended_at IS NOT NULL AND ended_at > 0 ORDER BY started_at").fetchall()


def steps_of(connection, run):
    rows = connection.execute("SELECT tool_calls FROM messages WHERE chat_id = ? AND role = 'assistant' AND created_at >= ? AND created_at <= ? ORDER BY created_at, id", (run["chat_id"], run["started_at"], run["ended_at"] + 1)).fetchall()
    result = []
    for row in rows:
        try:
            calls = json.loads(row["tool_calls"] or "[]")
        except ValueError:
            calls = []
        result.append([call.get("function", {}).get("name", "") for call in calls])
    return result


def score(path):
    full = toolcatalog.size(specs.BUILTIN)
    sent, full_specs, stubbed = toolcatalog.build(specs.BUILTIN)
    delta = (full - toolcatalog.size(sent)) / CHARS_PER_TOKEN
    connection = sqlite3.connect(path)
    totals = {"runs": 0, "steps": 0, "saved": 0.0, "at_risk": 0.0, "stub_tools": 0}
    print("%-10s %6s %10s %8s %10s %10s" % ("run", "steps", "prompt/st", "stubbed", "saved", "worst"))
    for run in runs(connection):
        steps = steps_of(connection, run)
        if not steps:
            continue
        n = len(steps)
        average = (run["tokens_in"] or 0) / n
        first_seen = {}
        for index, names in enumerate(steps):
            for name in names:
                if name in stubbed and name not in first_seen:
                    first_seen[name] = index
        saved = n * delta
        risk = sum(average + toolcatalog.size([full_specs[name]]) / CHARS_PER_TOKEN * (n - index) for name, index in first_seen.items())
        totals["runs"] += 1
        totals["steps"] += n
        totals["saved"] += saved
        totals["at_risk"] += risk
        totals["stub_tools"] += len(first_seen)
        print("%-10s %6d %10.0f %8d %10.0f %10.0f" % (str(run["id"])[:10], n, average, len(first_seen), saved, risk))
    if totals["runs"]:
        q_star = totals["saved"] / totals["at_risk"] if totals["at_risk"] else float("inf")
        print("\nruns %d, steps %d, saved %.0f tokens, worst-case cost %.0f, break-even q* = %.2f" % (totals["runs"], totals["steps"], totals["saved"], totals["at_risk"], q_star))
        print("Stubs pay off on this data while fewer than %.0f%% of first calls to stubbed tools fail." % (100 * min(q_star, 1)))
    else:
        print("No finished runs in " + path)
    return totals


if __name__ == "__main__":
    score(sys.argv[1] if len(sys.argv) > 1 else str(config.DB_PATH))
