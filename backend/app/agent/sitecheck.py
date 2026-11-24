"""Opens the site the agent built in a real browser, at desktop and phone width, and reports what a person would see
is broken. The code verifier only knows that the build passed and the port answers; a page can do both and still
be blank, unreadable or broken.

Checks (each is a measurement, not a judgement):
- HTTP error or load failure; uncaught JavaScript errors; same-site files that answer 4xx/5xx
- blank page: almost no visible text and no picture or canvas
- broken pictures: loaded with natural width 0
- covered text: the element at the centre of a visible text box is neither the box nor inside it
- unreadable text: WCAG contrast ratio of text colour to the nearest solid background below MIN_CONTRAST
- phone layout: page wider than the 390 px screen

Copied into the sandbox and run there with `python3 sitecheck.py URL...`; prints one JSON line."""

import json
import sys

MIN_CONTRAST = 2.0
COVERED_SHARE = 0.10
COVERED_MIN = 3
WIDTHS = (1280, 390)


def channel(value):
    value = value / 255
    return value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4


def luminance(rgb):
    return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])


def contrast(a, b):
    """WCAG 2 contrast ratio, 1 (same colour) to 21 (black on white)."""
    high, low = sorted((luminance(a), luminance(b)), reverse=True)
    return (high + 0.05) / (low + 0.05)


AUDIT = r"""
() => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(s => parseFloat(s)); return {r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1}; };
  const vis = el => { const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) === 0) return false; const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  const background = el => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.backgroundImage && s.backgroundImage !== 'none') return null; const c = parse(s.backgroundColor); if (c && c.a >= 0.95) return c; } return {r: 255, g: 255, b: 255, a: 1}; };
  const own = el => Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
  const texts = Array.from(document.body ? document.body.querySelectorAll('*') : []).filter(el => own(el).length >= 2 && vis(el) && !['SCRIPT','STYLE','NOSCRIPT','OPTION'].includes(el.tagName));
  const W = innerWidth, H = innerHeight;
  let covered = [], checked = 0, colors = [];
  for (const el of texts) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x >= 0 && y >= 0 && x < W && y < H) {
      checked++;
      const top = document.elementFromPoint(x, y);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) covered.push(own(el).slice(0, 40));
    }
    const bg = background(el), fg = parse(getComputedStyle(el).color);
    if (bg && fg && fg.a > 0.5 && colors.length < 400) colors.push({text: own(el).slice(0, 40), fg: [fg.r, fg.g, fg.b], bg: [bg.r, bg.g, bg.b]});
  }
  const images = Array.from(document.images).filter(i => i.complete && i.naturalWidth === 0 && vis(i)).map(i => (i.getAttribute('src') || '').slice(0, 80));
  const media = document.querySelectorAll('img, canvas, svg, video').length;
  const words = (document.body ? document.body.innerText : '').trim().length;
  const wide = document.scrollingElement ? document.scrollingElement.scrollWidth : 0;
  return {covered, checked, colors, images, media, words, wide, width: W};
}
"""


def judge(width, data):
    """Turns one page measurement into problem sentences."""
    where = "at " + str(width) + " px: "
    found = []
    if data["words"] < 20 and data["media"] == 0:
        found.append(where + "the page is blank (" + str(data["words"]) + " characters of text, no pictures).")
    if data["images"]:
        found.append(where + str(len(data["images"])) + " picture(s) failed to load: " + ", ".join(data["images"][:5]))
    covered = data["covered"]
    if len(covered) >= COVERED_MIN and len(covered) >= COVERED_SHARE * max(1, data["checked"]):
        found.append(where + str(len(covered)) + " of " + str(data["checked"]) + " text blocks on screen are covered by another element, e.g. \"" + "\", \"".join(covered[:3]) + "\". Check z-index, position:absolute/fixed overlays and negative margins.")
    bad = []
    for item in data["colors"]:
        ratio = contrast(item["fg"], item["bg"])
        if ratio < MIN_CONTRAST:
            bad.append((round(ratio, 2), item["text"]))
    if bad:
        bad.sort()
        found.append(where + str(len(bad)) + " text block(s) are almost invisible against their background (contrast " + str(bad[0][0]) + ":1, readable text needs at least 4.5:1), e.g. \"" + bad[0][1] + "\".")
    if width < 600 and data["wide"] > data["width"] + 2:
        found.append(where + "the page is " + str(data["wide"]) + " px wide on a " + str(data["width"]) + " px phone screen, so it scrolls sideways. Find the element wider than the screen.")
    return found


def check(url, player):
    from urllib.parse import urlparse
    problems = []
    browser = player.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
    host = urlparse(url).netloc
    try:
        for width in WIDTHS:
            page = browser.new_page(viewport={"width": width, "height": 844 if width < 600 else 800})
            errors = []
            failed = []
            page.on("pageerror", lambda error: errors.append(str(error)[:200]))
            page.on("response", lambda response: failed.append(str(response.status) + " " + response.url[:120]) if response.status >= 400 and urlparse(response.url).netloc == host else None)
            try:
                response = page.goto(url, wait_until="networkidle", timeout=30000)
                if response is not None and response.status >= 400:
                    problems.append(url + " answers HTTP " + str(response.status) + ".")
                    page.close()
                    break
            except Exception as problem:
                problems.append(url + " did not load: " + str(problem)[:200])
                page.close()
                break
            page.wait_for_timeout(600)
            data = page.evaluate(AUDIT)
            page.close()
            if width == WIDTHS[0]:
                if errors:
                    problems.append("JavaScript error on " + url + ": " + errors[0])
                if failed:
                    problems.append("Files of " + url + " are missing: " + "; ".join(failed[:4]))
            problems.extend(url + " " + item for item in judge(width, data))
    finally:
        browser.close()
    return problems


def main(urls):
    from playwright.sync_api import sync_playwright
    report = {}
    with sync_playwright() as player:
        for url in urls:
            try:
                report[url] = check(url, player)
            except Exception as problem:
                report[url] = ["Could not check " + url + ": " + type(problem).__name__ + ": " + str(problem)[:160]]
    return report


if __name__ == "__main__":
    print(json.dumps(main(sys.argv[1:]), ensure_ascii=False))
