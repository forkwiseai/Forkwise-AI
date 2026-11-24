"""Numbers behind every architecture change. Run: python3 -m bench.proofs  (from backend/).

Everything here is either counted from the real code (tool definitions) or derived from a stated model, with the
assumption printed next to the result. Nothing is asserted without a computation."""

import random

from app.agent import specs, toolcatalog, budget, capability, llm

CHARS_PER_TOKEN = 3.6  # only used to show tokens; every ratio below is independent of it


def line(text=""):
    print(text)


def tool_catalog():
    line("== 1. Two-tier tool catalog (counted from specs.BUILTIN)")
    full = toolcatalog.size(specs.BUILTIN)
    sent, full_specs, stubbed = toolcatalog.build(specs.BUILTIN)
    two = toolcatalog.size(sent)
    delta = full - two
    line("full schemas per step: %d chars | two-tier: %d chars | saved: %d chars (%.1f%%), ~%d tokens/step"
         % (full, two, delta, 100 * delta / full, delta / CHARS_PER_TOKEN))
    biggest = max(toolcatalog.size([full_specs[name]]) for name in stubbed)
    line("largest stubbed schema s_max = %d chars" % biggest)
    line()
    line("Net saving of a run, in prompt tokens (no cache):")
    line("  S(N,k,q) = N*D  -  k*q*(P + s_max*N)")
    line("  N steps, D tokens saved per step, k distinct stubbed tools used, q = share of their first calls")
    line("  that fail the schema check, P = average prompt size (the extra step), s_max*N = revealed schema")
    line("  carried in history for at most N later steps (upper bound).")
    d = delta / CHARS_PER_TOKEN
    s = biggest / CHARS_PER_TOKEN
    line("  break-even q* = N*D / (k*(P + s*N))")
    line("  %6s %6s %8s %8s" % ("N", "k", "P", "q*"))
    for n, k, p in [(20, 3, 20000), (40, 5, 40000), (80, 6, 60000), (150, 8, 90000)]:
        q_star = n * d / (k * (p + s * n))
        line("  %6d %6d %8d %8.2f%s" % (n, k, p, q_star, "  (q*>=1: wins even if every first call fails)" if q_star >= 1 else ""))
    line("  With cache reads at 0.1x the per-step saving shrinks by 10x, but the freed window is the same:")
    line("  %.0f tokens of context per step stay free for history, which delays compaction (section 2)." % d)
    line("  The tool list is fixed per run, so the cached prefix is never invalidated by schema loading.")
    line("  Changing the list mid-run instead would re-write the whole prefix H at 1.25x instead of 0.1x:")
    line("  +1.15*H per load, e.g. +46,000 token-equivalents per load at H = 40,000.")
    line()


def compaction():
    line("== 2. Compaction threshold and size estimate")
    line("Model: each step adds g tokens, after compression the context holds 30% of the window + 1,500 summary.")
    line("  %8s %8s %10s %10s %8s" % ("window", "g", "old@70%", "new", "fewer"))
    for limit in (32000, 128000, 200000, 1000000):
        for growth in (1500, 3000):
            old = budget.compactions(200, growth, 8000, limit, int(limit * 0.70))
            new = budget.compactions(200, growth, 8000, limit, budget.ceiling(limit))
            gain = "%.2fx" % (old / new) if new else "-"
            line("  %8d %8d %10d %10d %8s" % (limit, growth, old, new, gain))
    line("Each compression is one extra model call over the old history and loses detail, so fewer is better.")
    line()
    line("Estimator bias. Old size = chars/3. If the real tokenizer gives r chars per token, the real fill when")
    line("the old rule fires is 0.70 * 3 / r of the window:")
    for r in (2.0, 2.5, 3.0, 3.5, 4.0):
        real = 0.70 * 3 / r
        note = "OVERFLOWS the window" if real > 1 else ("wastes %.0f%% of the window" % (100 * (1 - real)))
        line("  r=%.1f  fires at real fill %.0f%%  -> %s" % (r, 100 * real, note))
    line("Calibrated rule: size = chars_now * tokens_measured / chars_measured. The only estimated part is the new")
    line("text since the last answer, so the relative error is at most (new chars / all chars) * |r/r_hat - 1|,")
    line("e.g. one 6,000-char step in a 300,000-char context with r off by 50%: 1% error instead of 50%.")
    line()


