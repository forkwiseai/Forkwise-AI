import hashlib
import hmac
import html
import sys
import threading
import time
from app import config, db, mailer

BRAND_INK = "#21201e"
BRAND_MUTED = "#6c6962"
BRAND_LINE = "#e7e6e3"
BRAND_BG = "#f4f4f2"
BRAND_GREEN = "#16a34a"
SEND_GAP = 0.6


def key_material():
    wanted = config.text("SECRET_KEY")
    if wanted:
        return hashlib.sha256(("email:" + wanted).encode("utf-8")).digest()
    path = config.DATA_DIR / "secret.key"
    if path.exists():
        return hashlib.sha256(b"email:" + path.read_bytes().strip()).digest()
    from app import vault
    vault.load_key()
    return hashlib.sha256(b"email:" + path.read_bytes().strip()).digest()


def unsubscribe_token(user_id):
    return hmac.new(key_material(), user_id.encode("utf-8"), hashlib.sha256).hexdigest()[:32]


def unsubscribe_link(user_id):
    return config.API_URL + "/api/email/unsubscribe?u=" + user_id + "&t=" + unsubscribe_token(user_id)


def logo_html():
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        '<td style="width:30px;height:30px;border-radius:9px;background:' + BRAND_INK + ';text-align:center;vertical-align:middle">'
        '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#4ade80"></span></td>'
        '<td style="padding-left:10px;font-size:17px;font-weight:700;color:' + BRAND_INK + ';font-family:Arial,Helvetica,sans-serif">Forkwise</td>'
        "</tr></table>"
    )


def layout(title, paragraphs, button=None, footer_note="", unsubscribe=""):
    body = ""
    for text in paragraphs:
        body = body + '<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:' + BRAND_MUTED + '">' + text + "</p>"
    if button:
        body = body + (
            '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px"><tr><td style="border-radius:10px;background:' + BRAND_INK + '">'
            '<a href="' + html.escape(button[1], quote=True) + '" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif">'
            + html.escape(button[0]) + "</a></td></tr></table>"
        )
    foot = "You are receiving this because you have a Forkwise account."
    if footer_note:
        foot = footer_note
    if unsubscribe:
        foot = foot + ' <a href="' + html.escape(unsubscribe, quote=True) + '" style="color:' + BRAND_MUTED + '">Stop product emails</a>.'
    return (
        '<div style="margin:0;padding:32px 12px;background:' + BRAND_BG + ';font-family:Arial,Helvetica,sans-serif">'
        '<div style="max-width:520px;margin:0 auto">'
        '<div style="padding:0 4px 18px">' + logo_html() + "</div>"
        '<div style="background:#ffffff;border:1px solid ' + BRAND_LINE + ';border-radius:16px;padding:32px 30px">'
        '<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:' + BRAND_INK + '">' + html.escape(title) + "</h1>"
        + body +
        "</div>"
        '<div style="padding:18px 4px 0;font-size:12px;line-height:1.6;color:#8e8a83">' + foot + "<br>Forkwise &middot; forkwiseai.com</div>"
        "</div></div>"
    )


def plain(title, paragraphs, button=None, unsubscribe=""):
    lines = [title, ""]
    for text in paragraphs:
        lines.append(strip_tags(text))
        lines.append("")
    if button:
        lines.append(button[0] + ": " + button[1])
        lines.append("")
    if unsubscribe:
        lines.append("Stop product emails: " + unsubscribe)
    return "\n".join(lines)


def strip_tags(text):
    out = ""
    inside = False
    for char in text:
        if char == "<":
            inside = True
        elif char == ">":
            inside = False
        elif not inside:
            out = out + char
    return html.unescape(out)


def deliver(to, subject, title, paragraphs, button=None, unsubscribe=""):
    if not mailer.ready():
        return False
    page = layout(title, paragraphs, button, unsubscribe=unsubscribe)
    text = plain(title, paragraphs, button, unsubscribe)
    try:
        return mailer.send(to, subject, text, page)
    except Exception as problem:
        print("NOTIFY FAILED " + subject + " to " + to + ": " + str(problem), file=sys.stderr, flush=True)
        return False


def later(function, *args):
    threading.Thread(target=function, args=args, daemon=True).start()


def first_name(user):
    name = (user.get("name") or "").strip()
    if not name:
        return "there"
    return html.escape(name.split(" ")[0])


