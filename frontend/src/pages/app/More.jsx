import { useEffect, useState } from "react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { Bitcoin, Check, CheckCircle2, CreditCard, Lock, Mail, RotateCcw, ShieldCheck, Users, MessageSquare, Activity, Cpu } from "lucide-react"
import { Badge, Button, Dialog, Meter, Segmented, Skeleton, Spinner, cx } from "../../dash/kit"
import { useStore } from "../../lib/store"
import { api } from "../../lib/api"
import { PLANS, TEMPLATES } from "../../content/catalog"

function formatNumber(value) {
  return Number(value || 0).toLocaleString()
}

function planName(key) {
  return key.charAt(0).toUpperCase() + key.slice(1)
}

function shortDate(seconds) {
  return new Date(seconds * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function CheckoutDialog({ plan, yearly, info, onClose }) {
  const { toast, user } = useStore()
  const methods = (info && info.methods) || []
  const firstOn = (methods.find((item) => item.enabled) || {}).key || "card"
  const [method, setMethod] = useState(firstOn)
  const [period, setPeriod] = useState(yearly ? "year" : "month")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (plan) {
      setMethod(firstOn)
      setPeriod(yearly ? "year" : "month")
      setBusy(false)
    }
  }, [plan])

  const prices = (info && info.prices && plan && info.prices[plan.key]) || {}
  const total = prices[period] || 0
  const perMonth = period === "year" ? Math.round((total / 12) * 100) / 100 : total
  const chosen = methods.find((item) => item.key === method) || {}

  async function pay() {
    setBusy(true)
    try {
      const data = await api.post("/api/billing/checkout", { plan: plan.key, period, method })
      window.location.href = data.url
    } catch (problem) {
      toast(problem.message, "error")
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(plan)} onClose={onClose} size="md" title={plan ? "Upgrade to " + plan.name : ""} description="You'll finish on a secure payment page. Your card details never touch Forkwise servers."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Lock} loading={busy} disabled={!chosen.enabled} onClick={pay}>{"Continue to payment · $" + total}</Button></>}>
      {plan && (
        <div className="fw-checkout">
          <div className="fw-checkout-periods" role="radiogroup">
            {["month", "year"].map((value) => (
              <button key={value} type="button" role="radio" aria-checked={period === value} className={cx("fw-checkout-period", period === value && "is-on")} onClick={() => setPeriod(value)}>
                <span><strong>{value === "year" ? "Yearly" : "Monthly"}</strong>{value === "year" && <Badge tone="blue">Save 20%</Badge>}</span>
                <small>{"$" + (value === "year" ? Math.round(((prices.year || 0) / 12) * 100) / 100 : prices.month || 0) + " / month"}{value === "year" ? ", billed $" + (prices.year || 0) + " once" : ""}</small>
              </button>
            ))}
          </div>
          <div className="fw-field">
            <span className="fw-field-label">Pay with</span>
            <div className="fw-checkout-methods">
              {methods.map((item) => (
                <button key={item.key} type="button" disabled={!item.enabled} className={cx("fw-checkout-method", method === item.key && "is-on")} onClick={() => setMethod(item.key)}>
                  {item.key === "card" ? <CreditCard size={16} /> : <Bitcoin size={16} />}
                  <span><strong>{item.key === "card" ? "Card" : "Crypto"}</strong><small>{item.key === "card" ? "Visa, Mastercard, Amex, PayPal, Apple Pay" : "USDT, Bitcoin, Ethereum and more"}</small></span>
                  {!item.enabled && <Badge>Soon</Badge>}
                </button>
              ))}
            </div>
          </div>
          <div className="fw-checkout-summary">
            <div><span>{plan.name} · {period === "year" ? "12 months" : "30 days"}</span><span>${total}</span></div>
            {period === "year" && <div className="fw-muted"><span>That's ${perMonth} a month</span><span /></div>}
            <div className="fw-checkout-total"><span>Due today</span><strong>${total}</strong></div>
          </div>
          <ul className="fw-checkout-trust">
            <li><ShieldCheck size={13} />{method === "card" ? "Processed by Lemon Squeezy, our merchant of record. Taxes are added at checkout where required." : "Processed by NOWPayments. Your plan turns on when the network confirms the payment."}</li>
            <li><Mail size={13} />A receipt goes to {user.email}.</li>
            <li><RotateCcw size={13} />No automatic renewal. Pay again any time to extend.</li>
          </ul>
        </div>
      )}
    </Dialog>
  )
}

