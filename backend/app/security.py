"""Account security: session details, one-time action codes, the activity log and alert emails."""
import hashlib
import hmac
import html
import re
import secrets
import time
from fastapi import HTTPException
from app import config, db, mailer, notify

CODE_MINUTES = 10
CODE_TRIES = 5
RESEND_SECONDS = 30
SEEN_EVERY = 300
DELETE_GRACE_DAYS = 14

PURPOSES = {
    "delete": "delete your account",
    "email": "change your email address",
    "password": "change your password",
    "sessions": "sign out every device",
}

EVENT_TEXT = {
    "signup": "Account created",
    "sign_in": "Signed in",
    "sign_in_new": "Signed in from a new device",
    "sign_in_failed": "Wrong password entered",
    "password_changed": "Password changed",
    "password_reset": "Password reset by email",
    "email_changed": "Email address changed",
    "sessions_revoked": "Signed out of other devices",
    "session_revoked": "Signed out of a device",
    "delete_requested": "Account deletion scheduled",
    "delete_cancelled": "Account deletion cancelled",
    "plan_changed": "Plan changed",
    "api_key_created": "API key created",
}


def session_id(token):
    return hashlib.sha256(("fw-session:" + token).encode("utf-8")).hexdigest()[:20]


def short_agent(agent):
    agent = agent or ""
    browser = "Browser"
    for name, label in (("Edg/", "Edge"), ("OPR/", "Opera"), ("Firefox/", "Firefox"), ("Chrome/", "Chrome"), ("Safari/", "Safari")):
        if name in agent:
            browser = label
            break
    if "Forkwise" in agent or "Electron" in agent:
        browser = "Forkwise desktop"
    system = ""
    for name, label in (("Windows", "Windows"), ("Mac OS X", "macOS"), ("Macintosh", "macOS"), ("Android", "Android"), ("iPhone", "iPhone"), ("iPad", "iPad"), ("Linux", "Linux")):
        if name in agent:
            system = label
            break
    if not agent:
        return "Unknown device"
    return browser + (" on " + system if system else "")


def masked_ip(ip):
    ip = ip or ""
    if ":" in ip:
        parts = ip.split(":")
        return ":".join(parts[:3]) + ":…"
    parts = ip.split(".")
    if len(parts) == 4:
        return parts[0] + "." + parts[1] + "." + parts[2] + ".x"
    return ip


def log(user_id, kind, ip="", agent="", detail=""):
    try:
        db.insert("security_events", {
            "id": db.new_id("ev_"), "user_id": user_id, "kind": kind, "detail": str(detail)[:480],
            "ip": (ip or "")[:60], "user_agent": (agent or "")[:390], "created_at": db.now(),
        })
    except Exception:
        pass


def events(user_id, limit=30):
    rows = db.all_rows("SELECT * FROM security_events WHERE user_id = ? ORDER BY created_at DESC LIMIT " + str(int(limit)), (user_id,))
    result = []
    for row in rows:
        result.append({
            "id": row["id"], "kind": row["kind"], "label": EVENT_TEXT.get(row["kind"], row["kind"].replace("_", " ").capitalize()),
            "detail": row["detail"], "ip": masked_ip(row["ip"]), "device": short_agent(row["user_agent"]), "created_at": row["created_at"],
        })
    return result


def known_ip(user_id, ip):
    if not ip:
        return True
    row = db.one_row("SELECT token FROM sessions WHERE user_id = ? AND ip = ? LIMIT 1", (user_id, ip))
    if row:
        return True
    row = db.one_row("SELECT id FROM security_events WHERE user_id = ? AND ip = ? AND kind IN ('sign_in', 'sign_in_new', 'signup') LIMIT 1", (user_id, ip))
    return row is not None


def touch(session):
    if db.now() - (session.get("last_seen") or 0) > SEEN_EVERY:
        try:
            db.execute("UPDATE sessions SET last_seen = ? WHERE token = ?", (db.now(), session["token"]))
        except Exception:
            pass


