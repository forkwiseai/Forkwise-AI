import asyncio

from app.routes import unfurl

PAGE = """<html><head><title>ignored</title>
<meta property="og:title" content="hoomanyyy - Overview" />
<meta content="Builds Forkwise &amp; more" property="og:description">
<meta property="og:site_name" content="GitHub">
<meta property="og:image" content="/avatars/u/1.png">
<link rel="icon" href="/favicon.svg"><link rel="apple-touch-icon" href="https://cdn.example.com/apple.png">
</head><body></body></html>"""


def test_preview_reads_open_graph(monkeypatch):
    async def fake(url):
        return url, PAGE
    monkeypatch.setattr(unfurl, "read_head", fake)
    found = asyncio.run(unfurl.preview("https://github.com/hoomanyyy"))
    assert found["title"] == "hoomanyyy - Overview"
    assert found["description"] == "Builds Forkwise & more"
    assert found["image"] == "https://github.com/avatars/u/1.png"
    assert found["icon"] == "https://cdn.example.com/apple.png"
    assert found["site"] == "GitHub"


def test_blocked_page_falls_back_to_address(monkeypatch):
    async def fail(url):
        raise ValueError("not public")
    monkeypatch.setattr(unfurl, "read_head", fail)
    found = asyncio.run(unfurl.preview("https://chatgpt.com/"))
    assert found["site"] == "ChatGPT" and found["title"] == "" and found["icon"] == "https://chatgpt.com/favicon.ico"


def test_private_addresses_are_refused():
    for url in ["http://127.0.0.1:5000/", "http://localhost/", "http://169.254.169.254/latest/meta-data"]:
        try:
            asyncio.run(unfurl.read_head(url))
            assert False, url
        except ValueError:
            pass
