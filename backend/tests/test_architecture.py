import random
import sqlite3
import types

from app.agent import budget, capability, claims, docscheck, specs, toolcatalog


def grid_area(rects, size):
    covered = 0
    for x in range(size):
        for y in range(size):
            if any(r[0] <= x < r[2] and r[1] <= y < r[3] for r in rects):
                covered += 1
    return covered


def test_union_area_matches_pixel_grid():
    rng = random.Random(3)
    for _ in range(150):
        rects = []
        for _ in range(rng.randint(1, 6)):
            x0, y0 = rng.randint(0, 25), rng.randint(0, 25)
            rects.append((x0, y0, x0 + rng.randint(0, 15), y0 + rng.randint(0, 15)))
        assert docscheck.union_area(rects) == grid_area(rects, 41)


def test_catalog_keeps_core_full_and_shrinks_the_rest():
    sent, full, stubbed = toolcatalog.build(specs.BUILTIN)
    assert len(sent) == len(specs.BUILTIN)
    assert "bash" not in stubbed and "browser" in stubbed
    assert toolcatalog.size(sent) < 0.65 * toolcatalog.size(specs.BUILTIN)
    browser = [item for item in sent if item["function"]["name"] == "browser"][0]
    assert "action*" in browser["function"]["description"]


def test_gate_runs_good_calls_and_explains_bad_ones():
    sent, full, stubbed = toolcatalog.build(specs.BUILTIN)
    run = types.SimpleNamespace(stubbed=stubbed, full_specs=full, model=None)
    assert toolcatalog.gate(run, "bash", {}) is None
    assert toolcatalog.gate(run, "screenshot", {"url": "http://localhost:3000"}) is None
    shown = toolcatalog.gate(run, "screenshot", {})
    assert "Full definition of screenshot" in shown and '"url"' in shown
    wrong = toolcatalog.gate(run, "screenshot", {"link": "x"})
    assert "missing required parameter \"url\"" in wrong


def test_stub_switch_follows_measured_failure_share(tmp_path, monkeypatch):
    monkeypatch.setattr(toolcatalog, "STATS_PATH", tmp_path / "t.json")
    toolcatalog.STATS.clear()
    for _ in range(10):
        toolcatalog.record_first_call("m:good", False)
    for index in range(10):
        toolcatalog.record_first_call("m:bad", index < 6)
    assert toolcatalog.stubs_pay_off("m:good")
    assert not toolcatalog.stubs_pay_off("m:bad")
    assert toolcatalog.stubs_pay_off("m:new")


def test_ceiling_and_calibration():
    assert budget.ceiling(128000) == 108800
    assert budget.ceiling(32000) == 22400
    assert budget.calibrated(300000, 150000, 75000, 1) == 150000
    assert budget.calibrated(300000, 0, 0, 77) == 77
    assert budget.compactions(200, 3000, 8000, 128000, budget.ceiling(128000)) < budget.compactions(200, 3000, 8000, 128000, int(128000 * 0.7))


def test_sprt_bounds_and_decisions():
    assert abs(capability.operating(capability.P_LOW) - capability.ALPHA) < 1e-9
    assert abs(capability.operating(0.851) - capability.ALPHA) < 0.01
    assert capability.verdict_of(0, 2) == "weak"
    assert capability.verdict_of(23, 0) == "capable"
    assert capability.verdict_of(22, 0) == "unknown"


def test_claims_catch_missing_file_and_wrong_slide_count():
    exists = {"deck/talk.pptx"}.__contains__
    text = "I created deck/talk.pptx with 8 slides.\nSee https://example.com/a.pdf"
    assert claims.check(text, exists, {"deck/talk.pptx": 8}) == []
    wrong = claims.check(text, exists, {"deck/talk.pptx": 5})
    assert len(wrong) == 1 and "has 5" in wrong[0]
    missing = claims.check("فایل out/report.pdf را ساختم", exists, {})
    assert len(missing) == 1 and "out/report.pdf" in missing[0]
    assert claims.stated_slides("یک پاورپوینت ۸ اسلایدی") == [8]


def test_replay_scores_a_recorded_run(tmp_path):
    from bench import replay
    path = tmp_path / "f.db"
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE runs (id TEXT, chat_id TEXT, started_at REAL, ended_at REAL, tokens_in INTEGER)")
    db.execute("CREATE TABLE messages (chat_id TEXT, role TEXT, tool_calls TEXT, created_at REAL, id INTEGER)")
    db.execute("INSERT INTO runs VALUES ('r1', 'c1', 1, 10, 40000)")
    calls = ['[{"function": {"name": "bash"}}]', '[{"function": {"name": "screenshot"}}]', '[]', '[]']
    for index, item in enumerate(calls):
        db.execute("INSERT INTO messages VALUES ('c1', 'assistant', ?, ?, ?)", (item, 2 + index, index))
    db.commit()
    totals = replay.score(str(path))
    assert totals["runs"] == 1 and totals["steps"] == 4 and totals["stub_tools"] == 1
    assert totals["saved"] > 0 and totals["at_risk"] > 0


def test_read_only_calls_run_concurrently_in_order(monkeypatch):
    import asyncio
    import json
    import time
    from app.agent import runs, tools

    async def fake_execute(run, call):
        await asyncio.sleep(0.2)
        return call["function"]["name"], {}, tools.result("done " + call["id"])

    monkeypatch.setattr(runs, "execute_call", fake_execute)
    run = types.SimpleNamespace(mode="agent", stubbed=set())
    make = lambda i, name: {"id": str(i), "function": {"name": name, "arguments": json.dumps({"path": "a"})}}
    calls = [make(0, "read_file"), make(1, "grep"), make(2, "glob"), make(3, "read_file"), make(4, "bash"), make(5, "read_file")]
    assert [[c["id"] for c in g] for g in runs.parallel_groups(run, calls)] == [["0", "1", "2", "3"]]
    started = time.time()
    found = asyncio.run(runs.prefetch_parallel(run, calls))
    elapsed = time.time() - started
    assert sorted(found) == ["0", "1", "2", "3"]
    assert elapsed < 0.4  # four 0.2 s calls in about 0.2 s, not 0.8 s
    assert found["2"][2]["text"] == "done 2"
