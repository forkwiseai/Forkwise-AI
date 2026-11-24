"""What one model call costs in US dollars, and how much each plan may spend.

Limits used to count tokens. A token of a premium model costs up to 200 times a token of a small one, so a plan
priced in tokens is either too stingy on cheap models or loses money on expensive ones. Spending is now measured
in money: cost = uncached input * in + cached input * cache_read + output * out (per million tokens).
Reasoning effort needs no special case: thinking tokens are billed as output tokens and arrive in the usage count.

Prices: USD per million tokens (input, cached input, output), checked November 2026 on the providers' pages.
Override or extend with MODEL_PRICES in the env file, e.g. MODEL_PRICES={"my-model": [1, 0.1, 4]}."""

import json
import os

PRICES = [
    # most specific first; matched as a substring of the model id, lower case
    ("claude-fable", (10.0, 0.25, 50.0)),
    ("claude-opus-5", (4.0, 0.20, 20.0)),
    ("claude-opus", (5.0, 0.50, 25.0)),
    ("claude-sonnet", (2.0, 0.10, 10.0)),
    ("claude-haiku-5", (0.10, 0.01, 0.50)),
    ("claude-haiku", (1.0, 0.10, 5.0)),
    ("grok-4.1-fast", (0.20, 0.05, 0.50)),
    ("grok-4.3", (1.25, 0.20, 2.50)),
    ("grok", (2.0, 0.50, 6.0)),
    ("gemini-3.8-flash", (0.75, 0.075, 3.75)),
    ("gemini-3.7-flash", (0.75, 0.075, 3.75)),
    ("gemini", (2.0, 0.20, 12.0)),
    ("gemma", (0.10, 0.10, 0.30)),
    ("gpt-oss", (0.15, 0.15, 0.60)),
]
UNKNOWN = (2.0, 0.20, 10.0)  # priced like a mid-tier model, so an unlisted model never looks free

# Share of the plan price the plan may spend on models in a month. The rest pays payment fees, servers and margin.
COMPUTE_SHARE = float(os.environ.get("PLAN_COMPUTE_SHARE", "0.45"))
FREE_MONTHLY_USD = float(os.environ.get("FREE_MONTHLY_USD", "0.60"))
# A day may use up to this many times the month's average daily budget, so heavy days are possible.
BURST = float(os.environ.get("PLAN_DAILY_BURST", "4"))


def extra_prices():
    try:
        return {key.lower(): tuple(float(item) for item in value) for key, value in json.loads(os.environ.get("MODEL_PRICES", "{}")).items()}
    except (ValueError, TypeError):
        return {}


def price_of(model_id):
    lowered = (model_id or "").lower()
    for key, value in extra_prices().items():
        if key in lowered:
            return value
    for key, value in PRICES:
        if key in lowered:
            return value
    return UNKNOWN


def cost(model_id, prompt_tokens, completion_tokens, cached_tokens=0, own_key=False):
    """Dollars for one call. A person's own API key costs Forkwise nothing."""
    if own_key:
        return 0.0
    price_in, price_cached, price_out = price_of(model_id)
    cached = max(0, min(cached_tokens or 0, prompt_tokens or 0))
    fresh = max(0, (prompt_tokens or 0) - cached)
    return (fresh * price_in + cached * price_cached + (completion_tokens or 0) * price_out) / 1_000_000


def monthly_budget(plan, prices):
    if plan == "free":
        return FREE_MONTHLY_USD
    monthly_price = prices.get(plan, {}).get("month", 0)
    return monthly_price * COMPUTE_SHARE


def daily_budget(plan, prices):
    return monthly_budget(plan, prices) / 30 * BURST
