import { useEffect, useRef, useState } from "react"
import { Mic, MicOff, X } from "lucide-react"
import { Listener, SentenceSplitter, Speaker, canRecord, preferredVoice, transcribe, voiceInfo, voiceLanguage } from "../../lib/voice"

const LABELS = {
  starting: "Starting…",
  listening: "Listening",
  hearing: "Listening",
  thinking: "Thinking",
  working: "Working on it",
  speaking: "Speaking",
  muted: "Muted",
}

function browserRecognizer() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

// A spoken conversation with the agent: you talk, it answers out loud, and you can interrupt it.
export default function VoiceMode({ live, onSend, onClose }) {
  const [phase, setPhase] = useState("starting")
  const [heard, setHeard] = useState("")
  const [saying, setSaying] = useState("")
  const [error, setError] = useState("")
  const [muted, setMuted] = useState(false)
  const orb = useRef(null)
  const listener = useRef(null)
  const speaker = useRef(null)
  const splitter = useRef(null)
  const recognizer = useRef(null)
  const armed = useRef(false)
  const spokenText = useRef("")
  const running = useRef(live.running)
  const liveText = useRef(live.text || "")
  liveText.current = live.text || ""
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  running.current = live.running

  function settle() {
    if (speaker.current && speaker.current.busy) return
    if (running.current && armed.current) {
      setPhase("working")
      return
    }
    setPhase(listener.current && listener.current.paused ? "muted" : "listening")
    if (listener.current) listener.current.setStrict(false)
    if (recognizer.current === "idle") listenBrowser()
  }

  async function heardText(text) {
    const clean = (text || "").trim()
    if (!clean) {
      settle()
      return
    }
    setHeard(clean)
    setSaying("")
    if (speaker.current) speaker.current.stop()
    if (splitter.current) splitter.current = new SentenceSplitter(sayOne)
    spokenText.current = liveText.current
    armed.current = true
    setPhase("thinking")
    try {
      await onSend(clean, { voice: true })
    } catch (problem) {
      setError(problem.message || "The message could not be sent.")
      settle()
    }
  }

  function sayOne(sentence) {
    setSaying(sentence)
    speaker.current.say(sentence)
  }

  function listenBrowser() {
    const Speech = browserRecognizer()
    if (!Speech) return
    const recognition = new Speech()
    recognition.lang = voiceLanguage()
    recognition.interimResults = true
    recognition.continuous = false
    recognition.onresult = (event) => {
      let text = ""
      let final = false
      for (let index = 0; index < event.results.length; index += 1) {
        text += event.results[index][0].transcript
        if (event.results[index].isFinal) final = true
      }
      if (speaker.current && speaker.current.busy) speaker.current.stop()
      setHeard(text)
      setPhase("hearing")
      if (final) {
        recognizer.current = "busy"
        heardText(text)
      }
    }
    recognition.onend = () => {
      if (recognizer.current === "listening") {
        recognizer.current = "idle"
        if (phaseRef.current === "listening" || phaseRef.current === "hearing") setTimeout(listenBrowser, 150)
      }
    }
    recognition.onerror = (event) => {
      if (event.error === "not-allowed") setError("Microphone access is blocked. Allow it in the browser's site settings.")
    }
    try {
      recognition.start()
      recognizer.current = "listening"
    } catch (problem) {
      recognizer.current = "idle"
    }
  }

  useEffect(() => {
    let alive = true
    voiceInfo().then(async (info) => {
      if (!alive) return
      speaker.current = new Speaker({
        server: info.speak,
        voice: preferredVoice() || info.voice,
        language: voiceLanguage(),
        onStart: () => {
          setPhase("speaking")
          if (listener.current) listener.current.setStrict(true)
        },
        onIdle: () => settle(),
      })
      splitter.current = new SentenceSplitter(sayOne)
      if (info.transcribe && canRecord()) {
        const instance = new Listener({
          onLevel: (value) => {
            if (orb.current) orb.current.style.setProperty("--level", value.toFixed(3))
          },
          onSpeechStart: () => {
            if (speaker.current && speaker.current.busy) speaker.current.stop()
            setPhase("hearing")
          },
          onUtterance: async (blob) => {
            setPhase("thinking")
            try {
              heardText(await transcribe(blob))
            } catch (problem) {
              setError(problem.message)
              settle()
            }
          },
          onError: (message) => setError(message),
        })
        listener.current = instance
        const ok = await instance.start()
        if (!alive) {
          instance.stop()
          return
        }
        if (ok) setPhase("listening")
      } else if (browserRecognizer()) {
        recognizer.current = "idle"
        setPhase("listening")
        listenBrowser()
      } else {
        setError("Voice needs a microphone and Chrome, Edge or Safari, or speech to text set up on the server.")
      }
    })
    function onKey(event) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => {
      alive = false
      document.removeEventListener("keydown", onKey)
      if (listener.current) listener.current.stop()
      if (speaker.current) speaker.current.stop()
      recognizer.current = null
    }
  }, [])

  // Read the reply aloud while it streams in.
  useEffect(() => {
    if (!armed.current || !splitter.current) return
    const text = live.text || ""
    const before = spokenText.current
    if (text.startsWith(before)) {
      const delta = text.slice(before.length)
      if (delta) splitter.current.push(delta)
    } else {
      splitter.current.flush()
      splitter.current.push(text)
    }
    spokenText.current = text
  }, [live.text])

  useEffect(() => {
    if (!armed.current) return
    if (!live.running) {
      if (splitter.current) splitter.current.flush()
      spokenText.current = ""
      armed.current = false
      settle()
    } else if (phaseRef.current === "thinking" && !(speaker.current && speaker.current.busy)) {
      setPhase("working")
    }
  }, [live.running])

  function toggleMute() {
    const next = !muted
    setMuted(next)
    if (listener.current) {
      if (next) listener.current.pause()
      else listener.current.resume()
    }
    if (phase === "listening" || phase === "muted") setPhase(next ? "muted" : "listening")
  }

  return (
    <div className={"fw-voice is-" + phase} role="region" aria-label="Voice conversation">
      <div className="fw-voice-orb" ref={orb} aria-hidden="true"><span /><span /><span /></div>
      <div className="fw-voice-body">
        <div className="fw-voice-status" aria-live="polite">{error || LABELS[phase]}</div>
        <div className="fw-voice-caption" dir="auto">
          {phase === "speaking" && saying ? saying : heard ? <span className="fw-voice-heard">{heard}</span> : "Say something. You can interrupt at any time."}
        </div>
      </div>
      <div className="fw-voice-actions">
        <button type="button" className={"fw-voice-btn" + (muted ? " on" : "")} onClick={toggleMute} aria-pressed={muted} title={muted ? "Unmute" : "Mute"} aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? <MicOff size={17} /> : <Mic size={17} />}
        </button>
        <button type="button" className="fw-voice-btn end" onClick={onClose} title="End voice (Esc)" aria-label="End voice conversation"><X size={17} /></button>
      </div>
    </div>
  )
}
