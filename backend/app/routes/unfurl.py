"""Link previews for the composer and sent messages: the title, site name, description, picture and icon of a page.

Only public http(s) addresses are fetched (every redirect hop is checked against private and local networks),
at most HEAD_BYTES of the page are read, and results are cached for an hour, failures included, so typing a link
costs one fetch. A page that blocks robots still gets a preview from its address: the site name and its icon.
"""
import html
import re
import time
from collections import OrderedDict
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import HTTPException, Request

from app.agent.web import public_host
from app.routes.auth import current_user

HEAD_BYTES = 512 * 1024
TTL = 3600
CACHE = OrderedDict()
CACHE_SIZE = 600
RECENT = {}
PER_MINUTE = 40
AGENT = "Mozilla/5.0 (compatible; ForkwiseBot/1.0; +https://forkwiseai.com) facebookexternalhit/1.1"
NAMES = {
    "github.com": "GitHub", "chatgpt.com": "ChatGPT", "openai.com": "OpenAI", "x.com": "X", "twitter.com": "X",
    "youtube.com": "YouTube", "youtu.be": "YouTube", "google.com": "Google", "instagram.com": "Instagram",
    "linkedin.com": "LinkedIn", "reddit.com": "Reddit", "wikipedia.org": "Wikipedia", "claude.ai": "Claude",
    "news.ycombinator.com": "Hacker News", "stackoverflow.com": "Stack Overflow", "npmjs.com": "npm", "pypi.org": "PyPI",
}


def site_name(host):
    host = host.lower().removeprefix("www.")
    for known, name in NAMES.items():
        if host == known or host.endswith("." + known):
            return name
    return host


def meta(page, *names):
    for name in names:
        for pattern in (r'<meta[^>]+(?:property|name)=["\']' + re.escape(name) + r'["\'][^>]*content=["\']([^"\']*)["\']',
                        r'<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + re.escape(name) + r'["\']'):
            found = re.search(pattern, page, re.I)
            if found and found.group(1).strip():
                return html.unescape(found.group(1).strip())
    return ""


def icon_of(page, base):
    best = ""
    for tag in re.findall(r"<link[^>]+>", page, re.I):
        rel = re.search(r'rel=["\']([^"\']+)["\']', tag, re.I)
        href = re.search(r'href=["\']([^"\']+)["\']', tag, re.I)
        if not rel or not href:
            continue
        kinds = rel.group(1).lower().split()
        if "apple-touch-icon" in kinds:
            return urljoin(base, html.unescape(href.group(1)))
        if "icon" in kinds and not best:
            best = urljoin(base, html.unescape(href.group(1)))
    return best


def clip(text, size):
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= size else text[: size - 1].rstrip() + "…"


def safe_link(value):
    return value if value.startswith("https://") or value.startswith("http://") else ""


def from_address(url):
    parts = urlparse(url)
    return {"url": url, "host": parts.hostname or "", "site": site_name(parts.hostname or ""), "title": "", "description": "",
            "image": "", "icon": parts.scheme + "://" + (parts.netloc or "") + "/favicon.ico"}


async def read_head(url):
    """The start of the page after following public redirects, and its final address."""
    current = url
    async with httpx.AsyncClient(timeout=6, follow_redirects=False, headers={"User-Agent": AGENT, "Accept": "text/html,*/*;q=0.5", "Accept-Language": "en-US,en;q=0.9,fa;q=0.8"}) as client:
        for _ in range(5):
            parts = urlparse(current)
            if parts.scheme not in ("http", "https") or not parts.hostname or not public_host(parts.hostname):
                raise ValueError("not public")
            async with client.stream("GET", current) as response:
                if response.status_code in (301, 302, 303, 307, 308) and response.headers.get("location"):
                    current = str(httpx.URL(current).join(response.headers["location"]))
                    continue
                if response.status_code >= 400 or "html" not in response.headers.get("content-type", "html"):
                    return current, ""
                chunks = []
                size = 0
                async for chunk in response.aiter_bytes():
                    chunks.append(chunk)
                    size += len(chunk)
                    if size >= HEAD_BYTES or b"</head>" in chunk.lower():
                        break
                return current, b"".join(chunks).decode(response.encoding or "utf-8", "replace")
    raise ValueError("too many redirects")


async def preview(url):
    found = from_address(url)
    try:
        final, page = await read_head(url)
    except (httpx.HTTPError, ValueError, UnicodeError):
        return found
    if not page:
        return found
    found["url"] = final
    title = meta(page, "og:title", "twitter:title")
    if not title:
        tag = re.search(r"<title[^>]*>(.*?)</title>", page, re.I | re.S)
        title = html.unescape(tag.group(1)) if tag else ""
    found["title"] = clip(title, 140)
    found["description"] = clip(meta(page, "og:description", "twitter:description", "description"), 220)
    found["site"] = clip(meta(page, "og:site_name"), 60) or found["site"]
    found["image"] = safe_link(urljoin(final, meta(page, "og:image", "og:image:url", "twitter:image", "twitter:image:src")))
    found["icon"] = safe_link(icon_of(page, final)) or found["icon"]
    return found


def allowed(user_id):
    now = time.time()
    stamps = [stamp for stamp in RECENT.get(user_id, []) if now - stamp < 60]
    if len(stamps) >= PER_MINUTE:
        RECENT[user_id] = stamps
        return False
    stamps.append(now)
    RECENT[user_id] = stamps
    return True


async def unfurl(request: Request, url: str = ""):
    user = current_user(request)
    url = url.strip()
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    parts = urlparse(url)
    if not parts.hostname or "." not in parts.hostname or len(url) > 2000:
        raise HTTPException(status_code=400, detail="Not a link.")
    hit = CACHE.get(url)
    if hit and time.time() - hit[0] < TTL:
        CACHE.move_to_end(url)
        return hit[1]
    if not allowed(user["id"]):
        return from_address(url)
    result = await preview(url)
    CACHE[url] = (time.time(), result)
    while len(CACHE) > CACHE_SIZE:
        CACHE.popitem(last=False)
    return result


def register_routes(app):
    app.add_api_route("/api/unfurl", unfurl, methods=["GET"])
