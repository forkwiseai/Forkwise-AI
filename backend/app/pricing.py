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
    (":free", (0.0, 0.0, 0.0)),   # OpenRouter free models: no charge (they are rate-limited instead)
    ("@cf/", (0.0, 0.0, 0.0)),    # Cloudflare Workers AI free allocation; set MODEL_PRICES if you move to Workers Paid
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
    ("nemotron", (0.10, 0.10, 0.50)),  # NVIDIA Nemotron on paid hosts; NVIDIA's own build API is free (FREE_HOSTS)
    ("deepseek", (0.30, 0.03, 1.20)),
    ("qwen", (0.20, 0.02, 0.80)),
    ("glm", (0.60, 0.11, 2.20)),
    ("kimi", (0.60, 0.15, 2.50)),
    ("minimax", (0.30, 0.03, 1.20)),
    ("llama", (0.20, 0.20, 0.60)),
    ("mistral", (0.40, 0.04, 2.00)),
    ("devstral", (0.40, 0.04, 2.00)),
    ("gpt-oss", (0.15, 0.15, 0.60)),
]
UNKNOWN = (2.0, 0.20, 10.0)  # priced like a mid-tier model, so an unlisted model never looks free

# Hosts whose API is free for the key holder: no billing exists on it (NVIDIA's build.nvidia.com catalog is free
# prototyping access, rate-limited to about 40 requests a minute). Other free tiers (Groq, Gemini, Mistral, SambaNova,
# Cohere trial) also sell paid tiers on the same host, so they are marked free per provider with PROVIDER_n_FREE=true.
FREE_HOSTS = ("integrate.api.nvidia.com",)

# Share of the plan price the plan may spend on models in a month. The rest pays payment fees, servers and margin.
COMPUTE_SHARE = float(os.environ.get("PLAN_COMPUTE_SHARE", "0.45"))
FREE_MONTHLY_USD = float(os.environ.get("FREE_MONTHLY_USD", "0.60"))
# A day may use up to DAILY_BURST times the month's average day; a week up to WEEKLY_BURST times its average week.
DAILY_BURST = float(os.environ.get("PLAN_DAILY_BURST", "3"))
WEEKLY_BURST = float(os.environ.get("PLAN_WEEKLY_BURST", "1.25"))


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


def free_model(model):
    """True when calls to this model cost Forkwise nothing: a free-tier provider or a free host."""
    if not model:
        return False
    if model.get("free"):
        return True
    url = (model.get("url") or "").lower()
    extra = tuple(item.strip().lower() for item in os.environ.get("FREE_HOSTS", "").split(",") if item.strip())
    return any(host in url for host in FREE_HOSTS + extra)


def cost(model_id, prompt_tokens, completion_tokens, cached_tokens=0, own_key=False, model=None):
    """Dollars for one call. A person's own API key, a free tier and a free host cost Forkwise nothing."""
    if own_key or free_model(model):
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
    return monthly_budget(plan, prices) / 30 * DAILY_BURST


# Open-weight model families (weights published, many hosts). The free plan may use these and the :free models.
OPEN_WEIGHT = ("gemma", "llama", "qwen", "qwq", "mistral", "mixtral", "devstral", "codestral", "ministral", "deepseek",
               "gpt-oss", "kimi", "glm", "minimax", "nemotron", "phi-", "olmo", "lfm", "granite", "hermes", "ernie-4.5")


def model_tier(model_id, model=None):
    """free: no charge to Forkwise. open: open-weight family. paid: closed frontier model."""
    if free_model(model):
        return "free"
    lowered = (model_id or "").lower()
    extra = [item.strip().lower() for item in os.environ.get("OPEN_WEIGHT_EXTRA", "").split(",") if item.strip()]
    if lowered.endswith(":free") or "@cf/" in lowered:
        return "free"
    if any(word in lowered for word in OPEN_WEIGHT + tuple(extra)):
        return "open"
    return "paid"


def plan_allows(plan, model):
    """Free plan: free and open-weight models only. Paid plans: every model; heavier ones use the limit faster."""
    if model is None or model.get("own"):
        return True
    if plan != "free":
        return True
    return model_tier(model.get("id", ""), model) in ("free", "open")
