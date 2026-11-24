import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sandbox"))

from app import pricing
from app.agent import leaks, toolcatalog, web, sitecheck, docscheck


def test_free_host_and_free_flag_cost_nothing():
    nvidia = {"id": "nvidia/nemotron-3-super-120b-a12b", "url": "https://integrate.api.nvidia.com/v1"}
    assert pricing.cost(nvidia["id"], 200_000, 20_000, model=nvidia) == 0.0
    assert pricing.model_tier(nvidia["id"], nvidia) == "free"
    groq = {"id": "openai/gpt-oss-120b", "url": "https://api.groq.com/openai/v1", "free": True}
    assert pricing.cost(groq["id"], 10**6, 10**6, model=groq) == 0.0
    paid = {"id": "nemotron-3.5-super", "url": "https://openrouter.ai/api/v1"}
    # an unknown Nemotron on a paid host is priced as Nemotron, not as the $2/$10 fallback
    assert pricing.cost(paid["id"], 1_000_000, 0, model=paid) == 0.10


def test_quoted_numbers_are_coerced():
    spec = {"function": {"parameters": {"properties": {"port": {"type": "integer"}, "start": {"type": "boolean"}}}}}
    args = {"port": "8000", "start": "false"}
    toolcatalog.coerce(spec, args)
    assert args == {"port": 8000, "start": False}
    assert toolcatalog.problems(spec, args) == []


def test_bare_text_tool_call_is_recovered():
    text = 'Here it is:\n\nshow_file {"path": "/workspace/deck.pptx", "caption": "deck"}\n'
    calls, cleaned = leaks.bare_calls(text, ["show_file", "bash"])
    assert calls[0]["name"] == "show_file" and "deck.pptx" in calls[0]["arguments"]
    assert "show_file" not in cleaned
    assert leaks.bare_calls("I will call show_file next.", ["show_file"])[0] == []
    assert leaks.announced_only("checking:\n[ \\text{Calling bash...} ]")


def test_search_fusion_drops_unrelated_results():
    query = "شهید باهنر زندگینامه"
    lists = [
        [{"title": "قیمت خودرو امروز", "url": "https://cars.example/x", "snippet": "بازار خودرو"},
         {"title": "زندگی‌نامه شهید باهنر", "url": "https://a.example/b", "snippet": "شهید محمدجواد باهنر"}],
        [{"title": "محمدجواد باهنر", "url": "https://fa.wikipedia.org/wiki/x", "snippet": "شهيد باهنر"},
         {"title": "باهنر", "url": "https://www.a.example/b/", "snippet": ""},
         {"title": "شهید", "url": "https://c.example", "snippet": "باهنر"}],
    ]
    ranked = web.fuse(query, lists)
    urls = [item["url"] for item in ranked]
    assert "https://cars.example/x" not in urls
    assert urls[0] == "https://a.example/b"  # both engines agree on it, so it ranks first
    assert len(urls) == 3  # the duplicate with www. and a trailing slash is merged


def test_collapsed_page_is_reported():
    data = {"words": 400, "media": 0, "images": [], "covered": [], "checked": 10, "colors": [], "wide": 1280, "width": 1280, "height": 800, "gap": 0}
    assert any("collapsed" in item for item in sitecheck.judge(1280, data))
    data["gap"] = 500
    assert not any("collapsed" in item for item in sitecheck.judge(1280, data))


def test_deckkit_writes_animations_powerpoint_accepts(tmp_path):
    from pptx import Presentation
    import deckkit
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = "عنوان"
    slide.placeholders[1].text = "متن"
    deckkit.rtl(slide.placeholders[1])
    deckkit.animate(slide, slide.shapes.title, "rise")
    deckkit.transition(slide, "push")  # added after the timing on purpose: it must still land before it
    deckkit.animate(slide, [slide.placeholders[1]], "fly", direction="left", stagger=150)
    path = tmp_path / "deck.pptx"
    assert deckkit.save(prs, str(path)) == []
    assert deckkit.stats(str(path)) == {"slides": 1, "slides_with_animation": 1, "slides_with_transition": 1}
    assert docscheck.check(str(path), wants_animation=True) == []


def test_docscheck_flags_wrong_slide_order(tmp_path):
    from pptx import Presentation
    from lxml import etree
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    slide.shapes.title.text = "Title"
    transition = etree.fromstring('<p:transition xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:fade/></p:transition>')
    slide._element.insert(0, transition)  # the bug from the martyr deck: transition before cSld
    path = tmp_path / "bad.pptx"
    prs.save(str(path))
    problems = docscheck.check(str(path), wants_animation=True)
    assert any("wrong order" in item for item in problems)
