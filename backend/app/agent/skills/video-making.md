---
name: video-making
title: Animated videos (Forkwise Motion)
category: Create
description: Make and edit professional videos — animated stories with characters, ads, explainers, YouTube videos of 2-20 minutes, Reels and TikToks, and edits of the user's own footage (cuts, punch-ins, captions, graphics, music) — written as code scene by scene. Use for any video request.
---
# Animated videos with Forkwise Motion

You are the director, animator and editor. There are no templates: every scene is an HTML page that
you animate with code. The `video` tool records voices, renders on cloud machines and hands back the
video plus its full source. Aim for the quality of a studio explainer or a good kids' cartoon, not a slideshow.

## 1. Ask first (one ask_user, with sensible defaults offered)
- Where it goes and how long: YouTube (16:9, 2-20 min), Reels/TikTok/Shorts (9:16, 15-90 s), feed (1:1 or 4:5).
- What it is: story, ad, explainer, tutorial, kids' video. The message or plot in one sentence.
- Look: flat cartoon, clean motion graphics, kids' bright, premium/dark, hand-drawn feel. Brand colours or logo.
- Characters: who, age, look, personality, names. Voices: narrator and each character (male/female/child).
- Language. Subtitles yes/no and style (pop = word highlight, clean, box). Music: does the user have a track?
Skip questions the user already answered. If the user is not there to answer, choose and say what you chose.

## 2. Plan
Write the script in `video/project.json` (run `video` action `new` first). One scene = one shot or idea:
2-8 s for ads and reels, 4-15 s for stories and YouTube. Never more than 20 s in one scene; split it.
An 8 minute video is about 60-120 scenes, 20 minutes about 150-300. For long videos make chapters
(`"chapter"` on the first scene of each part); they become YouTube chapters.

Use `todo_write`: one item per chapter or group of scenes, plus storyboard, draft, final and checking.

```json
{
  "title": "Sara and the Kite",
  "size": "16:9", "fps": 30, "language": "fa",
  "voices": {
    "narrator": {"voice": "fa-IR-FaridNeural", "rate": "-5%"},
    "sara": {"voice": "fa-IR-DilaraNeural", "rate": "+5%", "pitch": "+35Hz"},
    "ali":  {"voice": "fa-IR-FaridNeural", "rate": "+10%", "pitch": "+45Hz"}
  },
  "transition": {"type": "fade", "duration": 0.4},
  "captions": {"style": "pop", "accent": "#ffd400"},
  "music": [{"file": "assets/music.mp3", "volume": 0.2, "start_scene": 2}],
  "scenes": [
    {"file": "scenes/01-morning.html", "chapter": "Morning",
     "lines": [{"who": "narrator", "text": "One sunny morning, Sara took her red kite outside."}],
     "sfx": [{"file": "fw:whoosh", "at": 1.2}]},
    {"file": "scenes/02-title.html", "duration": 3.2, "transition": {"type": "circleopen", "duration": 0.6}},
    {"file": "scenes/03-friends.html", "data": {"mood": "happy"},
     "lines": [{"who": "sara", "text": "Ali! Let's fly the kite together!"}, {"who": "ali", "text": "Yes! Let's go!", "pause": 0.2}]}
  ]
}
```
- `lines` play one after another from `voice_start` (default 0.4 s), `pause` after each (0.35 s); `at` fixes a start time.
  A scene lasts at least until its last line ends + 0.6 s, or `duration` if longer.
- Voices: Persian `fa-IR-FaridNeural` (male), `fa-IR-DilaraNeural` (female); children = female or male voice with `pitch` +30..+50Hz and a slightly faster `rate`.
  English: `en-US-AndrewMultilingualNeural`, `en-US-AvaMultilingualNeural`, `en-US-AnaNeural` (child), `en-GB-RyanNeural`.
  Arabic `ar-SA-HamedNeural`/`ar-SA-ZariyahNeural`, Turkish `tr-TR-AhmetNeural`/`tr-TR-EmelNeural`.
