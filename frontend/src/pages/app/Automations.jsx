import Schedules from "./settings/Schedules"
import { PageHeader } from "../../dash/kit"

export default function Automations() {
  return (
    <div className="fw-page">
      <PageHeader title="Automations" description="Tasks Forkwise runs on a schedule: a daily report, a weekly check, a reminder. Each run starts its own chat." />
      <Schedules />
    </div>
  )
}
