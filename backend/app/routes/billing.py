import hashlib
import hmac
import json
import httpx
from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from app import db, config, plans, notify
from app.routes.auth import current_user

INVOICE_URL = "https://api.nowpayments.io/v1/invoice"
LEMON_URL = "https://api.lemonsqueezy.com/v1/checkouts"


class CheckoutBody(BaseModel):
    plan: str
    period: str = "month"
    method: str = ""


def crypto_enabled():
    return config.NOWPAYMENTS_API_KEY != "" and config.NOWPAYMENTS_IPN_SECRET != ""


def card_enabled():
    return config.LEMONSQUEEZY_API_KEY != "" and config.LEMONSQUEEZY_STORE_ID != "" and config.LEMONSQUEEZY_WEBHOOK_SECRET != "" and len(config.LEMONSQUEEZY_VARIANTS) > 0


def enabled():
    return crypto_enabled() or card_enabled()


def methods():
    return [
        {"key": "card", "label": "Card, PayPal, Apple Pay", "enabled": card_enabled()},
        {"key": "crypto", "label": "Crypto", "enabled": crypto_enabled()},
    ]


def activate(payment, user):
    start = db.now()
    if plans.active_plan(user) == payment["plan"] and (user.get("plan_until") or 0) > start:
        start = user["plan_until"]
    until = start + plans.DAYS[payment["period"]] * 86400
    db.execute("UPDATE users SET plan = ?, plan_until = ? WHERE id = ?", (payment["plan"], until, user["id"]))
    db.execute("UPDATE payments SET status = 'paid', paid_at = ? WHERE id = ?", (db.now(), payment["id"]))
    try:
        from app import security
        security.log(user["id"], "plan_changed", detail=payment["plan"] + " " + payment["period"])
    except Exception:
        pass
    notify.plan_started(user, payment["plan"], until)


def billing_info(request: Request):
    user = current_user(request)
    rows = db.all_rows("SELECT id, plan, period, amount, status, created_at, paid_at FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 10", (user["id"],))
    return {
        "enabled": enabled(),
        "methods": methods(),
        "prices": plans.PRICES,
        "plan": plans.active_plan(user),
        "plan_until": user.get("plan_until") or 0,
        "limit": plans.daily_limit(user),
        "budget": plans.budget(user),
        "spent_today": round(db.spent(user["id"], 1), 4),
        "spent_month": round(db.spent(user["id"], 30), 4),
        "payments": rows,
    }


async def card_checkout(user, body, amount):
    variant = config.LEMONSQUEEZY_VARIANTS.get(body.plan + "_" + body.period)
    if not variant:
        raise HTTPException(status_code=503, detail="Card payments are not set up for this plan yet.")
    payment_id = db.new_id("pay_")
    payload = {"data": {
        "type": "checkouts",
        "attributes": {
            "checkout_data": {"email": user["email"], "name": user["name"], "custom": {"payment_id": payment_id, "user_id": user["id"]}},
            "product_options": {"redirect_url": config.SITE_URL + "/app/billing?paid=1"},
            "checkout_options": {"embed": False},
        },
        "relationships": {
            "store": {"data": {"type": "stores", "id": str(config.LEMONSQUEEZY_STORE_ID)}},
            "variant": {"data": {"type": "variants", "id": str(variant)}},
        },
    }}
    headers = {"Accept": "application/vnd.api+json", "Content-Type": "application/vnd.api+json", "Authorization": "Bearer " + config.LEMONSQUEEZY_API_KEY}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            reply = await client.post(LEMON_URL, json=payload, headers=headers)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Could not reach the payment service. Try again in a minute.")
    if reply.status_code >= 300:
        print("LEMONSQUEEZY FAILED", reply.status_code, reply.text[:300], flush=True)
        raise HTTPException(status_code=502, detail="The payment service refused the request.")
    url = ((reply.json().get("data") or {}).get("attributes") or {}).get("url") or ""
    if not url:
        raise HTTPException(status_code=502, detail="The payment service gave no payment page.")
    db.insert("payments", {"id": payment_id, "user_id": user["id"], "plan": body.plan, "period": body.period, "amount": amount, "status": "created", "invoice_id": "card", "invoice_url": url, "created_at": db.now(), "paid_at": 0})
    return {"url": url}


