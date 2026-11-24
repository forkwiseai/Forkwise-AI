"""deckkit: real PowerPoint animations and transitions for python-pptx decks.

python-pptx and pptxgenjs cannot write animations. Hand-written XML usually breaks the file: PowerPoint requires the
slide children in the order cSld, clrMapOvr, transition, timing, extLst, unique timing node ids, and animation
targets that point at real shape ids. This module writes that XML correctly.

    import sys; sys.path.insert(0, "/opt/forkwise"); sys.path.insert(0, "/workspace/.forkwise")
    from pptx import Presentation
    from deckkit import transition, animate, rtl, check

    prs = Presentation("deck.pptx")
    for slide in prs.slides:
        transition(slide, "fade")                               # fade push wipe split zoom cover reveal
        animate(slide, slide.shapes.title, "rise")              # plays by itself when the slide opens
        animate(slide, list(slide.shapes)[1:], "fly", direction="bottom", stagger=180)
    prs.save("deck.pptx")
    print(check("deck.pptx"))                                   # [] when PowerPoint will open it cleanly

Effects: appear fade rise fly zoom wipe split. start="after" (default) chains each effect after the previous one,
start="with" runs it together with the previous one, start="click" waits for a click. Times are in milliseconds.
Command line: python3 deckkit.py check deck.pptx | python3 deckkit.py animate deck.pptx [--effect rise] [--transition fade]
"""
import sys
import zipfile

from lxml import etree

P = "http://schemas.openxmlformats.org/presentationml/2006/main"
NS = {"p": P}
ORDER = ["cSld", "clrMapOvr", "transition", "timing", "extLst"]

PRESETS = {
    # name: (presetID, default subtype)
    "appear": (1, 0),
    "fly": (2, 4),
    "fade": (10, 0),
    "split": (16, 21),
    "wipe": (22, 4),
    "rise": (42, 0),   # PowerPoint "Float In"
    "zoom": (53, 16),
}
FLY_SUBTYPE = {"bottom": 4, "top": 1, "left": 8, "right": 2}
FLY_FROM = {
    "bottom": ("#ppt_x", "1+#ppt_h/2"),
    "top": ("#ppt_x", "0-#ppt_h/2"),
    "left": ("0-#ppt_w/2", "#ppt_y"),
    "right": ("1+#ppt_w/2", "#ppt_y"),
}
WIPE_FILTER = {"bottom": "wipe(up)", "top": "wipe(down)", "left": "wipe(right)", "right": "wipe(left)"}
TRANSITIONS = {
    "fade": '<p:fade xmlns:p="%s"/>',
    "push": '<p:push xmlns:p="%s" dir="u"/>',
    "wipe": '<p:wipe xmlns:p="%s" dir="r"/>',
    "split": '<p:split xmlns:p="%s" orient="vert" dir="out"/>',
    "zoom": '<p:zoom xmlns:p="%s"/>',
    "cover": '<p:cover xmlns:p="%s" dir="l"/>',
    "reveal": '<p:strips xmlns:p="%s" dir="rd"/>',
}


def q(tag):
    return "{%s}%s" % (P, tag)


def local(element):
    return element.tag.split("}", 1)[-1] if isinstance(element.tag, str) else ""


def place(sld, element):
    """Puts element (transition or timing) at its schema position among the slide's children."""
    name = local(element)
    for old in sld.findall(q(name)):
        sld.remove(old)
    rank = ORDER.index(name)
    index = 0
    for position, child in enumerate(list(sld)):
        if local(child) in ORDER and ORDER.index(local(child)) < rank:
            index = position + 1
    sld.insert(index, element)


def transition(slide, kind="fade", speed="med", advance_after=None):
    """Slide transition. speed: slow | med | fast. advance_after: milliseconds before the next slide, or None."""
    sld = slide._element
    node = etree.SubElement(etree.Element("tmp"), q("transition"))
    node.set("spd", speed)
    if advance_after is not None:
        node.set("advTm", str(int(advance_after)))
    node.append(etree.fromstring(TRANSITIONS.get(kind, TRANSITIONS["fade"]) % P))
    place(sld, node)
    return node


