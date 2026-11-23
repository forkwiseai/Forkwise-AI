import { useEffect, useRef } from "react"

// The Forkwise mark, drawn in code: a root that forks into three branches.
// While the agent works, the branches flow from one pose to the next on their own, with a rhythm
// that fits the work (reading, thinking, running, writing). When the work stops, the mark eases
// back into its resting logo shape.

const ROOT = { x: 5, y: 12 }
// A pose = three branches (angle in degrees from the root, length) + the size of the tips.
const REST = { b: [[-25.5, 15], [0, 13.6], [25.5, 15]], tip: 1 }
const POSES = {
  fold: { b: [[-7, 14], [0, 13.6], [7, 14]], tip: 0.8 },
  fan: { b: [[-44, 12.5], [0, 14.6], [44, 12.5]], tip: 1.15 },
  sweepUp: { b: [[-38, 12], [-14, 14.2], [16, 15]], tip: 1 },
  sweepDown: { b: [[-16, 15], [14, 14.2], [38, 12]], tip: 1 },
  reach: { b: [[-20, 16], [0, 15.6], [20, 16]], tip: 1.2 },
  tuck: { b: [[-30, 10.5], [0, 11.5], [30, 10.5]], tip: 0.85 },
}
const MODES = {
  read: { order: ["sweepUp", "fold", "sweepDown", "fold"], step: 620 },
  think: { order: ["fan", "tuck", "REST", "fold"], step: 1150 },
  run: { order: ["reach", "tuck", "fan", "fold"], step: 520 },
  write: { order: ["REST", "fold", "REST", "reach"], step: 760 },
  work: { order: ["fan", "fold", "sweepUp", "REST", "sweepDown", "tuck"], step: 820 },
}

// Which rhythm fits a tool or a step category.
export function markMode(nameOrCategory) {
  const key = String(nameOrCategory || "")
  if (/^(explore|browse|read_file|list_dir|glob|grep|web_search|web_fetch|use_skill|memory|job_output|browser|screenshot)$/.test(key)) return "read"
  if (/^(run|computer|bash|kill_job|preview)$/.test(key)) return "run"
  if (/^(edit|write_file|edit_file|multi_edit|create_tool|save_skill)$/.test(key)) return "write"
  if (/^(agent|task|think)$/.test(key)) return "think"
  return "work"
}

function poseOf(name) {
  return name === "REST" ? REST : POSES[name]
}

function ease(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function mix(a, b, t) {
  return { b: a.b.map((item, i) => [item[0] + (b.b[i][0] - item[0]) * t, item[1] + (b.b[i][1] - item[1]) * t]), tip: a.tip + (b.tip - a.tip) * t }
}

function end(branch) {
  const angle = (branch[0] * Math.PI) / 180
  return { x: ROOT.x + Math.cos(angle) * branch[1], y: ROOT.y + Math.sin(angle) * branch[1] }
}

function branchPath(branch) {
  const tip = end(branch)
  const reach = tip.x - ROOT.x
  return "M" + ROOT.x + " " + ROOT.y + " C " + (ROOT.x + reach * 0.42) + " " + ROOT.y + ", " + (tip.x - reach * 0.38) + " " + tip.y + ", " + tip.x + " " + tip.y
}

function draw(svg, pose, beat) {
  if (!svg) return
  const paths = svg.querySelectorAll(".fk-line")
  const tips = svg.querySelectorAll(".fk-tip")
  pose.b.forEach((branch, i) => {
    const tip = end(branch)
    if (paths[i]) paths[i].setAttribute("d", branchPath(branch))
    if (tips[i]) {
      const pulse = 1 + 0.28 * Math.max(0, Math.sin(beat - i * 0.9))
      tips[i].setAttribute("cx", tip.x.toFixed(2))
      tips[i].setAttribute("cy", tip.y.toFixed(2))
      tips[i].setAttribute("r", ((i === 1 ? 2.3 : 1.7) * pose.tip * pulse).toFixed(2))
    }
  })
}

const calm = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches

export default function ForkMark({ size = 16, active = false, mode = "work", className = "" }) {
  const svg = useRef(null)
  const state = useRef({ pose: REST, from: REST, to: REST, index: 0, started: 0, frame: 0, active: false, mode })

  useEffect(() => {
    const s = state.current
    s.active = active && !calm && !document.documentElement.classList.contains("calm")
    s.mode = MODES[mode] ? mode : "work"
    if (s.frame) return undefined
    const tick = (now) => {
      const plan = MODES[s.mode]
      if (!s.started) s.started = now
      const t = Math.min(1, (now - s.started) / (s.active ? plan.step : 420))
      s.pose = mix(s.from, s.to, ease(t))
      draw(svg.current, s.pose, s.active ? now / 190 : 0)
      if (t >= 1) {
        s.from = s.to
        s.started = now
        if (s.active) {
          s.index = (s.index + 1) % plan.order.length
          s.to = poseOf(plan.order[s.index])
        } else if (s.to !== REST) {
          s.to = REST
        } else {
          s.frame = 0
          draw(svg.current, REST, 0)
          return
        }
      }
      s.frame = requestAnimationFrame(tick)
    }
    if (s.active || s.pose !== REST) {
      s.from = s.pose
      s.to = s.active ? poseOf(MODES[s.mode].order[s.index % MODES[s.mode].order.length]) : REST
      s.started = 0
      s.frame = requestAnimationFrame(tick)
    }
    return undefined
  }, [active, mode])

  useEffect(() => () => {
    cancelAnimationFrame(state.current.frame)
    state.current.frame = 0
  }, [])

  return (
    <svg ref={svg} className={"fw-fork" + (active ? " is-active" : "") + (className ? " " + className : "")} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path className="fk-line fk-side" d={branchPath(REST.b[0])} />
      <path className="fk-line fk-main" d={branchPath(REST.b[1])} />
      <path className="fk-line fk-side" d={branchPath(REST.b[2])} />
      <circle className="fk-tip fk-side-tip" cx={end(REST.b[0]).x} cy={end(REST.b[0]).y} r="1.7" />
      <circle className="fk-tip fk-head" cx={end(REST.b[1]).x} cy={end(REST.b[1]).y} r="2.3" />
      <circle className="fk-tip fk-side-tip" cx={end(REST.b[2]).x} cy={end(REST.b[2]).y} r="1.7" />
      <circle className="fk-root" cx={ROOT.x} cy={ROOT.y} r="2.4" />
    </svg>
  )
}