async def checkout(body: CheckoutBody, request: Request):
    user = current_user(request)
    if body.plan not in plans.PRICES or body.period not in plans.DAYS:
        raise HTTPException(status_code=400, detail="Unknown plan.")
    amount = plans.PRICES[body.plan][body.period]
    method = body.method or ("card" if card_enabled() else "crypto")
    if method == "card":
        if not card_enabled():
            raise HTTPException(status_code=503, detail="Card payments are not switched on yet.")
        return await card_checkout(user, body, amount)
    if not crypto_enabled():
        raise HTTPException(status_code=503, detail="Crypto payments are not switched on yet.")
    payment_id = db.new_id("pay_")
    label = "Forkwise " + body.plan.capitalize() + (" yearly" if body.period == "year" else " monthly")
    data = {
        "price_amount": amount,
        "price_currency": "usd",
        "order_id": payment_id,
        "order_description": label,
        "ipn_callback_url": config.API_URL + "/api/billing/ipn",
        "success_url": config.SITE_URL + "/app/billing?paid=1",
        "cancel_url": config.SITE_URL + "/app/billing",
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            reply = await client.post(INVOICE_URL, json=data, headers={"x-api-key": config.NOWPAYMENTS_API_KEY})
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Could not reach the payment service. Try again in a minute.")
    if reply.status_code >= 300:
        print("NOWPAYMENTS FAILED", reply.status_code, reply.text[:300], flush=True)
        raise HTTPException(status_code=502, detail="The payment service refused the request.")
    invoice = reply.json()
    url = invoice.get("invoice_url") or ""
    if url == "":
        raise HTTPException(status_code=502, detail="The payment service gave no payment page.")
    db.insert("payments", {"id": payment_id, "user_id": user["id"], "plan": body.plan, "period": body.period, "amount": amount, "status": "created", "invoice_id": str(invoice.get("id") or ""), "invoice_url": url, "created_at": db.now(), "paid_at": 0})
    return {"url": url}


def signature_ok(raw_body, header):
    try:
        data = json.loads(raw_body)
    except ValueError:
        return None
    text = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    expected = hmac.new(config.NOWPAYMENTS_IPN_SECRET.encode("utf-8"), text.encode("utf-8"), hashlib.sha512).hexdigest()
    if hmac.compare_digest(expected, (header or "").lower()):
        return data
    return None


async def ipn(request: Request):
    if not crypto_enabled():
        return JSONResponse({"ok": False}, status_code=503)
    raw = await request.body()
    data = signature_ok(raw, request.headers.get("x-nowpayments-sig"))
    if data is None:
        return JSONResponse({"ok": False}, status_code=401)
    payment = db.one_row("SELECT * FROM payments WHERE id = ?", (str(data.get("order_id") or ""),))
    if payment is None:
        return {"ok": True}
    status = str(data.get("payment_status") or "")
    if payment["status"] == "paid":
        return {"ok": True}
    if status != "finished":
        db.execute("UPDATE payments SET status = ? WHERE id = ?", (status, payment["id"]))
        return {"ok": True}
    try:
        paid_amount = float(data.get("price_amount") or 0)
    except ValueError:
        paid_amount = 0
    if paid_amount + 0.001 < payment["amount"]:
        db.execute("UPDATE payments SET status = 'amount_mismatch' WHERE id = ?", (payment["id"],))
        return {"ok": True}
    user = db.one_row("SELECT * FROM users WHERE id = ?", (payment["user_id"],))
    if user is None:
        return {"ok": True}
    activate(payment, user)
    return {"ok": True}


async def card_webhook(request: Request):
    if not card_enabled():
        return JSONResponse({"ok": False}, status_code=503)
    raw = await request.body()
    expected = hmac.new(config.LEMONSQUEEZY_WEBHOOK_SECRET.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, (request.headers.get("x-signature") or "").lower()):
        return JSONResponse({"ok": False}, status_code=401)
    try:
        data = json.loads(raw)
    except ValueError:
        return JSONResponse({"ok": False}, status_code=400)
    meta = data.get("meta") or {}
    if meta.get("event_name") != "order_created":
        return {"ok": True}
    custom = meta.get("custom_data") or {}
    payment = db.one_row("SELECT * FROM payments WHERE id = ?", (str(custom.get("payment_id") or ""),))
    if payment is None or payment["status"] == "paid":
        return {"ok": True}
    attributes = (data.get("data") or {}).get("attributes") or {}
    if attributes.get("status") != "paid":
        db.execute("UPDATE payments SET status = ? WHERE id = ?", (str(attributes.get("status") or "pending")[:30], payment["id"]))
        return {"ok": True}
    paid_usd = (attributes.get("total_usd") or attributes.get("subtotal_usd") or 0) / 100
    if paid_usd + 0.01 < payment["amount"] * 0.95:
        db.execute("UPDATE payments SET status = 'amount_mismatch' WHERE id = ?", (payment["id"],))
        return {"ok": True}
    user = db.one_row("SELECT * FROM users WHERE id = ?", (payment["user_id"],))
    if user is not None:
        activate(payment, user)
    return {"ok": True}


def register_routes(app):
    app.add_api_route("/api/billing/card-webhook", card_webhook, methods=["POST"])
    app.add_api_route("/api/billing", billing_info, methods=["GET"])
    app.add_api_route("/api/billing/checkout", checkout, methods=["POST"])
    app.add_api_route("/api/billing/ipn", ipn, methods=["POST"])
