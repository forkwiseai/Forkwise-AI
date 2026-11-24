import html
import ipaddress
import re
import socket
from urllib.parse import urlparse, unquote, quote_plus
import httpx
from app import config

AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
MAX_BYTES = 3 * 1024 * 1024


def clean(text):
    text = re.sub(r"<[^>]+>", "", text or "")
    return html.unescape(re.sub(r"\s+", " ", text)).strip()


async def get(url, params=None, data=None):
    headers = {"User-Agent": AGENT, "Accept-Language": "en-US,en;q=0.9,fa;q=0.8"}
    async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers=headers) as client:
        if data is not None:
            return await client.post(url, data=data)
        return await client.get(url, params=params)


async def get_public(url):
    headers = {"User-Agent": AGENT, "Accept-Language": "en-US,en;q=0.9,fa;q=0.8"}
    current = url
    async with httpx.AsyncClient(timeout=20, follow_redirects=False, headers=headers) as client:
        for hop in range(6):
            parts = urlparse(current)
            if parts.scheme not in ["http", "https"] or not parts.hostname:
                raise ValueError("Only http and https links can be opened.")
            if not public_host(parts.hostname):
                raise ValueError("This address is private and cannot be opened.")
            response = await client.get(current)
            if response.status_code in [301, 302, 303, 307, 308] and response.headers.get("location"):
                current = str(httpx.URL(current).join(response.headers["location"]))
                continue
            return response
    raise ValueError("Too many redirects.")