class Ids:
    def __init__(self, timing):
        used = [int(n.get("id")) for n in timing.iter(q("cTn")) if (n.get("id") or "").isdigit()]
        self.value = max(used) if used else 0

    def next(self):
        self.value += 1
        return str(self.value)


def ctn(ids, **attrs):
    node = etree.Element(q("cTn"))
    node.set("id", ids.next())
    for key, value in attrs.items():
        node.set(key, str(value))
    return node


def cond_list(parent, tag, *conds):
    holder = etree.SubElement(parent, q(tag))
    for cond in conds:
        holder.append(cond)
    return holder


def cond(delay=0, evt=None, tn=None):
    node = etree.Element(q("cond"))
    if evt:
        node.set("evt", evt)
    node.set("delay", str(delay))
    if tn is not None:
        etree.SubElement(node, q("tn")).set("val", str(tn))
    return node


def target(parent, spid):
    el = etree.SubElement(parent, q("tgtEl"))
    etree.SubElement(el, q("spTgt")).set("spid", str(spid))


def behaviour(ids, spid, dur, attr=None, fill=None):
    bhvr = etree.Element(q("cBhvr"))
    inner = ctn(ids, dur=dur, **({"fill": fill} if fill else {}))
    bhvr.append(inner)
    target(bhvr, spid)
    if attr:
        names = etree.SubElement(bhvr, q("attrNameLst"))
        for item in attr if isinstance(attr, (list, tuple)) else [attr]:
            etree.SubElement(names, q("attrName")).text = item
    return bhvr, inner


def show(ids, spid):
    node = etree.Element(q("set"))
    bhvr, inner = behaviour(ids, spid, 1, "style.visibility", "hold")
    cond_list(inner, "stCondLst", cond(0))
    node.append(bhvr)
    to = etree.SubElement(node, q("to"))
    etree.SubElement(to, q("strVal")).set("val", "visible")
    return node


def fade_in(ids, spid, dur, flt="fade"):
    node = etree.Element(q("animEffect"))
    node.set("transition", "in")
    node.set("filter", flt)
    node.append(behaviour(ids, spid, dur)[0])
    return node


def move(ids, spid, dur, attr, start, end):
    node = etree.Element(q("anim"))
    node.set("calcmode", "lin")
    node.set("valueType", "num")
    bhvr, _ = behaviour(ids, spid, dur, attr, "hold")
    bhvr.set("additive", "base")
    node.append(bhvr)
    values = etree.SubElement(node, q("tavLst"))
    for tm, val in (("0", start), ("100000", end)):
        tav = etree.SubElement(values, q("tav"))
        tav.set("tm", tm)
        etree.SubElement(etree.SubElement(tav, q("val")), q("strVal")).set("val", val)
    return node


def effect_nodes(ids, spid, effect, direction, dur):
    nodes = [show(ids, spid)]
    if effect == "fade":
        nodes.append(fade_in(ids, spid, dur))
    elif effect == "fly":
        x, y = FLY_FROM.get(direction, FLY_FROM["bottom"])
        nodes.append(move(ids, spid, dur, "ppt_x", x, "#ppt_x"))
        nodes.append(move(ids, spid, dur, "ppt_y", y, "#ppt_y"))
    elif effect == "rise":
        nodes.append(fade_in(ids, spid, dur))
        nodes.append(move(ids, spid, dur, "ppt_x", "#ppt_x", "#ppt_x"))
        nodes.append(move(ids, spid, dur, "ppt_y", "#ppt_y+.1", "#ppt_y"))
    elif effect == "zoom":
        nodes.append(fade_in(ids, spid, dur))
        nodes.append(move(ids, spid, dur, "ppt_w", "0", "#ppt_w"))
        nodes.append(move(ids, spid, dur, "ppt_h", "0", "#ppt_h"))
    elif effect == "wipe":
        nodes.append(fade_in(ids, spid, dur, WIPE_FILTER.get(direction, "wipe(up)")))
    elif effect == "split":
        nodes.append(fade_in(ids, spid, dur, "barn(inVertical)"))
    return nodes


