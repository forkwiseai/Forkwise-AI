---
name: presentations
title: Animated PowerPoint decks
category: Documents
description: Build polished .pptx decks with real entrance animations and slide transitions (pptxgenjs or python-pptx plus deckkit), Persian/RTL text that renders, and a visual check of every slide before handing over. Use for any PowerPoint or slide deck.
---
# Animated PowerPoint decks

Neither pptxgenjs nor python-pptx can write animations, and hand-written animation XML is the most common reason a
deck will not open ("PowerPoint found a problem with content") or opens with the animations silently removed. Use
deckkit for every animation and transition. It is at /opt/forkwise/deckkit.py and also copied into
/workspace/.forkwise/deckkit.py when this skill loads.

## 1. Plan the deck before writing code
- One message per slide. The title states the point ("He led the 1979 education reform"), not a topic ("Education").
- 6 to 12 slides unless the user asked otherwise. Cover, 1 slide per idea, closing slide.
- Pick one look and keep it: a dark or light background, one accent colour, one display font and one body font.
  Persian decks: Vazirmatn for everything (installed in the sandbox), right-aligned, right-to-left paragraphs.
- Sizes: title 36-44 pt, body 18-24 pt, never below 14 pt. At most 5 short lines of body text per slide.
- Layout grid: 0.6 inch margins, everything aligned to the same left/right edges. Leave space; do not fill every corner.

## 2. Build the slides (choose one)
Node, best for designed layouts (shapes, gradients, image cards, charts):
```js
const pptxgen = require("pptxgenjs");          // installed globally (NODE_PATH is set)
const pptx = new pptxgen(); pptx.layout = "LAYOUT_WIDE"; pptx.rtlMode = true;   // rtlMode for Persian
const s = pptx.addSlide(); s.background = { color: "0F172A" };
s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: "D4A017" } });
s.addText("عنوان", { x: 0.6, y: 2.4, w: 12, h: 1.2, fontFace: "Vazirmatn", fontSize: 44, bold: true, color: "FFFFFF", align: "right", rtlMode: true });
await pptx.writeFile({ fileName: "deck.pptx" });
```
Python: python-pptx with the same rules. Add pictures and background shapes FIRST and text LAST: shapes are drawn in
the order they are added, so a picture added after the text covers it.

## 3. Add animations and transitions with deckkit (after the file exists)
```python
import sys; sys.path[:0] = ["/opt/forkwise", "/workspace/.forkwise"]
from pptx import Presentation
from deckkit import transition, animate, rtl, save
prs = Presentation("deck.pptx")
for number, slide in enumerate(prs.slides):
    transition(slide, ["fade", "push", "wipe", "zoom"][number % 4], speed="med")
    texts = [sh for sh in slide.shapes if sh.has_text_frame and sh.text_frame.text.strip()]
    pictures = [sh for sh in slide.shapes if sh.shape_type == 13]
    if pictures: animate(slide, pictures, "zoom", duration=700)
    if texts: animate(slide, texts[:1], "rise", duration=600)
    if texts[1:]: animate(slide, texts[1:], "fly", direction="right", stagger=200, duration=500)
print(save(prs, "deck.pptx"))   # must print []
```
Effects: appear, fade, rise, fly (direction bottom/top/left/right), zoom, wipe, split. start="after" plays by itself
when the slide opens (good for decks that should feel alive), start="click" waits for a click, stagger staggers a
list. Busy is not better: 2 to 4 animated groups per slide, 400-700 ms each, the same family of effects across the
deck. `python3 /opt/forkwise/deckkit.py animate deck.pptx --effect rise --transition fade` animates a whole deck in one go.
For Persian text made with python-pptx call rtl(shape) on each text shape.

## 4. Look at every slide before you answer
```bash
soffice --headless --convert-to pdf deck.pptx && pdftoppm -png -r 50 deck.pdf slide
python3 /opt/forkwise/deckkit.py check deck.pptx
```
Open the slide-N.png images with read_file and check: no text hidden under pictures, nothing off the slide, Persian
letters joined and right-aligned (not boxes or reversed), readable contrast. Fix and re-render until it is right.
Then call show_file with the .pptx (and the PDF if useful) and tell the user honestly which animations it has.
