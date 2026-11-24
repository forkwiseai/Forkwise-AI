import pytest
from app.agent import docscheck


def test_union_area_exact():
    assert docscheck.union_area([(0, 0, 10, 10)]) == 100
    assert docscheck.union_area([(0, 0, 10, 10), (5, 5, 15, 15)]) == 175
    assert docscheck.union_area([(0, 0, 10, 10), (0, 0, 10, 10)]) == 100
    assert docscheck.union_area([(0, 0, 4, 4), (1, 1, 2, 2)]) == 16
    assert docscheck.union_area([]) == 0


def test_visible_fraction():
    box = (0, 0, 10, 10)
    assert docscheck.visible_fraction(box, []) == 1.0
    assert docscheck.visible_fraction(box, [(0, 0, 10, 10)]) == 0.0
    assert docscheck.visible_fraction(box, [(0, 0, 5, 10)]) == 0.5
    assert docscheck.visible_fraction(box, [(20, 20, 30, 30)]) == 1.0


def test_wants_animation_words():
    assert docscheck.wants_animation("make it animated with transitions")
    assert docscheck.wants_animation("انیمیشن خفن داشته باشه")
    assert not docscheck.wants_animation("a plain five slide deck")


def make_deck(path, picture_first):
    pptx = pytest.importorskip("pptx")
    from PIL import Image
    Image.new("RGB", (64, 36), (20, 20, 40)).save(str(path) + ".png")
    prs = pptx.Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = "Visible title"
    slide.placeholders[1].text_frame.text = "Visible body"
    picture = slide.shapes.add_picture(str(path) + ".png", 0, 0, width=prs.slide_width, height=prs.slide_height)
    if picture_first:
        tree = slide.shapes._spTree
        tree.remove(picture._element)
        tree.insert(2, picture._element)
    prs.save(str(path))


def test_picture_over_text_is_caught(tmp_path):
    bad = tmp_path / "bad.pptx"
    make_deck(bad, False)
    found = docscheck.check(str(bad))
    assert len(found) == 2 and all("hidden under a picture" in item for item in found)


def test_picture_behind_text_passes(tmp_path):
    good = tmp_path / "good.pptx"
    make_deck(good, True)
    assert docscheck.check(str(good)) == []


def test_missing_animation_is_caught_only_when_asked(tmp_path):
    good = tmp_path / "good.pptx"
    make_deck(good, True)
    assert docscheck.check(str(good), wants_animation=False) == []
    asked = docscheck.check(str(good), wants_animation=True)
    assert len(asked) == 1 and "no slide transitions" in asked[0]