def main_sequence(slide):
    """Finds or creates p:timing > ... > mainSeq and returns (timing, the mainSeq childTnLst)."""
    sld = slide._element
    timing = sld.find(q("timing"))
    if timing is None:
        timing = etree.Element(q("timing"))
        place(sld, timing)
    seq_list = timing.find(".//p:cTn[@nodeType='mainSeq']/p:childTnLst", NS)
    if seq_list is not None:
        return timing, seq_list
    for child in list(timing):
        timing.remove(child)
    ids = Ids(timing)
    tn_list = etree.SubElement(timing, q("tnLst"))
    root_par = etree.SubElement(tn_list, q("par"))
    root = ctn(ids, dur="indefinite", restart="never", nodeType="tmRoot")
    root_par.append(root)
    seq = etree.SubElement(etree.SubElement(root, q("childTnLst")), q("seq"))
    seq.set("concurrent", "1")
    seq.set("nextAc", "seek")
    main = ctn(ids, dur="indefinite", nodeType="mainSeq")
    seq.append(main)
    seq_list = etree.SubElement(main, q("childTnLst"))
    prev = cond(0, "onPrev")
    etree.SubElement(etree.SubElement(prev, q("tgtEl")), q("sldTgt"))
    cond_list(seq, "prevCondLst", prev)
    nxt = cond(0, "onNext")
    etree.SubElement(etree.SubElement(nxt, q("tgtEl")), q("sldTgt"))
    cond_list(seq, "nextCondLst", nxt)
    return timing, seq_list


def animate(slide, shapes, effect="fade", start="after", delay=0, duration=500, direction="bottom", stagger=0):
    """Adds entrance animations. shapes: one shape or a list (each gets the effect, stagger ms apart)."""
    if effect not in PRESETS:
        raise ValueError("effect must be one of " + ", ".join(PRESETS))
    items = shapes if isinstance(shapes, (list, tuple)) else [shapes]
    items = [item for item in items if item is not None]
    if not items:
        return
    timing, seq_list = main_sequence(slide)
    ids = Ids(timing)
    groups = seq_list.findall(q("par"))
    preset, subtype = PRESETS[effect]
    if effect == "fly":
        subtype = FLY_SUBTYPE.get(direction, 4)
    for position, shape in enumerate(items):
        mode = start if position == 0 else ("with" if stagger and start != "click" else start)
        node_type = {"click": "clickEffect", "with": "withEffect"}.get(mode, "afterEffect")
        if mode == "click" or not groups:
            group = etree.SubElement(seq_list, q("par"))
            outer = ctn(ids, fill="hold")
            group.append(outer)
            if mode == "click":
                cond_list(outer, "stCondLst", cond("indefinite"))
            else:
                # The first group starts when the slide begins, so the deck animates without clicks.
                cond_list(outer, "stCondLst", cond("indefinite"), cond(0, "onBegin", tn=2))
            etree.SubElement(outer, q("childTnLst"))
            groups.append(group)
            offset = 0
        else:
            group = groups[-1]
            outer = group.find(q("cTn"))
            offset = group_times(group)[1]
        steps = outer.find(q("childTnLst"))
        begin = offset + delay + (position * stagger if stagger else 0)
        if mode == "with" and not stagger:
            begin = group_times(group)[0] + delay
        inner_par = etree.SubElement(steps, q("par"))
        inner = ctn(ids, fill="hold")
        inner_par.append(inner)
        cond_list(inner, "stCondLst", cond(begin))
        effect_par = etree.SubElement(etree.SubElement(inner, q("childTnLst")), q("par"))
        node = ctn(ids, presetID=preset, presetClass="entr", presetSubtype=subtype, fill="hold", nodeType=node_type)
        effect_par.append(node)
        cond_list(node, "stCondLst", cond(0))
        children = etree.SubElement(node, q("childTnLst"))
        for part in effect_nodes(ids, shape.shape_id, effect, direction, duration):
            children.append(part)
    return timing


def group_times(group):
    """(start of the last effect, end of the latest effect) in ms inside one click group, read from the XML."""
    last_start = 0
    end = 0
    steps = group.find(q("cTn") + "/" + q("childTnLst"))
    for inner_par in (steps.findall(q("par")) if steps is not None else []):
        inner = inner_par.find(q("cTn"))
        first = inner.find(q("stCondLst") + "/" + q("cond"))
        begin = int(first.get("delay")) if first is not None and (first.get("delay") or "").isdigit() else 0
        length = 0
        for node in inner.iter(q("cTn")):
            dur = node.get("dur") or ""
            if dur.isdigit() and int(dur) > 1:
                length = max(length, int(dur))
        last_start = begin
        end = max(end, begin + length)
    return last_start, end


