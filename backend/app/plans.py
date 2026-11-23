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
    return max(0, limits()[active_plan(user)])