def welcome(user):
    paragraphs = [
        "Hi " + first_name(user) + ", welcome to Forkwise.",
        "Forkwise is an AI engineer with its own computer. Ask it to build a website, analyse a spreadsheet, check a live price or automate a task, and it does the work and shows you the result.",
        "A good first message: <b>Build me a landing page for my business</b>, or <b>What is the dollar rate today?</b>",
    ]
    later(deliver, user["email"], "Welcome to Forkwise", "Your account is ready", paragraphs, ("Open Forkwise", config.SITE_URL + "/app"))


def plan_started(user, plan, until):
    name = plan.capitalize()
    day = time.strftime("%d %B %Y", time.gmtime(until))
    paragraphs = [
        "Hi " + first_name(user) + ", thank you for your payment.",
        "Your <b>" + html.escape(name) + "</b> plan is active until <b>" + day + "</b>. Your daily usage limit has been raised already.",
    ]
    later(deliver, user["email"], "Your Forkwise " + name + " plan is active", name + " plan is active", paragraphs, ("See your plan", config.SITE_URL + "/app/billing"))


def plan_given(user, plan, until):
    if plan == "free":
        return
    plan_started_by_admin(user, plan, until)


def plan_started_by_admin(user, plan, until):
    name = plan.capitalize()
    day = time.strftime("%d %B %Y", time.gmtime(until))
    paragraphs = [
        "Hi " + first_name(user) + ", the Forkwise team gave your account the <b>" + html.escape(name) + "</b> plan.",
        "It is active until <b>" + day + "</b>.",
    ]
    later(deliver, user["email"], "You now have Forkwise " + name, name + " plan added", paragraphs, ("Open Forkwise", config.SITE_URL + "/app"))


def password_changed(user):
    paragraphs = [
        "Hi " + first_name(user) + ", the password of your Forkwise account was just changed.",
        "If this was you, there is nothing to do. If it was not, reset your password now and check your account.",
    ]
    later(deliver, user["email"], "Your Forkwise password was changed", "Password changed", paragraphs, ("Reset password", config.SITE_URL + "/forgot"))


def contact_received(name, email, topic, message):
    paragraphs = [
        "Hi " + html.escape((name or "there").split(" ")[0]) + ", thanks for writing to us. We read every message and usually reply within one working day.",
        "Your message" + (" about <b>" + html.escape(topic) + "</b>" if topic else "") + ":",
        '<span style="display:block;padding:12px 14px;border-left:3px solid ' + BRAND_LINE + ';color:' + BRAND_INK + ';white-space:pre-wrap">' + html.escape(message[:2000]) + "</span>",
    ]
    later(deliver, email, "We got your message", "We got your message", paragraphs)
    for admin in config.ADMIN_EMAILS[:3]:
        lines = ["<b>" + html.escape(name) + "</b> &lt;" + html.escape(email) + "&gt; wrote about <b>" + html.escape(topic or "General") + "</b>:",
                 '<span style="display:block;white-space:pre-wrap;color:' + BRAND_INK + '">' + html.escape(message[:5000]) + "</span>"]
        later(deliver, admin, "Contact: " + (topic or "General") + " from " + name, "New contact message", lines, ("Open admin", config.SITE_URL + "/app/admin"))


def wants_updates(user):
    settings = db.load_json(user.get("settings"), {})
    return settings.get("email_updates", True) is not False


def audience(kind):
    rows = db.all_rows("SELECT * FROM users WHERE verified = 1 ORDER BY created_at", ())
    picked = []
    for user in rows:
        if kind == "paid" and (user.get("plan") or "free") == "free":
            continue
        if kind == "free" and (user.get("plan") or "free") != "free":
            continue
        if not wants_updates(user):
            continue
        picked.append(user)
    return picked


def announcement_paragraphs(body):
    paragraphs = []
    for block in body.replace("\r\n", "\n").split("\n\n"):
        block = block.strip()
        if block:
            paragraphs.append(html.escape(block).replace("\n", "<br>"))
    return paragraphs


def send_announcement(users, subject, title, body, button_label, button_url):
    button = (button_label, button_url) if button_label and button_url else None
    sent = 0
    for user in users:
        if deliver(user["email"], subject, title or subject, announcement_paragraphs(body), button, unsubscribe_link(user["id"])):
            sent = sent + 1
        time.sleep(SEND_GAP)
    print("ANNOUNCEMENT sent " + str(sent) + " of " + str(len(users)) + ": " + subject, flush=True)