def rtl(shape, font="Vazirmatn", align="r"):
    """Right-to-left paragraphs and a font that has Persian/Arabic letters, for every paragraph of a text shape."""
    if not getattr(shape, "has_text_frame", False):
        return
    A = "http://schemas.openxmlformats.org/drawingml/2006/main"
    for paragraph in shape.text_frame.paragraphs:
        ppr = paragraph._p.get_or_add_pPr()
        ppr.set("rtl", "1")
        ppr.set("algn", align)
        for run in paragraph.runs:
            rpr = run._r.get_or_add_rPr()
            for tag in ("latin", "cs"):
                node = rpr.find("{%s}%s" % (A, tag))
                if node is None:
                    node = etree.SubElement(rpr, "{%s}%s" % (A, tag))
                node.set("typeface", font)
            rpr.set("lang", rpr.get("lang") or "fa-IR")


def check(path):
    """Problems PowerPoint would complain about. Empty list means the file is clean."""
    problems = []
    try:
        archive = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        return [path + " is not a valid .pptx (zip) file."]
    with archive:
        names = archive.namelist()
        if "[Content_Types].xml" not in names:
            problems.append("[Content_Types].xml is missing.")
        slides = sorted((n for n in names if n.startswith("ppt/slides/slide") and n.endswith(".xml")), key=lambda n: int("".join(c for c in n if c.isdigit()) or 0))
        for name in slides:
            number = int("".join(c for c in name.split("/")[-1] if c.isdigit()))
            try:
                sld = etree.fromstring(archive.read(name))
            except etree.XMLSyntaxError as problem:
                problems.append("Slide %d: broken XML (%s)." % (number, problem))
                continue
            order = [local(child) for child in sld]
            ranks = [ORDER.index(item) for item in order if item in ORDER]
            if ranks != sorted(ranks) or any(order.count(item) > 1 for item in ORDER):
                problems.append("Slide %d: children in the wrong order: %s (need cSld, clrMapOvr, transition, timing, extLst)." % (number, ", ".join(order)))
            shape_ids = [n.get("id") for n in sld.iter() if local(n) == "cNvPr"]
            for spid in sorted({n.get("spid") for n in sld.iter() if local(n) == "spTgt"}):
                if spid not in shape_ids:
                    problems.append("Slide %d: an animation targets shape id %s, which is not on the slide." % (number, spid))
            ctn_ids = [n.get("id") for n in sld.iter() if local(n) == "cTn"]
            if len(ctn_ids) != len(set(ctn_ids)):
                problems.append("Slide %d: duplicate timing node ids." % number)
    return problems


def save(prs, path):
    """Saves the deck and returns check(path)."""
    prs.save(path)
    return check(path)


def stats(path):
    with zipfile.ZipFile(path) as archive:
        slides = [n for n in archive.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml")]
        animated = 0
        transitions = 0
        for name in slides:
            raw = archive.read(name)
            animated += b"presetClass=\"entr\"" in raw
            transitions += b"<p:transition" in raw
    return {"slides": len(slides), "slides_with_animation": animated, "slides_with_transition": transitions}


def _cli(argv):
    if len(argv) >= 2 and argv[0] == "check":
        problems = check(argv[1])
        print("\n".join(problems) if problems else "OK: " + str(stats(argv[1])))
        return 1 if problems else 0
    if len(argv) >= 2 and argv[0] == "animate":
        from pptx import Presentation
        path = argv[1]
        effect = argv[argv.index("--effect") + 1] if "--effect" in argv else "rise"
        kind = argv[argv.index("--transition") + 1] if "--transition" in argv else "fade"
        prs = Presentation(path)
        for slide in prs.slides:
            transition(slide, kind)
            shapes = [shape for shape in slide.shapes if shape.has_text_frame and shape.text_frame.text.strip() or shape.shape_type == 13]
            if shapes:
                animate(slide, shapes, effect, stagger=160)
        problems = save(prs, path)
        print("\n".join(problems) if problems else "OK: " + str(stats(path)))
        return 1 if problems else 0
    print(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(_cli(sys.argv[1:]))
