import shutil
import time
from fastapi import Request, HTTPException
from pydantic import BaseModel
from app import db, config, mailer, notify
from app.routes.auth import admin_user

PLAN_NAMES = ["free", "pro", "premium"]
USER_TABLES = ["chats", "projects", "memories", "custom_tools", "skills", "mcp_servers", "devices", "connections", "secrets", "schedules", "sessions", "password_resets", "usage_daily", "payments", "action_codes", "security_events", "plugins", "user_providers", "chat_shares", "usage_cost"]


class UserChange(BaseModel):
    plan: str = ""
    days: int = 30
    is_admin: int = -1


def treasury_status(request: Request):
    admin_user(request)
    from app import treasury
    return treasury.status()


async def treasury_check(request: Request):
    admin_user(request)
    import httpx
    from app import treasury
    async with httpx.AsyncClient() as client:
        return await treasury.check(client)


async def run_checks(request: Request):
    admin_user(request)
    import httpx
    from app import diagnostics
    try:
        body = await request.json()
    except Exception:
        body = {}
    async with httpx.AsyncClient() as client:
        return {"checks": await diagnostics.run(client, test_model=bool((body or {}).get("test_model")))}


def overview(request: Request):
    admin_user(request)
    now = db.now()
    total = db.one_row("SELECT COUNT(*) AS n FROM users")["n"]
    new_week = db.one_row("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", (now - 7 * 86400,))["n"]
    paid_users = db.one_row("SELECT COUNT(*) AS n FROM users WHERE plan <> 'free' AND plan_until > ?", (now,))["n"]
    revenue = db.one_row("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'paid'")["total"]
    revenue_month = db.one_row("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'paid' AND paid_at >= ?", (now - 30 * 86400,))["total"]
    chats = db.one_row("SELECT COUNT(*) AS n FROM chats")["n"]
    days = []
    for back in range(13, -1, -1):
        day = time.strftime("%Y-%m-%d", time.gmtime(now - back * 86400))
        row = db.one_row("SELECT COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens, COALESCE(SUM(runs), 0) AS runs FROM usage_daily WHERE day = ?", (day,))
        days.append({"day": day, "tokens": row["tokens"], "runs": row["runs"]})
    today = days[len(days) - 1]
    return {
        "users": total,
        "new_week": new_week,
        "paid_users": paid_users,
        "revenue": revenue,
        "revenue_month": revenue_month,
        "chats": chats,
        "tasks_today": today["runs"],
        "tokens_today": today["tokens"],
        "days": days,
        "active_week": db.one_row("SELECT COUNT(DISTINCT user_id) AS n FROM usage_daily WHERE day >= ?", (time.strftime("%Y-%m-%d", time.gmtime(now - 7 * 86400)),))["n"],
        "plugins": db.all_rows("SELECT plugin_id, COUNT(*) AS installs FROM plugins GROUP BY plugin_id ORDER BY installs DESC LIMIT 6"),
        "pending_delete": sum(1 for row in db.all_rows("SELECT settings FROM users") if db.load_json(row.get("settings"), {}).get("delete_at")),
    }


def users(request: Request, q: str = ""):
    admin_user(request)
    now = db.now()
    like = "%" + q.strip().lower() + "%"
    rows = db.all_rows("SELECT id, email, name, is_admin, created_at, plan, plan_until, settings FROM users WHERE LOWER(email) LIKE ? OR LOWER(name) LIKE ? ORDER BY created_at DESC LIMIT 200", (like, like))
    result = []
    for row in rows:
        usage = db.one_row("SELECT COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens, COALESCE(SUM(runs), 0) AS runs, MAX(day) AS last_day FROM usage_daily WHERE user_id = ?", (row["id"],))
        chats = db.one_row("SELECT COUNT(*) AS n FROM chats WHERE user_id = ?", (row["id"],))["n"]
        active = row["plan"] if row["plan"] != "free" and row["plan_until"] > now else "free"
        result.append({
            "id": row["id"],
            "email": row["email"],
            "name": row["name"],
            "is_admin": bool(row["is_admin"]),
            "created_at": row["created_at"],
            "plan": active,
            "plan_until": row["plan_until"] if active != "free" else 0,
            "tokens": usage["tokens"],
            "runs": usage["runs"],
            "last_day": usage["last_day"] or "",
            "chats": chats,
            "profile": db.load_json(row.get("settings"), {}).get("profile") or {},
            "delete_at": db.load_json(row.get("settings"), {}).get("delete_at") or 0,
        })
    return {"users": result}


