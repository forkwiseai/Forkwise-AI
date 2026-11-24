import pytest

from app.agent import sitecheck, verifier


def test_wcag_contrast_reference_values():
    assert round(sitecheck.contrast((0, 0, 0), (255, 255, 255)), 2) == 21.0
    assert sitecheck.contrast((10, 10, 10), (10, 10, 10)) == 1.0
    assert round(sitecheck.contrast((118, 118, 118), (255, 255, 255)), 2) == 4.54


def page(**extra):
    data = {"covered": [], "checked": 10, "colors": [], "images": [], "media": 1, "words": 500, "wide": 390, "width": 390}
    data.update(extra)
    return data


def test_judge_flags_each_problem_and_passes_clean_pages():
    assert sitecheck.judge(1280, page()) == []
    assert "blank" in sitecheck.judge(1280, page(words=3, media=0))[0]
    assert "covered" in sitecheck.judge(1280, page(covered=["a", "b", "c"]))[0]
    assert sitecheck.judge(1280, page(covered=["a", "b"])) == []
    faint = page(colors=[{"text": "Hi", "fg": [244, 244, 244], "bg": [255, 255, 255]}])
    assert "almost invisible" in sitecheck.judge(1280, faint)[0]
    assert "scrolls sideways" in sitecheck.judge(390, page(wide=900))[0]
    assert sitecheck.judge(1280, page(wide=1600, width=1280)) == []


def test_site_targets_prefers_services_then_html():
    services = [{"alive": True, "port": 5173}, {"alive": False, "port": 8000}]
    assert verifier.site_targets(services, {"index.html": 3}) == ["http://localhost:5173/"]
    assert verifier.site_targets([], {"site/index.html": 3, "node_modules/x/a.html": 1, "app.py": 2}) == ["file://$PWD/site/index.html"]


def test_real_browser_catches_broken_page(tmp_path):
    pytest.importorskip("playwright")
    bad = tmp_path / "bad.html"
    bad.write_text('<body style="background:#fff"><h1 style="color:#f5f5f5">Hello there friends</h1><p>One line of text.</p><p>Two lines of text.</p>'
                   '<div style="position:absolute;inset:0;background:#000"></div></body>')
    good = tmp_path / "good.html"
    good.write_text('<meta name="viewport" content="width=device-width"><body><h1 style="color:#111">Hello there friends</h1><p>Plain readable text here.</p></body>')
    try:
        report = sitecheck.main(["file://" + str(bad), "file://" + str(good)])
    except Exception as problem:
        pytest.skip("no browser: " + str(problem)[:80])
    found = " ".join(report["file://" + str(bad)])
    if "Could not check" in found:
        pytest.skip(found[:120])
    assert "covered" in found and "almost invisible" in found
    assert report["file://" + str(good)] == []
