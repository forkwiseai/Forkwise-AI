"""Plan economics. Run: python3 -m bench.economics  (from backend/).

A task is N model steps. Step i sends the prompt P0 plus the history so far, g tokens per earlier step, and
returns o output tokens (o grows with reasoning effort). Exact sums, no estimates beyond the stated parameters:
  input tokens  = N*P0 + g*N(N-1)/2
  with history caching, step i re-reads the previous prefix from cache and writes only what is new:
    cached = sum_{i=2..N} (P0 + g(i-2) + o)  ~ the previous prompt,  fresh = input - cached
  output tokens = N*o"""

from app import plans, pricing
from app.agent import prompt, specs, toolcatalog

CHARS_PER_TOKEN = 3.6
STEPS = 25
GROWTH = 1500
EFFORT_OUTPUT = {"low": 350, "medium": 700, "high": 1400}
MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "grok-4.7", "grok-4.3", "gemini-3.8-flash", "gemma-4-26b"]
WRITE_PREMIUM = 1.25  # a cache write costs 1.25x input on Anthropic; others write at the input price or free


def p0(after):
    chat = {"kind": "chat", "mode": "agent", "workspace_id": "w", "local_path": None}
    user = {"id": "u", "name": "T", "settings": None}
    tools = toolcatalog.build(specs.BUILTIN)[0] if after else specs.BUILTIN
    system = prompt.build(chat, user, None, request="build me a website", tool_names=tuple(t["function"]["name"] for t in specs.BUILTIN))
    return int((len(system) + toolcatalog.size(tools)) / CHARS_PER_TOKEN) + 300


def task_tokens(start, steps, growth, out, history_cache):
    total_in = steps * start + growth * steps * (steps - 1) // 2
    cached = 0
    if history_cache:
        for i in range(2, steps + 1):
            cached += start + growth * (i - 2) + out
        cached = min(cached, total_in)
    return total_in, cached, steps * out


def task_cost(model, start, out, history_cache, system_only_cache=False):
    total_in, cached, total_out = task_tokens(start, STEPS, GROWTH, out, history_cache)
    if system_only_cache:
        cached = (STEPS - 1) * start  # only the fixed prefix is ever a cache hit
    price_in, price_cached, price_out = pricing.price_of(model)
    fresh = total_in - cached
    write = WRITE_PREMIUM if "claude" in model else 1.0
    return (fresh * price_in * write + cached * price_cached + total_out * price_out) / 1e6


def main():
    before, after = p0(False), p0(True)
    print("== Prompt size per step (system + tools + request): before %d tokens, after %d (-%.0f%%)" % (before, after, 100 * (before - after) / before))
    print("Task: %d steps, history +%d tokens/step. Cost per task in USD:" % (STEPS, GROWTH))
    print("%-20s %10s %10s %10s %10s %8s" % ("model (medium)", "before", "tools", "+history$", "high", "vs before"))
    rows = {}
    for model in MODELS:
        out = EFFORT_OUTPUT["medium"]
        auto = "grok" in model or "gemini" in model  # these providers cache the history on their own
        old = task_cost(model, before, out, auto, system_only_cache="claude" in model)
        tools_only = task_cost(model, after, out, auto, system_only_cache="claude" in model)
        now = task_cost(model, after, out, True)
        high = task_cost(model, after, EFFORT_OUTPUT["high"], True)
        rows[model] = now
        print("%-20s %10.4f %10.4f %10.4f %10.4f %7.1fx" % (model, old, tools_only, now, high, old / now))
    print("(before = old prompt, only the system prompt cached on Claude; tools = two-tier catalog; +history$ = cache")
    print(" breakpoint on the history too, for providers that cache. Grok and Gemini cache automatically, so their")
    print(" 'before' already had history caching in practice and the honest gain there is the tool column.)")
    print()
    print("== Worst case under the current token limits (every day at the cap, 30 days)")
    caps = {"pro": 5_000_000, "premium": 14_000_000}
    for plan, cap in caps.items():
        price = plans.PRICES[plan]["month"]
        for model in ("claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "gemini-3.8-flash"):
            p_in, _, p_out = pricing.price_of(model)
            month = 30 * cap * (0.97 * p_in + 0.03 * p_out) / 1e6
            print("  %-8s $%-4d %-20s up to $%8.2f/month  -> %s" % (plan, price, model, month, "LOSS x%.1f" % (month / price) if month > price else "ok"))
    print()
    print("== Proposed: dollar budget per plan = %.0f%% of price" % (100 * pricing.COMPUTE_SHARE))
    for plan in ("free", "pro", "premium"):
        budget = pricing.monthly_budget(plan, plans.PRICES)
        line = "  %-8s budget $%6.2f/month, daily cap $%5.2f | tasks/month:" % (plan, budget, pricing.daily_budget(plan, plans.PRICES))
        for model in ("claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "gemini-3.8-flash", "grok-4.7"):
            line += " %s %d" % (model.replace("claude-", "").replace("-5-5", ""), budget / rows[model])
        print(line)
    print()
    for plan, fee_share, fee_fixed in (("pro", 0.005, 0.0), ("premium", 0.005, 0.0)):
        price = plans.PRICES[plan]["month"]
        weekly_cap = pricing.monthly_budget(plan, plans.PRICES) * 7 / 30 * pricing.WEEKLY_BURST
        worst = weekly_cap * 30 / 7  # every week at its cap, for a whole month
        print("  %-8s weekly cap $%.2f, daily cap $%.2f; month at every weekly cap $%.2f -> margin %.0f%%; at 30%% use %.0f%%" % (
            plan, weekly_cap, pricing.daily_budget(plan, plans.PRICES), worst,
            100 * (price * (1 - fee_share) - fee_fixed - worst) / price, 100 * (price * (1 - fee_share) - fee_fixed - 0.3 * worst) / price))


if __name__ == "__main__":
    main()