- Transitions (`type`): cut, fade, fadeblack, fadewhite, dissolve, wipeleft/right/up/down, slideleft/right/up/down,
  smoothleft/right, circleopen, circleclose, radial, zoomin, pixelize, hblur, coverleft/right, revealleft/right.
  Use cuts and short fades most of the time; a special transition only at chapter changes.
- Sound effects: built in `fw:whoosh fw:swish fw:pop fw:click fw:ding fw:thud fw:rise fw:fall fw:sparkle fw:notify`, or files in assets.
  `at` is seconds inside the scene. Put them on real actions (a door shuts, a title lands, a jump).
- Music only from a file the user gave you (or clearly free to use). It ducks under voices automatically.

## 3. Voices, then scenes
Run `video` action `voice`. It returns exact line and word timings; inside a scene they are `FW.lines`
(`[{who, text, start, end, words: [{text, start, end}]}]`). Start actions on the words they belong to.

Each scene is a full HTML page sized to the video (1920x1080 for 16:9). Shared code goes in
`assets/world.js` and `assets/style.css` (load with `<script src="../assets/world.js">`) so characters,
colours and sets look the same in every scene. `FW.scene.data` holds the scene's `data` from project.json,
so one scene file can serve many scenes.

```html
<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<style>#stage{position:absolute;inset:0;overflow:hidden}.layer{position:absolute;inset:-200px}</style></head>
<body><div id="stage">
  <div class="layer" data-depth="0.1" id="sky"></div>
  <div class="layer" data-depth="0.4" id="far"></div>
  <div class="layer" data-depth="1" id="world"></div>
</div>
<script>
FW.sky("#sky", { time: "day" }); FW.clouds("#far", { count: 5 }); FW.hills("#far", { y: 820, color: "#9bd88f" })
FW.ground("#world", { y: 940 }); FW.grass("#world", { y: 945 })
const sara = FW.character("#world", { kind: "girl", who: "sara", x: 700, y: 985, height: 340, top: "#ff6b81", bottom: { type: "dress", color: "#ff6b81" } })
const line = FW.lines[0]
sara.walk(0.2, 1.8, { to: 900 }).expression(line.start, "laugh").wave(line.start + 0.3, 1.4)
FW.camera("#stage", [{ t: 0, zoom: 1 }, { t: FW.duration, x: 60, zoom: 1.1 }])
</script></body></html>
```

### FW reference (everything is a function of time, in seconds inside the scene)
- `FW.tween(el, {from:{…}, to:{…}}, at, dur, ease)`, `FW.fromTo(el, from, to, at, dur, ease)`, `FW.from`, `FW.to`, `FW.set(el, props, at)`
- `FW.keys(el, [{t:0, x:0, opacity:0}, {t:0.6, x:200, opacity:1, ease:"outBack"}, …])`
- Props: `x y z scale scaleX scaleY rotate rotateX rotateY skewX skewY opacity blur brightness contrast saturate hue grayscale`,
  `draw` (0-1 stroke draw-on), any CSS property (`color`, `width`, `clipPath`, `borderRadius`, `background`), `--css-vars`, `attr:name` (SVG attributes, e.g. `attr:d` to morph paths with the same commands).
