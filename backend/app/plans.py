from app import db, config

PRICES = {
    "pro": {"month": 20, "year": 192},
    "premium": {"month": 49, "year": 468},
}

DAYS = {"month": 30, "year": 365}



def active_plan(user):
    plan = user.get("plan") or "free"
    until = user.get("plan_until") or 0
    if plan in PRICES and until > db.now():
        return plan
    return "free"


def limits():
    return {"free": config.FREE_DAILY_TOKENS, "pro": config.PRO_DAILY_TOKENS, "premium": config.PREMIUM_DAILY_TOKENS}


def daily_limit(user):
    # Token caps now apply to the free plan only; paid plans are limited by model cost (limit_state).
    if active_plan(user) != "free":
        return 0
    return max(0, limits()["free"])


import time as _time

# Limits run on two calendar windows in UTC: the day (resets 00:00) and the week (resets Monday 00:00).
# Paid plans are limited in dollars of model cost, so a heavier model or higher effort reaches the limit sooner.
# The free plan only runs free and open-weight models that cost nothing, so it is limited in tokens.
#   daily cap  = monthly budget / 30 * DAILY_BURST     (one heavy day is allowed)
#   weekly cap = monthly budget * 7/30 * WEEKLY_BURST  (but not every day: the week holds it back)
# Worst case a month holds 30/7 weeks at the weekly cap: spend <= monthly * WEEKLY_BURST (see bench/economics.py).


def windows(now=None):
    now = now or _time.time()
    day_start = int(now // 86400) * 86400
    weekday = _time.gmtime(now).tm_wday  # Monday = 0
    week_start = day_start - weekday * 86400
    return {"day": (day_start, day_start + 86400), "week": (week_start, week_start + 7 * 86400)}


def day_text(stamp):
    return _time.strftime("%Y-%m-%d", _time.gmtime(stamp))


def caps(user):
    from app import pricing
    plan = active_plan(user)
    if plan == "free":
        daily = max(0, config.FREE_DAILY_TOKENS)
        weekly = max(0, int(config.FREE_WEEKLY_TOKENS or daily * 5))
        return {"plan": plan, "unit": "tokens", "day": daily, "week": weekly}
    monthly = pricing.monthly_budget(plan, PRICES)
    return {"plan": plan, "unit": "usd", "day": monthly / 30 * pricing.DAILY_BURST, "week": monthly * 7 / 30 * pricing.WEEKLY_BURST}


def budget(user):
    from app import pricing
    found = caps(user)
    found["monthly"] = pricing.monthly_budget(found["plan"], PRICES)
    return found


def limit_state(user, now=None):
    """How much of today's and this week's limit is used, and when each resets."""
    found = caps(user)
    spans = windows(now)
    used = {}
    for name in ("day", "week"):
        first = day_text(spans[name][0])
        used[name] = db.tokens_from(user["id"], first) if found["unit"] == "tokens" else db.spent_from(user["id"], first)
    state = {"plan": found["plan"], "unit": found["unit"], "blocked": None}
    for name in ("day", "week"):
        cap = found[name]
        state[name] = {"used_pct": round(100 * used[name] / cap, 1) if cap > 0 else 0, "resets_at": spans[name][1], "left": max(0, cap - used[name]) if cap > 0 else None}
        if cap > 0 and used[name] >= cap and state["blocked"] is None:
            state["blocked"] = name
    if state["day"]["used_pct"] >= 100 and state["week"]["used_pct"] >= 100:
        state["blocked"] = "week"  # the later reset is the one that matters
    if user.get("is_admin"):
        state["unlimited"] = True  # admins are never stopped (over_budget, check_limit), so the meter would mislead
        state["blocked"] = None
    return state


def blocked_message(state):
    if state["blocked"] is None:
        return ""
    reset = state[state["blocked"]]["resets_at"]
    when = _time.strftime("%A %d %B, %H:%M UTC", _time.gmtime(reset))
    if state["blocked"] == "week":
        return "You reached this week's limit. It resets on " + when + ". Upgrade in Plan and usage for a higher limit."
    return "You reached today's limit. It resets at " + when + ". Upgrade in Plan and usage for a higher limit."


def money_left(user):
    """Dollars this paid-plan user may still spend now (None on the token-limited free plan)."""
    state = limit_state(user)
    if state["unit"] != "usd":
        return None
    return min(state["day"]["left"], state["week"]["left"])


def over_budget(user, model=None):
    if (model and model.get("own")) or user.get("is_admin"):
        return False
    return limit_state(user)["blocked"] is not None


def allows(user, model):
    from app import pricing
    if user.get("is_admin"):
        return True
    return pricing.plan_allows(active_plan(user), model)


def usable_model(user, model):
    """The model to run with: the asked one if the plan allows it, otherwise the first server model it allows."""
    if allows(user, model):
        return model
    for item in config.MODELS:
        if allows(user, item):
            return item
    return None
