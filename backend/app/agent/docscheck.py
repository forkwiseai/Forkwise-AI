"""Exact checks for document files the agent makes (pptx, pdf, docx).

The code verifier only looks at software projects. A deck built by a script never reaches it, so a deck
whose pictures cover its own text, or one with no animation when the user asked for animation, was reported
as finished. These checks are plain geometry and counting, so a small model gets the same strict answer a large
one would: no judgement, no rendering needed.

This file is also copied into the sandbox and run there with `python3 docscheck.py FILE...`,
so it only uses the standard library plus python-pptx / python-docx when they are installed."""

import json
import re
import subprocess
import sys
import zipfile

DOC_TYPES = (".pptx", ".pdf", ".docx")
MIN_VISIBLE = 0.5
MIN_TEXT_PAGES = 0.5
ANIMATION_WORDS = re.compile(r"anim|transition|motion|fade|انیمیشن|انیمه|انتقال|متحرک|حرکت", re.I)
OPAQUE = 0.95


def union_area(rects):
    """Exact area of the union of axis-aligned rectangles (x0, y0, x1, y1), by coordinate compression."""
    rects = [r for r in rects if r[2] > r[0] and r[3] > r[1]]
    if not rects:
        return 0
    xs = sorted(set(value for r in rects for value in (r[0], r[2])))
    total = 0
    for left, right in zip(xs, xs[1:]):
        spans = sorted((r[1], r[3]) for r in rects if r[0] <= left and r[2] >= right)
        covered = 0
        end = None
        start = None
        for low, high in spans:
            if end is None or low > end:
                if end is not None:
                    covered += end - start
                start, end = low, high
            elif high > end:
                end = high
        if end is not None:
            covered += end - start
        total += covered * (right - left)
    return total


def visible_fraction(box, covers):
    """Share of the box (x0, y0, x1, y1) that no later opaque shape sits on top of."""
    area = (box[2] - box[0]) * (box[3] - box[1])
    if area <= 0:
        return 1.0
    clipped = []
    for cover in covers:
        piece = (max(box[0], cover[0]), max(box[1], cover[1]), min(box[2], cover[2]), min(box[3], cover[3]))
        if piece[2] > piece[0] and piece[3] > piece[1]:
            clipped.append(piece)
    return 1.0 - union_area(clipped) / area


def opacity(shape):
    """1.0 when the shape paints solid, less when its fill has an alpha value. Pictures count as solid."""
    try:
        element = shape._element
        values = element.xpath(".//a:solidFill//a:alpha/@val")
        if values:
            return int(values[0]) / 100000
        if shape.shape_type == 13:
            return 1.0
        if element.xpath("./p:spPr/a:solidFill") or element.xpath("./p:spPr/a:gradFill"):
            return 1.0
    except Exception:
        return 0.0
    return 0.0


def bounds(shape):
    if shape.left is None or shape.top is None or shape.width is None or shape.height is None:
        return None
    return (int(shape.left), int(shape.top), int(shape.left + shape.width), int(shape.top + shape.height))


SLIDE_ORDER = ["cSld", "clrMapOvr", "transition", "timing", "extLst"]


def slide_xml_problems(number, xml):
    """Structure errors that make PowerPoint refuse the file or 'repair' it (and drop the animations).
    The schema (ECMA-376 CT_Slide) fixes the order cSld, clrMapOvr, transition, timing, extLst; every animation
    target spid must be a shape on the slide; shape ids and timing node ids must be unique."""
    found = []
    names = [etree_local(child) for child in xml]
    ranks = [SLIDE_ORDER.index(name) for name in names if name in SLIDE_ORDER]
    if ranks != sorted(ranks) or any(names.count(name) > 1 for name in SLIDE_ORDER):
        found.append("Slide " + str(number) + ": the slide XML elements are in the wrong order (" + ", ".join(names) + "). PowerPoint requires exactly cSld, clrMapOvr, transition, timing, extLst, in that order, each at most once, or it refuses to open the file. Insert p:transition right after p:clrMapOvr and p:timing right after p:transition.")
    shape_ids = [element.get("id") for element in xml.iter() if etree_local(element) == "cNvPr"]
    duplicates = sorted({item for item in shape_ids if shape_ids.count(item) > 1})
    if duplicates:
        found.append("Slide " + str(number) + ": several shapes share the id " + ", ".join(duplicates) + ". Each p:cNvPr id must be unique on a slide.")
    targets = {element.get("spid") for element in xml.iter() if etree_local(element) == "spTgt"}
    missing = sorted(item for item in targets if item not in shape_ids)
    if missing:
        found.append("Slide " + str(number) + ": animations point at shape id(s) " + ", ".join(missing) + " that are not on the slide, so PowerPoint drops them. Use the id of the shape's own p:cNvPr.")
    node_ids = [element.get("id") for element in xml.iter() if etree_local(element) == "cTn"]
    if len(node_ids) != len(set(node_ids)):
        found.append("Slide " + str(number) + ": the animation timing nodes (p:cTn) reuse ids. Number them 1, 2, 3... uniquely per slide.")
    return found