- Eases: `linear in out inOut outQuart inOutQuart outExpo inOutExpo inOutSine outBack inBack inOutBack outElastic outBounce smooth snappy anticipate springy soft`, `FW.ease.bezier(a,b,c,d)`, `FW.ease.spring(stiffness, damping)`.
- `FW.stagger(elements, at, gap, (el, at, i) => FW.fromTo(el, …, at, …))`
- `FW.camera(stage, [{t, x, y, zoom, rotate, shake, ease}])` — children with `data-depth` get parallax (0 far … 1 normal … 1.5 foreground). Make layers bigger than the frame (`inset:-200px`) so moves never show edges.
- `FW.onFrame(t => …)` for anything custom: canvas drawing, three.js (`renderer.render` each frame), lottie (`anim.goToAndStop(t*1000, false)`).
- Text: `FW.split(el, "words"|"chars"|"lines")` (Persian/Arabic: words only), `FW.typewriter(el, at, perSecond)`, `FW.count(el, from, to, at, dur, {suffix, persian})`.
- Drawing: `FW.draw(path, at, dur)`, `FW.particles(canvas, {kind: snow|confetti|sparkle|dust|bubbles|rain|leaves|stars, count, colors})`, `FW.wiggle(t, freq, amount, seed)`, `FW.noise`, `FW.random(i, seed)`, `FW.el(tag, attrs, parent)`.
- Scenery (starting points; restyle or draw your own SVG): `FW.sky FW.sun FW.moon FW.clouds FW.hills FW.ground FW.grass FW.tree({kind: round|pine|palm}) FW.house FW.room FW.stars`.
- Characters: `FW.character(parent, {kind: girl|boy|woman|man|grandma|grandpa, who, x, y, height, facing, skin, eyes, hair:{style: pigtails|ponytail|long|bob|bun|curly|short|spiky|hijab|bald, color, ribbon}, top, sleeves: short|long, pattern: "stripes", bottom:{type: skirt|dress|shorts|pants, color}, shoes, glasses, beard, accessory: "backpack", expression})`
  Actions (chainable): `walk(at, dur, {to, toY})`, `run(at, dur, {to})`, `move(at, dur, {x, y, scale})`, `face(at, ±1)`, `jump(at, height, dur)`, `wave(at, dur, "R"|"L")`,
  `pose(at, dur, {armL:[shoulder, elbow], armR, legL:[hip, knee], legR, head, lean, crouch, reset:true})` (degrees; arm 0 = hanging, armR -150 = raised up),
  `expression(at, neutral|happy|laugh|sad|surprised|angry|scared|thinking|sleepy)`, `look(at, x, y)` (-1..1), `blink(at)`, `say(who)`/`talk(start, end)` (lip-sync; automatic when `who` is set).
  `c.point("handR"|"handL"|"head"|"feet")` gives the current position in scene pixels (inside `FW.onFrame`) to attach strings, props or speech bubbles.
- Your own characters (animals, robots, mascots, any style): draw them in SVG, mark joints with `data-part` + `data-pivot`, then
  `const cat = FW.puppet("#cat")` → `cat.keys("tail", [{t:0, rotate:-10}, {t:1, rotate:15}])`, `cat.swing("legL", 0, 3, 25, 2.2)` (walk cycles, wings, tails),
  `cat.move(at, dur, {x, y, scale, flip})`, `cat.bob(4, 2)`, `cat.talk("cat")` (part "mouth": scales or swaps `data-mouth="closed|open|wide"`), blinking parts named `eye…`.
  Design them once in `assets/world.js` (a function that returns the SVG) so they look identical in every scene. Prefer your own designs when the built-in people don't fit the style.
- Illustrations, backgrounds, textures and B-roll stills: make them with `generate_image` (same style words in every prompt), save to `assets/`, then animate them (parallax layers, slow push-ins, masks).
- Music editing: `video` action `beats` gives tempo and beat times; land cuts, text pops and camera hits on beats.
- Fonts ready to use: `Vazirmatn` (Persian text), `Lalezar` (Persian display titles), `Baloo Bhaijaan 2` (rounded, kids), `Inter`, `Fredoka`, `Playfair Display`.
- Libraries (all local): `<script src="/_fw/anime.min.js">` (anime.js v4: global `anime`, e.g. `anime.animate`), `import * as THREE from "/_fw/three.module.min.js"`, `<script src="/_fw/lottie.min.js">`.
- The page must not fetch from the internet. Put images, lottie files and sounds in `assets/`.

## 4. The craft (what makes it look professional)
- Something always moves: a slow camera push or drift in every shot, idle breathing, clouds, particles. Never a frozen frame.
- Ease everything (no `linear` except for constant motion). Anticipation before big moves, overshoot (`outBack`) on arrivals, stagger groups (0.05-0.12 s).
- Staging: one clear focus per moment; dim or blur the rest. Characters face what they look at.
- Timing: hold text long enough to read (1.5 s + 0.3 s per word). Cut on action. Vary shot sizes: wide to set the place, medium for action, close-up for emotion (zoom the camera 1.3-1.8 on a face).
- Sync: actions and expressions start on the spoken word (`FW.lines[i].words[j].start`). Mouths move only while that character speaks.
- Colour: one palette of 4-6 colours for the whole video, in `assets/style.css` as CSS variables. Good contrast for text.
- Typography: big. 16:9 titles 90-180 px, body 44-60 px. 9:16 titles 100-160 px, keep text in the middle 80% and above the bottom 22% (subtitles live there).
- Continuity: the same character looks the same in every scene (define them once in `assets/world.js`).
- Sound: voice clear, music low, effects on real actions. Silence is fine for a beat before a big moment.

