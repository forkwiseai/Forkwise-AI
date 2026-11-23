// Voice: recording with speech detection, server speech to text, and natural spoken replies.
// The server side is optional: without it, dictation uses the browser's speech recognition
// and replies are read with the browser's own voices.
import { API, api } from "./api"

let infoCache = null

export function voiceInfo() {
  if (!infoCache) {
    infoCache = api.get("/api/voice").catch(() => ({ transcribe: false, speak: false, voices: [], voice: "" }))
  }
  return infoCache
}

export function voiceLanguage() {
  try {
    return localStorage.getItem("fw-voice") || navigator.language || "en-US"
  } catch (problem) {
    return navigator.language || "en-US"
  }
}

export function preferredVoice() {
  try {
    return localStorage.getItem("fw-voice-name") || ""
  } catch (problem) {
    return ""
  }
}

export function canRecord() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder)
}

function pickMime() {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]
  for (const type of options) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) return type
  }
  return ""
}

export async function transcribe(blob, language) {
  const form = new FormData()
  const type = blob.type || "audio/webm"
  const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm"
  form.append("audio", blob, "speech." + ext)
  form.append("language", language || voiceLanguage())
  const data = await api.post("/api/voice/transcribe", form)
  return (data.text || "").trim()
}

// Listens to the microphone, tells speech from silence, and records one utterance at a time.
export class Listener {
  constructor({ onLevel, onSpeechStart, onUtterance, onError } = {}) {
    this.onLevel = onLevel || (() => {})
    this.onSpeechStart = onSpeechStart || (() => {})
    this.onUtterance = onUtterance || (() => {})
    this.onError = onError || (() => {})
    this.stream = null
    this.context = null
    this.analyser = null
    this.recorder = null
    this.chunks = []
    this.active = false
    this.recording = false
    this.paused = false
    this.threshold = 0.035
    this.silenceMs = 900
    this.maxMs = 60000
    this.loud = 0
    this.quietSince = 0
    this.startedAt = 0
    this.frame = 0
    this.floor = 0.01
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    } catch (problem) {
      this.onError(problem && problem.name === "NotAllowedError" ? "Microphone access is blocked. Allow it in the browser's site settings." : "The microphone could not be opened.")
      return false
    }
    const Context = window.AudioContext || window.webkitAudioContext
    this.context = new Context()
    const source = this.context.createMediaStreamSource(this.stream)
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 1024
    source.connect(this.analyser)
    this.active = true
    this.tick()
    return true
  }

  level() {
    const data = new Float32Array(this.analyser.fftSize)
    this.analyser.getFloatTimeDomainData(data)
    let sum = 0
    for (let index = 0; index < data.length; index += 1) sum += data[index] * data[index]
    return Math.sqrt(sum / data.length)
  }

  tick() {
    if (!this.active) return
    const now = performance.now()
    const value = this.level()
    if (!this.recording) this.floor = this.floor * 0.98 + value * 0.02
    const limit = Math.max(this.threshold * (this.strict ? 2.2 : 1), this.floor * 3)
    this.onLevel(Math.min(1, value / 0.2))
    if (!this.paused) {
      if (value > limit) {
        this.loud += 1
        this.quietSince = 0
        if (!this.recording && this.loud > 4) this.begin(now)
      } else {
        this.loud = 0
        if (this.recording && !this.quietSince) this.quietSince = now
      }
      if (this.recording && this.quietSince && now - this.quietSince > this.silenceMs) this.finish()
      else if (this.recording && now - this.startedAt > this.maxMs) this.finish()
    }
    this.frame = requestAnimationFrame(() => this.tick())
  }

  begin(now) {
    this.chunks = []
    const type = pickMime()
    this.recorder = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined)
    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data)
    }
    this.recorder.onstop = () => {
      const blob = new Blob(this.chunks, { type: this.recorder.mimeType || type || "audio/webm" })
      const long = performance.now() - this.startedAt
      if (long > 500 && blob.size > 2000) this.onUtterance(blob)
    }
    this.recorder.start(250)
    this.recording = true
    this.startedAt = now
    this.quietSince = 0
    this.onSpeechStart()
  }

  finish() {
    if (!this.recording) return
    this.recording = false
    this.quietSince = 0
    try {
      this.recorder.stop()
    } catch (problem) {
      this.onError("Recording stopped unexpectedly.")
    }
  }

  // While the assistant talks, only louder, sustained speech counts, so its own voice is ignored.
  setStrict(value) {
    this.strict = value
  }

  pause() {
    this.paused = true
    this.finish()
  }

  resume() {
    this.paused = false
    this.loud = 0
  }

  stop() {
    this.active = false
    cancelAnimationFrame(this.frame)
    this.finish()
    if (this.stream) this.stream.getTracks().forEach((track) => track.stop())
    if (this.context) this.context.close().catch(() => null)
  }
}