def ewma_false_alarm(p_fail, turns, runs, weight, limit, seed=7):
    rng = random.Random(seed)
    alarms = 0
    for _ in range(runs):
        h = 0.0
        for _ in range(turns):
            h = h + weight * ((1.0 if rng.random() < p_fail else 0.0) - h)
            if h > limit:
                alarms += 1
                break
    return alarms / runs


def sprt_run(p_good, rng, cap=10000):
    good = bad = 0
    for _ in range(cap):
        if rng.random() < p_good:
            good += 1
        else:
            bad += 1
        decided = capability.verdict_of(good, bad)
        if decided != "unknown":
            return decided, good + bad
    return "unknown", cap


def capability_gate():
    line("== 3. Deciding whether a model is weak at tool calls")
    line("Current failover health: moving average, weight %.1f, demote above %.1f." % (llm.HEALTH_WEIGHT, llm.DEMOTE_ABOVE))
    line("Two failed turns in a row from a clean start: 0.3, then 0.51 > 0.5, so two unlucky turns demote.")
    for p in (0.02, 0.05, 0.10):
        rate = ewma_false_alarm(p, 40, 100000, llm.HEALTH_WEIGHT, llm.DEMOTE_ABOVE)
        line("  good model, fail rate %.0f%%: demoted within a 40-turn run in %.2f%% of runs (Monte Carlo, n=100k)" % (100 * p, 100 * rate))
    line("Sequential test (Wald): H0 p_ok=%.2f vs H1 p_ok=%.2f, alpha=beta=%.2f" % (capability.P_LOW, capability.P_HIGH, capability.ALPHA))
    line("  per good turn LLR +%.4f, per bad turn %.4f, bounds [%.3f, %.3f]" % (capability.GOOD_STEP, capability.BAD_STEP, capability.LOWER, capability.UPPER))
    rng = random.Random(11)
    line("  %8s %14s %14s %12s %12s" % ("p_ok", "P(capable) th", "P(capable) mc", "E[N] th", "E[N] mc"))
    for p in (0.80, 0.85, 0.90, 0.95, 0.97, 0.99):
        results = [sprt_run(p, rng) for _ in range(20000)]
        mc = sum(1 for verdict, _ in results if verdict == "capable") / len(results)
        mean = sum(n for _, n in results) / len(results)
        line("  %8.2f %14.3f %14.3f %12.1f %12.1f" % (p, capability.operating(p), mc, capability.expected_trials(p), mean))
    line("A capable model (p_ok >= 0.97) is wrongly called weak in at most ~5% of decisions, by construction,")
    line("and a weak one (p_ok <= 0.85) is caught in ~95%; the moving average has no such bound.")
    line()


def verification():
    line("== 4. Finish gate: residual defect probability")
    line("A defect class with checker recall rho and fix success phi per round, g rounds: residual = d0*(1-rho + rho*(1-phi)^g)")
    line("Text hidden under a picture: rho = 1 (exact area of a union of rectangles, checked against a pixel grid")
    line("in tests and against a LibreOffice render: 0.0% vs 0.84% bright pixels).")
    for phi in (0.5, 0.7, 0.9):
        line("  phi=%.1f, g=3: residual = %.3f * d0   (before: d0, since nothing checked decks)" % (phi, (1 - phi) ** 3))
    line()


def parallel_reads():
    line("== 5. Concurrent read-only calls")
    line("k calls in one turn, durations i.i.d. Sequential wait k*mu, concurrent wait E[max].")
    rng = random.Random(5)
    line("  %3s %14s %22s" % ("k", "exp: k/H_k", "lognormal(s=1) MC"))
    for k in (2, 3, 4, 6, 8):
        harmonic = sum(1 / i for i in range(1, k + 1))
        samples = [[rng.lognormvariate(0, 1) for _ in range(k)] for _ in range(20000)]
        speed = sum(sum(s) for s in samples) / sum(max(s) for s in samples)
        line("  %3d %13.2fx %21.2fx" % (k, k / harmonic, speed))
    line()


if __name__ == "__main__":
    parallel_reads()
    tool_catalog()
    compaction()
    capability_gate()
    verification()