## 5. Check, show, render
1. `video` action `storyboard`: one frame of every scene; the user sees it. Fix obvious problems, then ask the user
   (ask_user) to approve the story and look, or what to change. Do not do the final render before this, unless the user said to just go.
2. `video` action `preview` with `scene` and `times` while you build: look at the frames. Fix overlaps, empty areas, edges showing, unreadable text, JS errors.
3. `video` action `render` with `draft: true` to check motion and timing (fast, half size). For long videos you can draft parts with `scenes: "1-20"`.
4. Look at the contact sheet and the log (page errors, SILENT sound). Fix and render again.
5. Final: `video` action `render` (no draft). Unchanged scenes are reused, so re-rendering after a small fix is quick.
6. Tell the user: length, chapters, what is in it, and that the source zip lets anyone edit it later. Offer changes (voices, pace, colours, a scene).

## Editing the user's own footage (talking head, interview, vlog, podcast, product clips)
Edit like a top YouTube/TikTok editor, not like a slideshow.
1. Copy the files into `video/assets/raw/`. Run `video` action `transcribe` with `file` for each (word-timed, any language).
   Read the transcript and decide the story: the strongest hook first (often not the first sentence), cut repeats, false starts and weak parts.
2. `video` action `cuts` gives keep-ranges without pauses and filler words (`gap` 0.25-0.35 for Reels/TikTok, 0.45-0.6 for YouTube so it still breathes).
   Pick and reorder ranges yourself; you are the editor.
3. Build scenes with `FW.clip` / `FW.sequence` (scenes 5-20 s each, split at topic changes):
```js
const raw = "../assets/raw/talk.mp4"
const { end } = FW.sequence("#stage", raw, [{from: 12.4, to: 15.1}, {from: 15.6, to: 19.0}, {from: 21.2, to: 24.8}],
  { look: "cinematic", clean: true, punch: 1.1, focus: [0.5, 0.35] })   // jump cuts, alternate punch-in, face in frame
FW.duration = end
// emphasis zoom on a key word, then back
FW.keys("#stage video", [{t: 4.2, scale: 1.1}, {t: 4.35, scale: 1.25, ease: "outQuart"}, {t: 5.6, scale: 1.1}])
```
   `FW.clip(parent, {src, from, to, at, speed, fit, focus, look, volume, clean, captions, audio:false})` returns the video element: animate it
   (zoom, pan, `clipPath` reveals, rounded picture-in-picture, split screen). Looks: `natural warm cool film cinematic vivid moody bw vintage`.
   The clip's own sound is mixed in automatically; `clean: true` removes noise and evens the voice; subtitles come from its transcript.
4. Make it rich: a pattern break every 2-4 s on Shorts, every 5-10 s on YouTube — a punch-in, a B-roll clip or image, a keyword popping
   on screen, a graphic, a sound effect. Lower-thirds for names, animated chapter cards for long videos, a branded intro of max 3 s,
   end screen with call to action. Vertical from horizontal footage: `fit: "cover"` with `focus` on the face.
5. Music under speech at 0.1-0.2 volume (ducked automatically), whooshes on transitions, pops on text. Check the draft for jumpy cuts
   mid-word (move the cut a few hundredths) and for captions matching the speech.

## Honest limits
Built-in people are 2D flat-vector cartoons (front-facing, rigged); for other looks draw your own with FW.puppet. For photoreal people, real 3D or lip-sync of a real face,
say so and offer what is possible: stylised cartoon, motion graphics, or the user's own footage and photos animated with camera moves.