def list_sessions(user_id, current_token):
    rows = db.all_rows("SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC", (user_id, db.now()))
    result = []
    for row in rows:
        result.append({
            "id": session_id(row["token"]),
            "device": short_agent(row.get("user_agent")),
            "ip": masked_ip(row.get("ip")),
            "created_at": row["created_at"],
            "last_seen": row.get("last_seen") or row["created_at"],
            "current": row["token"] == current_token,
        })
    return result


def revoke_session(user_id, sid, current_token):
    for row in db.all_rows("SELECT token FROM sessions WHERE user_id = ?", (user_id,)):
        if session_id(row["token"]) == sid:
            if row["token"] == current_token:
                raise HTTPException(status_code=400, detail="Use Sign out to end this session.")
            db.execute("DELETE FROM sessions WHERE token = ?", (row["token"],))
            return True
    raise HTTPException(status_code=404, detail="That session has already ended.")


def hash_code(code, salt):
    return hashlib.sha256((salt + ":" + code).encode("utf-8")).hexdigest()


def code_digits(code):
    cells = ""
    for digit in code:
        cells = cells + '<span style="display:inline-block;width:40px;height:52px;line-height:52px;margin:0 3px;border-radius:10px;border:1px solid #e5e5e5;background:#f6f6f6;color:#1a1a1a;font-size:26px;font-weight:700;font-family:Menlo,Consolas,monospace;text-align:center">' + digit + "</span>"
    return '<span style="display:block;text-align:center;margin:8px 0 6px">' + cells + "</span>"


def send_action_code(user, purpose, target="", ip=""):
    if purpose not in PURPOSES:
        raise HTTPException(status_code=400, detail="Unknown action.")
    if not mailer.ready():
        raise HTTPException(status_code=503, detail="Email is not set up on this server, so security codes cannot be sent. Contact support.")
    row = db.one_row("SELECT * FROM action_codes WHERE user_id = ? AND purpose = ?", (user["id"], purpose))
    if row and db.now() - row["last_sent"] < RESEND_SECONDS:
        wait = int(RESEND_SECONDS - (db.now() - row["last_sent"])) + 1
        raise HTTPException(status_code=429, detail="Wait " + str(wait) + " seconds before asking for another code.")
    code = str(secrets.randbelow(900000) + 100000)
    salt = secrets.token_hex(8)
    to = target if purpose == "email" and target else user["email"]
    action = PURPOSES[purpose]
    where = (" The request came from " + html.escape(masked_ip(ip)) + ".") if ip else ""
    paragraphs = [
        "Hi " + notify.first_name(user) + ", use this code to " + action + ".",
        code_digits(code),
        "The code works for " + str(CODE_MINUTES) + " minutes." + where + " If you did not ask for it, change your password now. Nobody from Forkwise will ever ask you for this code.",
    ]
    text = "Your Forkwise security code is " + code + ". Use it to " + action + ". It works for " + str(CODE_MINUTES) + " minutes. If you did not ask for it, change your password now."
    try:
        mailer.send(to, code + " is your Forkwise security code", text, notify.layout("Confirm it's you", paragraphs, footer_note="Sent because someone asked to " + action + "."))
    except Exception:
        raise HTTPException(status_code=502, detail="We could not send the email. Try again in a minute.")
    db.execute("DELETE FROM action_codes WHERE user_id = ? AND purpose = ?", (user["id"], purpose))
    db.insert("action_codes", {
        "id": db.new_id("ac_"), "user_id": user["id"], "purpose": purpose, "target": target or "",
        "code_hash": hash_code(code, salt), "salt": salt, "expires_at": db.now() + CODE_MINUTES * 60, "attempts": 0, "last_sent": db.now(),
    })
    return to


def check_action_code(user, purpose, code):
    row = db.one_row("SELECT * FROM action_codes WHERE user_id = ? AND purpose = ?", (user["id"], purpose))
    if row is None:
        raise HTTPException(status_code=400, detail="Ask for a code first.")
    if row["expires_at"] < db.now():
        raise HTTPException(status_code=400, detail="This code has expired. Ask for a new one.")
    if row["attempts"] >= CODE_TRIES:
        raise HTTPException(status_code=429, detail="Too many wrong codes. Ask for a new one.")
    clean = re.sub(r"\D", "", code or "")
    if not hmac.compare_digest(hash_code(clean, row["salt"]), row["code_hash"]):
        db.execute("UPDATE action_codes SET attempts = attempts + 1 WHERE id = ?", (row["id"],))
        left = CODE_TRIES - row["attempts"] - 1
        raise HTTPException(status_code=400, detail="That code is not right. " + str(max(left, 0)) + " tries left.")
    db.execute("DELETE FROM action_codes WHERE id = ?", (row["id"],))
    return row


