// The Forkwise mark drawn in code: one root that forks into three paths.
// While the agent works, the outer branches fold in and fan out again and the tips pulse in turn;
// when the work is done the mark settles back into its resting shape.
export default function ForkMark({ size = 16, active = false, className = "" }) {
  return (
    <svg className={"fw-fork" + (active ? " is-active" : "") + (className ? " " + className : "")} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g className="fk-branch fk-top">
        <path d="M5 12 C 10.5 12, 11 5.5, 18 5.5" />
        <circle cx="18.6" cy="5.5" r="1.7" className="fk-tip fk-tip-a" />
      </g>
      <g className="fk-branch fk-bottom">
        <path d="M5 12 C 10.5 12, 11 18.5, 18 18.5" />
        <circle cx="18.6" cy="18.5" r="1.7" className="fk-tip fk-tip-c" />
      </g>
      <path className="fk-main" d="M5 12 H 17" />
      <circle cx="18.6" cy="12" r="2.3" className="fk-tip fk-tip-b fk-head" />
      <circle cx="5" cy="12" r="2.4" className="fk-root" />
    </svg>
  )
}