// One-shot recording for dictation: starts now, stops on silence or when stop() is called.
export function recordOnce({ onLevel, onDone, onError }) {
  let started = false
  const listener = new Listener({
    onLevel,
    onError,
    onSpeechStart: () => {
      started = true
    },
    onUtterance: (blob) => {
      listener.stop()
      onDone(blob)
    },
  })
  listener.silenceMs = 1400
  listener.start()
  return {
    stop() {
      if (listener.recording) listener.finish()
      else {
        listener.stop()
        if (!started) onDone(null)
      }
    },
  }
}

// Turns streamed markdown into sentences that sound right when read aloud.
export function speakable(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export class SentenceSplitter {
  constructor(onSentence) {
    this.onSentence = onSentence
    this.buffer = ""
    this.inCode = false
  }

  push(chunk) {
    this.buffer += chunk
    for (;;) {
      const fence = this.buffer.indexOf("```")
      if (this.inCode) {
        if (fence === -1) return
        this.buffer = this.buffer.slice(fence + 3)
        this.inCode = false
        continue
      }
      const match = /([.!?؟。！？]+["')\]]?\s+|\n{1,})/.exec(this.buffer)
      if (fence !== -1 && (!match || fence < match.index)) {
        this.emit(this.buffer.slice(0, fence))
        this.buffer = this.buffer.slice(fence + 3)
        this.inCode = true
        continue
      }
      if (!match) return
      const end = match.index + match[0].length
      this.emit(this.buffer.slice(0, end))
      this.buffer = this.buffer.slice(end)
    }
  }

  emit(piece) {
    const clean = speakable(piece)
    if (clean.length > 1) this.onSentence(clean)
  }

  flush() {
    if (!this.inCode) this.emit(this.buffer)
    this.buffer = ""
    this.inCode = false
  }
}

// Plays sentences in order. Server voices are fetched one sentence ahead so speech flows without gaps.
export class Speaker {
  constructor({ server, voice, language, onStart, onIdle } = {}) {
    this.server = server
    this.voice = voice || ""
    this.language = language || voiceLanguage()
    this.onStart = onStart || (() => {})
    this.onIdle = onIdle || (() => {})
    this.queue = []
    this.playing = false
    this.audio = null
    this.generation = 0
  }

  say(text) {
    const item = { text, audio: null }
    if (this.server) item.audio = this.fetchAudio(text, this.generation)
    this.queue.push(item)
    if (!this.playing) this.next()
  }

  async fetchAudio(text, generation) {
    const response = await fetch(API + "/api/voice/speak", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "x-forkwise": "1" },
      body: JSON.stringify({ text, voice: this.voice, format: "mp3" }),
    })
    if (!response.ok || generation !== this.generation) return null
    return URL.createObjectURL(await response.blob())
  }

  async next() {
    const item = this.queue.shift()
    if (!item) {
      this.playing = false
      this.onIdle()
      return
    }
    const generation = this.generation
    if (!this.playing) this.onStart()
    this.playing = true
    let url = null
    if (item.audio) {
      try {
        url = await item.audio
      } catch (problem) {
        url = null
      }
    }
    if (generation !== this.generation) return
    if (url) await this.playUrl(url)
    else await this.playBrowser(item.text)
    if (generation === this.generation) this.next()
  }

  playUrl(url) {
    return new Promise((resolve) => {
      const audio = new Audio(url)
      this.audio = audio
      audio.onended = () => {
        URL.revokeObjectURL(url)
        resolve()
      }
      audio.onerror = () => resolve()
      audio.play().catch(() => resolve())
    })
  }

  playBrowser(text) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) {
        resolve()
        return
      }
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = this.language
      const voices = window.speechSynthesis.getVoices().filter((item) => item.lang && item.lang.toLowerCase().startsWith(this.language.slice(0, 2).toLowerCase()))
      const natural = voices.find((item) => /natural|neural|premium|enhanced|google/i.test(item.name)) || voices[0]
      if (natural) utterance.voice = natural
      utterance.rate = 1.02
      utterance.onend = () => resolve()
      utterance.onerror = () => resolve()
      window.speechSynthesis.speak(utterance)
    })
  }

  get busy() {
    return this.playing || this.queue.length > 0
  }

  stop() {
    this.generation += 1
    this.queue = []
    if (this.audio) {
      this.audio.pause()
      this.audio = null
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel()
    const was = this.playing
    this.playing = false
    if (was) this.onIdle()
  }
}