def when():
    return time.strftime("%d %B %Y, %H:%M UTC", time.gmtime())


def new_sign_in(user, ip, agent):
    paragraphs = [
        "Hi " + notify.first_name(user) + ", your Forkwise account was just used to sign in from a device we have not seen before.",
        "<b>Device:</b> " + html.escape(short_agent(agent)) + "<br><b>Network:</b> " + html.escape(masked_ip(ip)) + "<br><b>Time:</b> " + when(),
        "If this was you, there is nothing to do. If it was not, reset your password now. That signs every other device out.",
    ]
    notify.later(notify.deliver, user["email"], "New sign-in to your Forkwise account", "New sign-in", paragraphs, ("Review security", config.SITE_URL + "/app/settings/security"))


def email_changed(user, old_email, new_email):
    paragraphs = [
        "Hi " + notify.first_name(user) + ", the email address of your Forkwise account was changed from <b>" + html.escape(old_email) + "</b> to <b>" + html.escape(new_email) + "</b>.",
        "If you did not make this change, reply to this email right away so we can lock the account.",
    ]
    notify.later(notify.deliver, old_email, "Your Forkwise email address was changed", "Email address changed", paragraphs)
    notify.later(notify.deliver, new_email, "This is now your Forkwise email", "Email address confirmed", ["Hi " + notify.first_name(user) + ", from now on you sign in to Forkwise with this address."], ("Open Forkwise", config.SITE_URL + "/app"))


def delete_scheduled(user, purge_at):
    day = time.strftime("%d %B %Y", time.gmtime(purge_at))
    paragraphs = [
        "Hi " + notify.first_name(user) + ", your Forkwise account is scheduled for deletion on <b>" + day + "</b>.",
        "Until then you can change your mind: sign in and choose Keep my account. After that date your chats, files, projects and memories are removed for good and cannot be recovered.",
    ]
    notify.later(notify.deliver, user["email"], "Your Forkwise account will be deleted", "Deletion scheduled", paragraphs, ("Keep my account", config.SITE_URL + "/login"))


def delete_cancelled(user):
    paragraphs = ["Hi " + notify.first_name(user) + ", your account is no longer scheduled for deletion. Everything is as you left it."]
    notify.later(notify.deliver, user["email"], "Your Forkwise account is safe", "Deletion cancelled", paragraphs, ("Open Forkwise", config.SITE_URL + "/app"))


def account_deleted(email, name):
    paragraphs = [
        "Hi " + html.escape((name or "there").split(" ")[0]) + ", your Forkwise account and its data have now been deleted.",
        "Thank you for trying Forkwise. You are welcome back any time.",
    ]
    notify.later(notify.deliver, email, "Your Forkwise account was deleted", "Account deleted", paragraphs)


def plugin_installed(user, name):
    settings = db.load_json(user.get("settings"), {})
    if not settings.get("notify_plugins", True):
        return
    paragraphs = ["Hi " + notify.first_name(user) + ", the <b>" + html.escape(name) + "</b> plugin was added to your Forkwise account. Its skills and tools are ready in every new chat."]
    notify.later(notify.deliver, user["email"], "Plugin installed: " + name, "Plugin installed", paragraphs, ("Manage plugins", config.SITE_URL + "/app/plugins"))


async def purge_due():
    from app.routes import admin
    rows = db.all_rows("SELECT * FROM users", ())
    for user in rows:
        settings = db.load_json(user.get("settings"), {})
        due = settings.get("delete_at") or 0
        if due and due < db.now():
            email, name = user["email"], user["name"]
            try:
                await admin.remove_user_data(user["id"])
                account_deleted(email, name)
            except Exception:
                pass
