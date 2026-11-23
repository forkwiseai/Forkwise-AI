/* Forkwise Motion clock: makes every web animation on the page follow a virtual time,
   so each video frame is rendered exactly and the same on every run.
   Covers requestAnimationFrame, timers, performance.now, Date, CSS animations and
   transitions, the Web Animations API, <video>/<audio> elements and FW timelines. */
(function () {
  if (window.__fwClock) return
  let now = 0
  const realSetTimeout = window.setTimeout.bind(window)
  const startDate = 1767225600000 // fixed date so "new Date()" is the same every run
  const RealDate = Date
  function FakeDate(...args) {
    if (!(this instanceof FakeDate)) return new RealDate(startDate + now).toString()
    return args.length ? new RealDate(...args) : new RealDate(startDate + now)
  }
  FakeDate.prototype = RealDate.prototype
  FakeDate.now = () => startDate + now
  FakeDate.parse = RealDate.parse
  FakeDate.UTC = RealDate.UTC
  window.Date = FakeDate
  performance.now = () => now

  let frames = []
  let nextId = 1
  window.requestAnimationFrame = (callback) => {
    const id = nextId++
    frames.push({ id, callback })
    return id
  }
  window.cancelAnimationFrame = (id) => {
    frames = frames.filter((item) => item.id !== id)
  }

  let timers = []
  function addTimer(callback, delay, args, repeat) {
    const id = nextId++
    timers.push({ id, callback, at: now + Math.max(0, Number(delay) || 0), every: repeat ? Math.max(1, Number(delay) || 1) : 0, args })
    return id
  }
  window.setTimeout = (callback, delay, ...args) => addTimer(callback, delay, args, false)
  window.setInterval = (callback, delay, ...args) => addTimer(callback, delay, args, true)
  window.clearTimeout = window.clearInterval = (id) => {
    timers = timers.filter((item) => item.id !== id)
  }

  // Seeded random numbers, so particles and "random" layouts are the same every render.
  let seed = 20260101
  Math.random = function () {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const errors = []
  window.addEventListener("error", (event) => errors.push(String(event.message || event.error)))
  window.addEventListener("unhandledrejection", (event) => errors.push("Unhandled promise: " + String(event.reason)))

  function runTimers() {
    let guard = 0
    while (guard < 10000) {
      guard++
      let due = null
      for (const item of timers) if (item.at <= now && (!due || item.at < due.at)) due = item
      if (!due) break
      if (due.every) due.at = due.at + due.every
      else timers = timers.filter((item) => item !== due)
      try {
        if (typeof due.callback === "function") due.callback(...(due.args || []))
      } catch (problem) {
        errors.push(String(problem && problem.stack || problem))
      }
    }
  }

  function runFrames() {
    const list = frames
    frames = []
    for (const item of list) {
      try {
        item.callback(now)
      } catch (problem) {
        errors.push(String(problem && problem.stack || problem))
      }
    }
  }

  function syncAnimations() {
    if (!document.getAnimations) return
    for (const animation of document.getAnimations()) {
      if (animation.__fwStart === undefined) {
        animation.__fwStart = now
        try { animation.pause() } catch (problem) {}
      }
      try {
        animation.currentTime = Math.max(0, now - animation.__fwStart)
      } catch (problem) {}
    }
  }

  async function syncMedia() {
    const waits = []
    for (const media of document.querySelectorAll("video, audio")) {
      if (media.__fwStart === undefined) {
        const at = parseFloat(media.getAttribute("data-at") || "")
        media.__fwStart = isNaN(at) ? now : at * 1000
        media.muted = true
        try { media.pause() } catch (problem) {}
      }
      let want = Math.max(0, (now - media.__fwStart) / 1000) * (media.playbackRate || 1)
      const from = parseFloat(media.getAttribute("data-from") || "0") || 0
      want = want + from
      const until = parseFloat(media.getAttribute("data-to") || "")
      if (!isNaN(until)) want = Math.min(want, until - 0.001)
      if (media.loop && media.duration) want = want % media.duration
      else if (media.duration) want = Math.min(want, media.duration - 0.001)
      if (Math.abs(media.currentTime - want) > 0.001) {
        waits.push(new Promise((resolve) => {
          const done = () => { media.removeEventListener("seeked", done); resolve() }
          media.addEventListener("seeked", done)
          setRealTimeout(done, 3000)
          media.currentTime = want
        }))
      }
    }
    if (waits.length) await Promise.all(waits)
  }
  const setRealTimeout = (callback, ms) => realSetTimeout(callback, ms)

  async function seek(ms) {
    now = ms
    runTimers()
    runFrames()
    if (window.FW && window.FW.__frame) window.FW.__frame(now / 1000)
    runFrames()
    syncAnimations()
    await syncMedia()
    const pending = []
    for (const image of document.images) if (!image.complete) pending.push(image.decode().catch(() => null))
    if (pending.length) await Promise.all(pending)
    return true
  }

  window.__fwClock = {
    seek,
    now: () => now,
    errors: () => errors.splice(0, errors.length),
  }
})()
