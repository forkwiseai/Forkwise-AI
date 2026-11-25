"""Watches the OpenRouter balance and tells the admins when to top it up, and by how much. Moves no money.

Numbers (all in USD):
  balance  = total_credits - total_usage                        (GET /api/v1/credits, management key)
  burn7    = OpenRouter usage_weekly of the server key          (GET /api/v1/key, normal key)
             (Forkwise's own priced spend is only a fallback when every model on the server is an OpenRouter
              model: it sums all providers, so with NVIDIA, Gemini or Groq it is not OpenRouter's bill)
  daily    = burn7 / 7,  days_left = balance / daily
  target   = max(MIN_BALANCE, burn7 * TARGET_WEEKS)             low when balance < target and burn7 > 0
             (with no paid OpenRouter use the $10 is optional: it only lifts free models from 50 to 1,000 requests a day)
  top_up   = round up to the whole dollar of max(MIN_PURCHASE, burn7 * FILL_WEEKS + MIN_BALANCE - balance)
  send     = top_up * (1 + CRYPTO_FEE)                          the USDC to send, fee included

Alerts go by email to every admin and, if set, to a Telegram chat; at most one every ALERT_EVERY seconds,
and again at once if the balance falls below CRITICAL_DAYS of spending."""

import asyncio
import math
import os
import time
import traceback

import httpx

from app import config, db

CREDITS_URL = "https://openrouter.ai/api/v1/credits"
KEY_URL = "https://openrouter.ai/api/v1/key"
CHECK_EVERY = 3600
ALERT_EVERY = 12 * 3600
CRITICAL_DAYS = 2


def setting(name, default):
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return float(default)


def server_key():
    for model in config.MODELS:
        if "openrouter.ai" in str(model.get("url") or "") and model.get("api_key"):
            return model["api_key"]
    return ""


STATE = {"checked_at": 0, "alerted_at": 0, "alerted_kind": "", "last": None}


def plan(balance, burn7):
    """The numbers above, from a balance (or None when unknown) and a weekly burn."""
    # $10 of purchased credit is also what OpenRouter asks for before it allows 1,000 free-model requests a day.
    min_balance = setting("TREASURY_MIN_BALANCE", "10")
    target = max(min_balance, burn7 * setting("TREASURY_TARGET_WEEKS", "1.5"))
    daily = burn7 / 7
    result = {"burn7": round(burn7, 4), "daily": round(daily, 4), "target": round(target, 2), "balance": None, "days_left": None, "low": False, "critical": False, "top_up": 0, "send_usdc": 0}
    if balance is None:
        return result
    result["balance"] = round(balance, 4)
    result["days_left"] = round(balance / daily, 1) if daily > 0 else None
    result["optional"] = burn7 <= 0 and balance < min_balance
    result["low"] = burn7 > 0 and balance < target
    result["critical"] = result["days_left"] is not None and result["days_left"] < CRITICAL_DAYS
    if result["low"]:
        need = max(setting("TREASURY_MIN_PURCHASE", "10"), burn7 * setting("TREASURY_FILL_WEEKS", "2") + min_balance - balance)
        top_up = math.ceil(round(need, 6))
        result["top_up"] = top_up
        result["send_usdc"] = math.ceil(top_up * (1 + setting("TREASURY_CRYPTO_FEE", "0.05")) * 100) / 100
    return result


async def read_openrouter(client):
    found = {"balance": None, "usage_weekly": None, "error": ""}
    management = os.environ.get("OPENROUTER_MANAGEMENT_KEY", "").strip()
    key = server_key()
    for token in [item for item in (management, key) if item]:
        try:
            reply = await client.get(CREDITS_URL, headers={"Authorization": "Bearer " + token}, timeout=20)
            if reply.status_code == 200:
                data = reply.json().get("data") or {}
                found["balance"] = float(data.get("total_credits") or 0) - float(data.get("total_usage") or 0)
                break
        except (httpx.HTTPError, ValueError):
            continue
    if found["balance"] is None:
        found["error"] = "The balance needs an OpenRouter management key (OPENROUTER_MANAGEMENT_KEY)." if key else "No OpenRouter model is set up on this server."
    if key:
        try:
            reply = await client.get(KEY_URL, headers={"Authorization": "Bearer " + key}, timeout=20)
            if reply.status_code == 200:
                data = reply.json().get("data") or {}
                if data.get("usage_weekly") is not None:
                    found["usage_weekly"] = float(data["usage_weekly"])
        except (httpx.HTTPError, ValueError):
            pass
    return found