export function Billing() {
  const { usage } = useStore()
  const [days, setDays] = useState([])
  const [limit, setLimit] = useState(0)
  const [info, setInfo] = useState(null)
  const [yearly, setYearly] = useState(false)
  const [buying, setBuying] = useState(null)
  const [params] = useSearchParams()
  const justPaid = params.get("paid") === "1"

  async function loadInfo() {
    try {
      const data = await api.get("/api/billing")
      setInfo(data)
      setLimit(data.limit)
      return data
    } catch (problem) {
      return null
    }
  }

  useEffect(() => {
    api.get("/api/usage").then((data) => {
      setDays(data.days)
      setLimit(data.limit)
    }).catch(() => setDays([]))
    loadInfo()
  }, [])

  useEffect(() => {
    if (!justPaid) return undefined
    let tries = 0
    const timer = setInterval(async () => {
      tries = tries + 1
      const data = await loadInfo()
      if ((data && data.plan !== "free") || tries >= 40) clearInterval(timer)
    }, 10000)
    return () => clearInterval(timer)
  }, [justPaid])

  const today = usage ? usage.tokens_in + usage.tokens_out : 0
  const month = days.reduce((total, day) => total + day.tokens_in + day.tokens_out, 0)
  const runs = days.reduce((total, day) => total + day.runs, 0)
  const current = info ? info.plan : "free"
  const until = info && info.plan_until > 0 && current !== "free" ? shortDate(info.plan_until) : ""
  const peak = Math.max(1, ...days.map((day) => day.tokens_in + day.tokens_out))
  const order = ["free", "pro", "premium", "teams"]

  return (
    <div className="fw-page fw-page-enter">
      <div className="fw-billing">
        <header className="fw-pagehead">
          <div>
            <h1>Plan and billing</h1>
            <p>Your plan, usage and payment history.</p>
          </div>
        </header>
        {justPaid && current === "free" && <div className="fw-banner"><Spinner size={14} />Thanks. We're confirming your payment. Your plan switches on by itself, usually within a few minutes.</div>}
        {justPaid && current !== "free" && <div className="fw-banner is-ok"><CheckCircle2 size={15} />Payment received. {planName(current)} is active.</div>}

        <div className="fw-billing-top">
          <section className="fw-billing-plan">
            <span className="fw-stat-label">Current plan</span>
            <div className="fw-billing-plan-name"><strong>{planName(current)}</strong><Badge tone={current === "free" ? "neutral" : "blue"} dot>{current === "free" ? "Free forever" : "Active"}</Badge></div>
            <p>{until ? "Paid through " + until + ". Pay again any time to extend." : "Upgrade for more daily usage and the strongest models."}</p>
          </section>
          <section className="fw-billing-usage">
            <div className="fw-billing-usage-row"><span>Today</span><span>{formatNumber(today)}{limit > 0 ? " of " + formatNumber(limit) : ""} tokens</span></div>
            {limit > 0 && <Meter value={today} max={limit} />}
            {month > 0 && <div className="fw-spark" aria-hidden="true">{days.slice(-30).map((day) => <i key={day.day} style={{ height: Math.max(2, ((day.tokens_in + day.tokens_out) / peak) * 100) + "%" }} title={day.day} />)}</div>}
            <div className="fw-billing-usage-row is-muted"><span>Last 30 days</span><span>{formatNumber(month)} tokens · {runs} tasks</span></div>
          </section>
        </div>

        <div className="fw-plans-bar">
          <h2 className="fw-section-label">Plans</h2>
          <Segmented size="sm" value={yearly ? "year" : "month"} onChange={(value) => setYearly(value === "year")} options={[{ value: "month", label: "Monthly" }, { value: "year", label: "Yearly · save 20%" }]} />
        </div>
        <div className="fw-plan-grid">
          {PLANS.map((plan) => {
            const price = yearly ? plan.yearly : plan.monthly
            const isCurrent = plan.key === current
            const lower = order.indexOf(plan.key) < order.indexOf(current)
            return (
              <article key={plan.key} className={cx("fw-plan", isCurrent && "is-current", plan.featured && "is-featured")}>
                <header><strong>{plan.name}</strong>{isCurrent ? <Badge tone="blue">Current</Badge> : plan.tag ? <Badge>{plan.tag}</Badge> : null}</header>
                <div className="fw-plan-price">{price === null ? "Custom" : "$" + price}{price !== null && <small>/ month</small>}</div>
                <p className="fw-plan-desc">{plan.desc}</p>
                {plan.key === "teams" && <Link to="/contact?topic=Teams" className="fw-btn fw-btn-secondary fw-btn-md fw-plan-cta"><span>Talk to us</span></Link>}
                {plan.key === "free" && <Button className="fw-plan-cta" disabled>{isCurrent ? "Your plan" : "Included"}</Button>}
                {(plan.key === "pro" || plan.key === "premium") && (
                  <Button className="fw-plan-cta" variant={plan.featured && !isCurrent ? "primary" : "secondary"} disabled={!info || !info.enabled || lower} title={info && !info.enabled ? "Payments aren't switched on yet" : ""} onClick={() => setBuying(plan)}>
                    {isCurrent ? "Extend" : lower ? "Included" : "Upgrade"}
                  </Button>
                )}
                <ul>{plan.features.map((feature) => <li key={feature}><Check size={13} />{feature}</li>)}</ul>
              </article>
            )
          })}
        </div>
        {info && !info.enabled && <p className="fw-muted fw-small-text" style={{ marginTop: 12 }}>Payments aren't switched on for this server yet.</p>}

        <h2 className="fw-section-label" style={{ marginTop: 36 }}>Payment history</h2>
        <div className="fw-table-wrap">
          <table className="fw-table">
            <thead><tr><th>Date</th><th>Plan</th><th>Method</th><th className="is-num">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {!info && <tr><td colSpan={5}><Skeleton lines={1} /></td></tr>}
              {info && info.payments.length === 0 && <tr><td colSpan={5} className="fw-muted">No payments yet.</td></tr>}
              {info && info.payments.map((row) => (
                <tr key={row.id}>
                  <td>{shortDate(row.created_at)}</td>
                  <td>{planName(row.plan)} · {row.period === "year" ? "yearly" : "monthly"}</td>
                  <td className="fw-muted">{row.invoice_id === "card" ? "Card" : "Crypto"}</td>
                  <td className="is-num">${row.amount}</td>
                  <td><Badge tone={row.status === "paid" ? "blue" : row.status === "amount_mismatch" ? "red" : "neutral"} dot>{row.status === "paid" ? "Paid" : row.status === "created" ? "Not paid" : row.status === "amount_mismatch" ? "Amount too low" : planName(row.status)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <CheckoutDialog plan={buying} yearly={yearly} info={info} onClose={() => setBuying(null)} />
    </div>
  )
}

export function AppTemplates() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState("All")
  const categories = ["All", "Websites", "Data", "Automation", "Media"]
  return (
    <div className="fw-page fw-wide-page">
      <div className="fw-page-head"><div><h1>Templates</h1><p className="fw-muted">Pick one to open a new chat with it. You can change it before sending.</p></div></div>
      <div className="fw-seg">
        {categories.map((name) => <button key={name} type="button" className={filter === name ? "fw-active" : ""} onClick={() => setFilter(name)}>{name}</button>)}
      </div>
      <div className="fw-tpl-grid">
        {TEMPLATES.filter((item) => filter === "All" || item.category === filter).map((item) => (
          <button key={item.slug} type="button" className="fw-tpl" onClick={() => navigate("/app?template=" + item.slug)}>
            <div className="fw-tpl-body"><span className="fw-chip fw-accent">{item.category}</span><p>{item.text}</p></div>
          </button>
        ))}
      </div>
    </div>
  )
}