async def brave(query):
    headers = {"X-Subscription-Token": config.SEARCH_API_KEY, "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get("https://api.search.brave.com/res/v1/web/search", params={"q": query, "count": 10}, headers=headers)
    results = []
    if response.status_code != 200:
        return results
    for item in (response.json().get("web") or {}).get("results") or []:
        results.append({"title": clean(item.get("title")), "url": item.get("url", ""), "snippet": clean(item.get("description"))})
    return results


async def searxng(query):
    response = await get(config.SEARXNG_URL + "/search", params={"q": query, "format": "json"})
    results = []
    if response.status_code != 200:
        return results
    for item in response.json().get("results", [])[:10]:
        results.append({"title": clean(item.get("title")), "url": item.get("url", ""), "snippet": clean(item.get("content"))})
    return results


async def duckduckgo(query):
    response = await get("https://html.duckduckgo.com/html/", data={"q": query})
    results = []
    if response.status_code != 200:
        return results
    page = response.text
    links = re.findall(r'<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', page, re.S)
    snippets = re.findall(r'class="result__snippet"[^>]*>(.*?)</a>', page, re.S)
    position = 0
    for link, title in links:
        url = html.unescape(link)
        if "uddg=" in url:
            url = unquote(url.split("uddg=")[1].split("&")[0])
        snippet = ""
        if position < len(snippets):
            snippet = clean(snippets[position])
        position = position + 1
        if url.startswith("http"):
            results.append({"title": clean(title), "url": url, "snippet": snippet})
    return results


def bing_target(url):
    """Bing sometimes wraps result links as bing.com/ck/a?...&u=a1<base64url>; returns the real address."""
    import base64
    if "bing.com/ck/a" not in url:
        return url
    found = re.search(r"[?&]u=a1([^&]+)", url)
    if not found:
        return url
    data = found.group(1)
    try:
        return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", "replace")
    except (ValueError, UnicodeDecodeError):
        return url


async def bing(query):
    params = {"q": query}
    if is_persian(query):
        params["setlang"] = "fa"
    response = await get("https://www.bing.com/search", params=params)
    results = []
    if response.status_code != 200:
        return results
    for block in re.findall(r'<li class="b_algo"(.*?)</li>', response.text, re.S):
        found = re.search(r'<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
        if not found:
            continue
        snippet = re.search(r"<p[^>]*>(.*?)</p>", block, re.S)
        text = ""
        if snippet:
            text = clean(snippet.group(1))
        results.append({"title": clean(found.group(2)), "url": bing_target(html.unescape(found.group(1))), "snippet": text})
    return results


async def wikipedia(query):
    """Encyclopedia hits in the query's language: few, but almost never off-topic."""
    lang = "fa" if is_persian(query) else "en"
    response = await get("https://" + lang + ".wikipedia.org/w/api.php", params={"action": "query", "list": "search", "srsearch": query, "format": "json", "srlimit": 5, "utf8": 1})
    results = []
    if response.status_code != 200:
        return results
    for item in ((response.json().get("query") or {}).get("search") or []):
        title = item.get("title", "")
        results.append({"title": title, "url": "https://" + lang + ".wikipedia.org/wiki/" + quote_plus(title.replace(" ", "_")).replace("%2F", "/"), "snippet": clean(item.get("snippet"))})
    return results


# ---- Ranking -------------------------------------------------------------------------------------------------
# Each engine alone is noisy: the old search returned whatever the first engine that answered gave, ads and
# off-topic pages included. Now every engine runs at once and the lists are fused with Reciprocal Rank Fusion,
#     rrf(d) = sum over engines e of 1 / (K + rank_e(d)),   K = 60   (Cormack, Clarke & Buettcher, SIGIR 2009)
# which rewards a page several engines agree on without trusting any one engine's scores. Then each result is
# checked against the query itself: coverage = share of the query's distinct terms found in title + snippet
# (after Persian/Arabic letter normalisation). The final score is rrf * (0.35 + coverage); results with zero
# coverage are dropped whenever at least three results do cover the query, which removes the unrelated hits.

RRF_K = 60
STOP = {"the", "a", "an", "of", "and", "or", "in", "on", "for", "to", "is", "are", "what", "how", "who", "with", "by",
        "از", "و", "در", "به", "که", "را", "با", "این", "آن", "برای", "یک", "چه", "چی", "است", "هست", "می", "ها"}
AD_HOSTS = ("duckduckgo.com/y.js", "bing.com/aclick", "doubleclick.net", "googleadservices.com")


def is_persian(text):
    return bool(re.search(r"[\u0600-\u06FF]", text or ""))


def normalize(text):
    text = (text or "").lower()
    text = text.replace("ي", "ی").replace("ك", "ک").replace("ة", "ه").replace("\u200c", " ").replace("ـ", "")
    text = re.sub(r"[\u064B-\u065F]", "", text)  # Arabic diacritics
    return text


def terms(text):
    words = re.findall(r"[\w\u0600-\u06FF]+", normalize(text))
    return [word for word in words if word not in STOP and (len(word) > 1 or word.isdigit())]


def coverage(query_terms, result):
    if not query_terms:
        return 1.0
    haystack = normalize(result.get("title", "") + " " + result.get("snippet", "") + " " + unquote(result.get("url", "")))
    compact = haystack.replace(" ", "")
    hits = 0
    for term in query_terms:
        if len(term) >= 5 and term in compact:
            hits += 1  # "زندگینامه" matches "زندگی‌نامه" once the half-space is gone
            continue
        # prefix match covers simple inflections ("شهید" in "شهیدان", "build" in "building")
        if re.search(r"(?<![\w\u0600-\u06FF])" + re.escape(term[:max(3, len(term) - 2)] if len(term) > 5 else term), haystack):
            hits += 1
    return hits / len(query_terms)


def url_key(url):
    parts = urlparse(url)
    host = (parts.hostname or "").replace("www.", "").replace("m.", "", 1) if parts.hostname else ""
    return host + parts.path.rstrip("/").lower()


def fuse(query, lists):
    query_terms = list(dict.fromkeys(terms(query)))
    merged = {}
    for engine_results in lists:
        for rank, item in enumerate(engine_results, start=1):
            url = item.get("url", "")
            if not url.startswith("http") or any(ad in url for ad in AD_HOSTS):
                continue
            key = url_key(url)
            entry = merged.get(key)
            if entry is None:
                entry = dict(item)
                entry["rrf"] = 0.0
                merged[key] = entry
            elif len(item.get("snippet", "")) > len(entry.get("snippet", "")):
                entry["snippet"] = item["snippet"]
            entry["rrf"] += 1.0 / (RRF_K + rank)
    ranked = list(merged.values())
    for entry in ranked:
        entry["coverage"] = round(coverage(query_terms, entry), 3)
        entry["score"] = entry["rrf"] * (0.35 + entry["coverage"])
    ranked.sort(key=lambda entry: entry["score"], reverse=True)
    covered = [entry for entry in ranked if entry["coverage"] > 0]
    if len(covered) >= 3:
        ranked = covered
    for entry in ranked:
        entry.pop("rrf", None)
        entry.pop("score", None)
    return ranked


async def search(query):
    import asyncio
    engines = []
    if config.SEARXNG_URL:
        engines.append(searxng)
    if config.SEARCH_API_KEY:
        engines.append(brave)
    engines.extend([duckduckgo, bing, wikipedia])
    problems = []

    async def run(engine):
        try:
            return await asyncio.wait_for(engine(query), timeout=12)
        except Exception as problem:
            problems.append(engine.__name__ + ": " + (str(problem)[:80] or type(problem).__name__))
            return []

    lists = await asyncio.gather(*(run(engine) for engine in engines))
    results = fuse(query, lists)
    if results:
        return results[:10]
    raise RuntimeError("Search failed (" + ("; ".join(problems) or "no engine found anything") + ")")


def public_host(host):
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        address = ipaddress.ip_address(info[4][0].split("%")[0])
        if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved or address.is_multicast or address.is_unspecified:
            return False
    return True


def page_text(page):
    title = ""
    found = re.search(r"<title[^>]*>(.*?)</title>", page, re.S | re.I)
    if found:
        title = clean(found.group(1))
    page = re.sub(r"(?is)<(script|style|noscript|svg|iframe|head)[^>]*>.*?</\1>", " ", page)
    page = re.sub(r"(?is)<a[^>]*href=\"(http[^\"]+)\"[^>]*>(.*?)</a>", r"\2 (\1)", page)
    page = re.sub(r"(?i)<br\s*/?>", "\n", page)
    page = re.sub(r"(?i)</(p|div|li|tr|h[1-6]|section|article|table)>", "\n", page)
    page = re.sub(r"(?i)<(td|th)[^>]*>", " | ", page)
    page = re.sub(r"(?i)<li[^>]*>", "\n- ", page)
    page = re.sub(r"(?i)<h([1-6])[^>]*>", "\n\n## ", page)
    page = re.sub(r"<[^>]+>", " ", page)
    page = html.unescape(page)
    lines = []
    for line in page.split("\n"):
        line = re.sub(r"[ \t ]+", " ", line).strip()
        if line:
            lines.append(line)
    return title, "\n".join(lines)


async def fetch(url, max_chars=20000):
    if not url.startswith("http"):
        url = "https://" + url
    parts = urlparse(url)
    if parts.scheme not in ["http", "https"] or not parts.hostname:
        raise ValueError("Only http and https links can be opened.")
    response = await get_public(url)
    kind = response.headers.get("content-type", "")
    raw = response.content[:MAX_BYTES]
    text = raw.decode(response.encoding or "utf-8", "replace")
    if "json" in kind or "text/plain" in kind or "csv" in kind or "xml" in kind and "html" not in kind:
        title = url
        body = text
    else:
        title, body = page_text(text)
    if len(body) > max_chars:
        body = body[:max_chars] + "\n\n[page cut at " + str(max_chars) + " characters]"
    return {"url": str(response.url), "status": response.status_code, "title": title, "text": body}


def search_link(query):
    return "https://duckduckgo.com/?q=" + quote_plus(query)