def user_detail(user_id: str, request: Request):
    from app import security
    admin_user(request)
    user = db.one_row("SELECT * FROM users WHERE id = ?", (user_id,))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    sessions = db.one_row("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?", (user_id, db.now()))["n"]
    plugins = [row["plugin_id"] for row in db.all_rows("SELECT plugin_id FROM plugins WHERE user_id = ?", (user_id,))]
    projects = db.one_row("SELECT COUNT(*) AS n FROM projects WHERE user_id = ?", (user_id,))["n"]
    pays = db.all_rows("SELECT plan, period, amount, status, created_at FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 10", (user_id,))
    return {"sessions": sessions, "plugins": plugins, "projects": projects, "payments": pays, "events": security.events(user_id, 12), "verified": bool(user["verified"])}


def end_sessions(user_id: str, request: Request):
    from app import security
    admin_user(request)
    db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    security.log(user_id, "sessions_revoked", detail="by an admin")
    return {"ok": True}


def reset_usage(user_id: str, request: Request):
    """Clears this week's metered spend and tokens for one person, so the Today and Week meters start again at 0.
    Used after a pricing fix or as a goodwill gesture; the payments and plan are untouched."""
    from app import plans, security
    admin_user(request)
    first = plans.day_text(plans.windows()["week"][0])
    user = db.one_row("SELECT * FROM users WHERE id = ?", (user_id,))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    db.execute("DELETE FROM usage_cost WHERE user_id = ? AND day >= ?", (user_id, first))
    if plans.caps(user)["unit"] == "tokens":
        # The free plan is metered in tokens; paid plans keep their token history for the statistics.
        db.execute("UPDATE usage_daily SET tokens_in = 0, tokens_out = 0 WHERE user_id = ? AND day >= ?", (user_id, first))
    security.log(user_id, "usage_reset", detail="by an admin")
    return {"ok": True, "limits": plans.limit_state(user)}


def change_user(user_id: str, body: UserChange, request: Request):
    admin = admin_user(request)
    user = db.one_row("SELECT * FROM users WHERE id = ?", (user_id,))
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    if body.plan != "":
        if body.plan not in PLAN_NAMES:
            raise HTTPException(status_code=400, detail="Unknown plan.")
        if body.plan == "free":
            db.update("users", "id", user_id, {"plan": "free", "plan_until": 0})
        else:
            days = max(1, min(body.days, 3650))
            until = db.now() + days * 86400
            db.update("users", "id", user_id, {"plan": body.plan, "plan_until": until})
            notify.plan_started_by_admin(user, body.plan, until)
    if body.is_admin in [0, 1]:
        if user_id == admin["id"] and body.is_admin == 0:
            raise HTTPException(status_code=400, detail="You cannot remove your own admin access.")
        db.update("users", "id", user_id, {"is_admin": body.is_admin})
    return {"ok": True}


async def delete_user(user_id: str, request: Request):
    admin = admin_user(request)
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own account here.")
    await remove_user_data(user_id)
    return {"ok": True}


