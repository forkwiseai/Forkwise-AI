"""Is this model reliable enough at tool calling to run as an agent? Decided by a sequential test, not by its name.

Each agent turn is a Bernoulli trial: a well-formed turn (valid tool calls or a clean answer) or a broken one
(leaked call text, invalid JSON, unknown tool). Wald's sequential probability ratio test compares
  H0: p = P_LOW  (the model is weak)   against   H1: p = P_HIGH  (the model is capable)
and stops as soon as the evidence is strong enough, with error rates bounded by ALPHA and BETA. A verdict is never
reached from two unlucky turns, which is what the moving-average health score does (see bench/proofs.py).

Counts persist per model in the data folder, so evidence collected in one chat informs the next."""

import json
import math
import threading

from app import config

P_LOW = 0.85
P_HIGH = 0.97
ALPHA = 0.05
BETA = 0.05
UPPER = math.log((1 - BETA) / ALPHA)
LOWER = math.log(BETA / (1 - ALPHA))
GOOD_STEP = math.log(P_HIGH / P_LOW)
BAD_STEP = math.log((1 - P_HIGH) / (1 - P_LOW))
PATH = config.DATA_DIR / "capability.json"
LOCK = threading.Lock()
COUNTS = {}
LOADED = {"done": False}


def load():
    if LOADED["done"]:
        return
    LOADED["done"] = True
    try:
        COUNTS.update(json.loads(PATH.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass


def save():
    try:
        PATH.parent.mkdir(parents=True, exist_ok=True)
        PATH.write_text(json.dumps(COUNTS), encoding="utf-8")
    except OSError:
        pass


def llr(good, bad):
    return good * GOOD_STEP + bad * BAD_STEP


def verdict_of(good, bad):
    value = llr(good, bad)
    if value >= UPPER:
        return "capable"
    if value <= LOWER:
        return "weak"
    return "unknown"


def record(key, good):
    """Adds one trial. Once a verdict is reached the counts restart, so a model that changes is noticed again."""
    with LOCK:
        load()
        item = COUNTS.setdefault(key, {"good": 0, "bad": 0, "verdict": "unknown"})
        item["good" if good else "bad"] += 1
        decided = verdict_of(item["good"], item["bad"])
        if decided != "unknown":
            item["verdict"] = decided
            item["good"] = 0
            item["bad"] = 0
        save()
        return item["verdict"]


def verdict(key):
    with LOCK:
        load()
        return (COUNTS.get(key) or {}).get("verdict", "unknown")


def expected_trials(p):
    """Wald's approximation of the average number of turns before a decision when the true rate is p."""
    accept_h1 = operating(p)
    drift = p * GOOD_STEP + (1 - p) * BAD_STEP
    if abs(drift) < 1e-12:
        return -LOWER * UPPER / (GOOD_STEP * -BAD_STEP)
    return (accept_h1 * UPPER + (1 - accept_h1) * LOWER) / drift


def operating(p):
    """Probability of concluding 'capable' when the true success rate is p (Wald's OC function)."""
    if abs(p - P_LOW) < 1e-12:
        return ALPHA
    if abs(p - P_HIGH) < 1e-12:
        return 1 - BETA
    def g(h):
        if abs(h) < 1e-9:
            return p * GOOD_STEP + (1 - p) * BAD_STEP
        return p * (P_HIGH / P_LOW) ** h + (1 - p) * ((1 - P_HIGH) / (1 - P_LOW)) ** h - 1
    # solve g(h) = 0 for the non-zero root by bisection on the side given by the drift sign
    drift = p * GOOD_STEP + (1 - p) * BAD_STEP
    low, high = (1e-6, 60.0) if drift < 0 else (-60.0, -1e-6)
    for _ in range(200):
        middle = (low + high) / 2
        if (g(low) > 0) == (g(middle) > 0):
            low = middle
        else:
            high = middle
    h = (low + high) / 2
    a = math.exp(UPPER)
    b = math.exp(LOWER)
    return (1 - b ** h) / (a ** h - b ** h)