def etree_local(element):
    tag = element.tag if isinstance(element.tag, str) else ""
    return tag.split("}", 1)[-1]


def pptx_problems(path, wants_animation=False):
    from lxml import etree
    from pptx import Presentation
    problems = []
    prs = Presentation(path)
    slide_box = (0, 0, int(prs.slide_width), int(prs.slide_height))
    transitions = 0
    timings = 0
    for number, slide in enumerate(prs.slides, 1):
        xml = slide._element
        raw = etree.tostring(xml).decode("utf-8", "ignore")
        transitions += raw.count("<p:transition")
        timings += raw.count("<p:timing")
        problems.extend(slide_xml_problems(number, xml))
        shapes = list(slide.shapes)
        for index, shape in enumerate(shapes):
            text = shape.text_frame.text.strip() if shape.has_text_frame else ""
            if not text:
                continue
            box = bounds(shape)
            if box is None:
                continue
            covers = [bounds(later) for later in shapes[index + 1:] if opacity(later) >= OPAQUE and bounds(later)]
            visible = visible_fraction(box, covers)
            if visible < MIN_VISIBLE:
                problems.append("Slide " + str(number) + ": the text \"" + text[:40] + "\" is " + str(round((1 - visible) * 100)) + "% hidden under a picture or shape that was added after it. Shapes are drawn in the order they were added, so add pictures first (or move the picture element to the front of spTree) and the text last.")
            clip = (max(box[0], slide_box[0]), max(box[1], slide_box[1]), min(box[2], slide_box[2]), min(box[3], slide_box[3]))
            inside = max(0, clip[2] - clip[0]) * max(0, clip[3] - clip[1]) / max(1, (box[2] - box[0]) * (box[3] - box[1]))
            if inside < 0.8:
                problems.append("Slide " + str(number) + ": the text \"" + text[:40] + "\" sits " + str(round((1 - inside) * 100)) + "% outside the slide.")
    if wants_animation and transitions + timings == 0:
        problems.append("The user asked for animation, but the file has no slide transitions and no animations (0 of " + str(len(prs.slides)) + " slides have one). Add a real transition to every slide (p:transition goes right after p:clrMapOvr) and entrance animations in p:timing, for example with the deck helper: python3 /opt/forkwise/deckkit.py --help, and say honestly which animations were added.")
    return problems


def pdf_pages(path):
    try:
        out = subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, timeout=60).stdout.decode("utf-8", "ignore")
        return out.split("\f")[:-1] or [out]
    except Exception:
        pass
    try:
        from pypdf import PdfReader
        return [(page.extract_text() or "") for page in PdfReader(path).pages]
    except Exception:
        return None


def pdf_problems(path):
    pages = pdf_pages(path)
    if not pages:
        return []
    empty = [index + 1 for index, text in enumerate(pages) if len(text.strip()) < 15]
    if len(empty) / len(pages) > 1 - MIN_TEXT_PAGES:
        return ["The PDF has no text layer on " + str(len(empty)) + " of " + str(len(pages)) + " pages (pages " + ", ".join(str(n) for n in empty[:12]) + "). Text was flattened into pictures, so it cannot be selected or searched. Build the PDF from real text, for example with reportlab, or HTML printed to PDF, and keep pictures only for pictures."]
    return []


def docx_problems(path):
    try:
        with zipfile.ZipFile(path) as archive:
            body = archive.read("word/document.xml").decode("utf-8", "ignore")
            media = [name for name in archive.namelist() if name.startswith("word/media/")]
    except Exception:
        return ["The .docx file cannot be opened as a Word document."]
    letters = len(re.sub(r"<[^>]+>", "", body).strip())
    if media and letters < 50:
        return ["The .docx holds " + str(len(media)) + " picture(s) and almost no text (" + str(letters) + " characters). Write the content as real text."]
    if letters == 0:
        return ["The .docx has no text at all."]
    return []


def check(path, wants_animation=False):
    lowered = path.lower()
    try:
        if lowered.endswith(".pptx"):
            return pptx_problems(path, wants_animation)
        if lowered.endswith(".pdf"):
            return pdf_problems(path)
        if lowered.endswith(".docx"):
            return docx_problems(path)
    except Exception as problem:
        return ["Could not open " + path + ": " + type(problem).__name__ + ": " + str(problem)[:160]]
    return []


def stats(path):
    """Counts used to check numbers stated in the final answer."""
    try:
        if path.lower().endswith(".pptx"):
            from pptx import Presentation
            return {"slides": len(Presentation(path).slides)}
        if path.lower().endswith(".pdf"):
            pages = pdf_pages(path)
            return {"pages": len(pages) if pages else 0}
    except Exception:
        return {}
    return {}


def wants_animation(text):
    return bool(ANIMATION_WORDS.search(text or ""))


if __name__ == "__main__":
    animate = "--animate" in sys.argv
    report = {"problems": {}, "stats": {}}
    for item in sys.argv[1:]:
        if item.startswith("--"):
            continue
        report["problems"][item] = check(item, animate)
        report["stats"][item] = stats(item)
    print(json.dumps(report, ensure_ascii=False))