async def remove_user_data(user_id):
    from app.agent import runs, sandbox
    from app.routes import desktop
    workspaces = []
    for table in ["chats", "projects"]:
        for row in db.all_rows("SELECT workspace_id FROM " + table + " WHERE user_id = ?", (user_id,)):
            if row["workspace_id"] and row["workspace_id"] not in workspaces:
                workspaces.append(row["workspace_id"])
    chat_rows = db.all_rows("SELECT id FROM chats WHERE user_id = ?", (user_id,))
    for chat in chat_rows:
        active = runs.ACTIVE.get(chat["id"])
        if active and active in runs.RUNS:
            runs.RUNS[active].stop()
        db.execute("DELETE FROM messages WHERE chat_id = ?", (chat["id"],))
        db.execute("DELETE FROM runs WHERE chat_id = ?", (chat["id"],))
    for link in list(desktop.ONLINE.values()):
        if link.device["user_id"] == user_id:
            try:
                await link.websocket.close(code=4401)
            except Exception:
                pass
    for table in USER_TABLES:
        db.execute("DELETE FROM " + table + " WHERE user_id = ?", (user_id,))
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    for wid in workspaces:
        try:
            await sandbox.remove(wid)
        except Exception:
            pass
        shutil.rmtree(config.CHECKPOINTS_DIR / (wid + ".git"), ignore_errors=True)
    shutil.rmtree(config.TOOLS_DIR / user_id, ignore_errors=True)


def payments(request: Request):
    admin_user(request)
    rows = db.all_rows("SELECT payments.id, payments.plan, payments.period, payments.amount, payments.status, payments.created_at, payments.paid_at, users.email FROM payments LEFT JOIN users ON users.id = payments.user_id ORDER BY payments.created_at DESC LIMIT 300")
    return {"payments": rows}


class AnnounceBody(BaseModel):
    subject: str
    title: str = ""
    body: str
    audience: str = "all"
    button_label: str = ""
    button_url: str = ""
    test: bool = True


AUDIENCES = ["all", "paid", "free"]


def announce_audience(request: Request, kind: str = "all"):
    admin_user(request)
    if kind not in AUDIENCES:
        raise HTTPException(status_code=400, detail="Unknown audience.")
    return {"count": len(notify.audience(kind)), "email_ready": mailer.ready()}


def announce(body: AnnounceBody, request: Request):
    admin = admin_user(request)
    if not mailer.ready():
        raise HTTPException(status_code=503, detail="Email is not set up on the server. Fill in the SMTP settings first.")
    subject = body.subject.strip()[:150]
    text = body.body.strip()[:20000]
    if len(subject) < 3 or len(text) < 10:
        raise HTTPException(status_code=400, detail="Write a subject and a message.")
    if body.audience not in AUDIENCES:
        raise HTTPException(status_code=400, detail="Unknown audience.")
    url = body.button_url.strip()
    if url and not url.startswith("https://"):
        raise HTTPException(status_code=400, detail="The button link must start with https://")
    users = [admin] if body.test else notify.audience(body.audience)
    notify.later(notify.send_announcement, users, subject, body.title.strip()[:150], text, body.button_label.strip()[:40], url)
    return {"ok": True, "sending": len(users)}


def register_routes(app):
    app.add_api_route("/api/admin/announce", announce, methods=["POST"])
    app.add_api_route("/api/admin/announce/audience", announce_audience, methods=["GET"])
    app.add_api_route("/api/admin/overview", overview, methods=["GET"])
    app.add_api_route("/api/admin/treasury", treasury_status, methods=["GET"])
    app.add_api_route("/api/admin/checks", run_checks, methods=["POST"])
    app.add_api_route("/api/admin/treasury/check", treasury_check, methods=["POST"])
    app.add_api_route("/api/admin/users", users, methods=["GET"])
    app.add_api_route("/api/admin/users/{user_id}", change_user, methods=["POST"])
    app.add_api_route("/api/admin/users/{user_id}", delete_user, methods=["DELETE"])
    app.add_api_route("/api/admin/users/{user_id}/detail", user_detail, methods=["GET"])
    app.add_api_route("/api/admin/users/{user_id}/sessions", end_sessions, methods=["DELETE"])
    app.add_api_route("/api/admin/users/{user_id}/usage", reset_usage, methods=["DELETE"])
    app.add_api_route("/api/admin/payments", payments, methods=["GET"])