def only_openrouter():
    models = [model for model in config.MODELS if not model.get("own")]
    return bool(models) and all("openrouter.ai" in str(model.get("url") or "") for model in models)


def own_spend_week():
    first = time.strftime("%Y-%m-%d", time.gmtime(time.time() - 6 * 86400))
    row = db.one_row("SELECT COALESCE(SUM(micros), 0) AS total FROM usage_cost WHERE day >= ?", (first,))
    return int((row or {}).get("total") or 0) / 1_000_000


async def check(client):
    read = await read_openrouter(client)
    if read["usage_weekly"] is not None:
        burn7 = read["usage_weekly"]
    else:
        burn7 = own_spend_week() if only_openrouter() else 0.0
    read["usage_weekly"] = burn7
    result = plan(read["balance"], burn7)
    result["error"] = read["error"]
    result["checked_at"] = time.time()
    STATE["last"] = result
    STATE["checked_at"] = result["checked_at"]
    return result


def message(result):
    days = "about " + str(result["days_left"]) + " days" if result["days_left"] is not None else "an unknown time"
    return ("OpenRouter balance is $" + format(result["balance"], ".2f") + ", enough for " + days + " at the current rate ($" + format(result["daily"], ".2f") + " a day). "
            "Buy $" + str(result["top_up"]) + " of credits: send " + format(result["send_usdc"], ".2f") + " USDC (about 5% crypto fee included) on openrouter.ai/settings/credits.")


def should_alert(result, now):
    if not result.get("low"):
        return False
    kind = "critical" if result["critical"] else "low"
    if kind == "critical" and STATE["alerted_kind"] != "critical":
        return True
    return now - STATE["alerted_at"] >= ALERT_EVERY


async def alert(client, result):
    from app import notify
    text = message(result)
    subject = ("Urgent: " if result["critical"] else "") + "Top up OpenRouter: send " + format(result["send_usdc"], ".2f") + " USDC"
    sent = False
    for admin in db.all_rows("SELECT email FROM users WHERE is_admin = 1"):
        sent = notify.deliver(admin["email"], subject, "Time to top up OpenRouter", [text], button=("Open OpenRouter credits", "https://openrouter.ai/settings/credits")) or sent
    bot = os.environ.get("TREASURY_TELEGRAM_TOKEN", "").strip()
    chat = os.environ.get("TREASURY_TELEGRAM_CHAT", "").strip()
    if bot and chat:
        try:
            reply = await client.post("https://api.telegram.org/bot" + bot + "/sendMessage", json={"chat_id": chat, "text": subject + "\n\n" + text}, timeout=20)
            sent = sent or reply.status_code == 200
        except httpx.HTTPError:
            pass
    return sent


async def loop():
    await asyncio.sleep(60)
    while True:
        try:
            if server_key() or os.environ.get("OPENROUTER_MANAGEMENT_KEY"):
                async with httpx.AsyncClient() as client:
                    result = await check(client)
                    now = time.time()
                    if should_alert(result, now) and await alert(client, result):
                        STATE["alerted_at"] = now
                        STATE["alerted_kind"] = "critical" if result["critical"] else "low"
        except Exception:
            traceback.print_exc()
        await asyncio.sleep(CHECK_EVERY)


def status():
    return STATE["last"] or {"balance": None, "error": "Not checked yet. The first check runs a minute after the server starts.", "checked_at": 0}
