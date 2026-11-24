import { useEffect, useState } from "react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { Bitcoin, Check, CheckCircle2, Copy, CreditCard, Lock, Mail, RotateCcw, ShieldCheck, TriangleAlert, Users, MessageSquare, Activity, Cpu } from "lucide-react"
import QRCode from "qrcode"
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

const COIN_INFO = {
  USDT: { name: "Tether", glyph: "₮", color: "#26A17B" },
  USDC: { name: "USD Coin", glyph: "$", color: "#2775CA" },
  BTC: { name: "Bitcoin", glyph: "₿", color: "#F7931A" },
}
const FEE_TEXT = { lowest: "Fee: a few cents", low: "Fee: low", high: "Fee: often several dollars", varies: "Fee: depends on the network" }

function CoinGlyph({ coin, size = 28 }) {
  const info = COIN_INFO[coin] || { glyph: coin.slice(0, 1), color: "var(--tx-3)" }
  return <span className="fw-coin" style={{ width: size, height: size, fontSize: size * 0.5, background: info.color }} aria-hidden="true">{info.glyph}</span>
}

function CoinPicker({ options, value, onChange }) {
  const coins = Array.from(new Set(options.map((item) => item.coin)))
  const current = options.find((item) => item.key === value) || options[0]
  const coin = current ? current.coin : coins[0]
  const networks = options.filter((item) => item.coin === coin)
  function pickCoin(next) {
    const list = options.filter((item) => item.coin === next)
    const best = list.find((item) => item.recommended) || list[0]
    if (best) onChange(best.key)
  }
  return (
    <div className="fw-paycoin">
      <div className="fw-paycoin-coins" role="radiogroup" aria-label="Coin">
        {coins.map((item) => (
          <button key={item} type="button" role="radio" aria-checked={item === coin} className={cx("fw-paycoin-coin", item === coin && "is-on")} onClick={() => pickCoin(item)}>
            <CoinGlyph coin={item} />
            <span><strong>{item}</strong><small>{(COIN_INFO[item] || {}).name || item}</small></span>
          </button>
        ))}
      </div>
      {coin !== "BTC" && (
        <div className="fw-paycoin-nets" role="radiogroup" aria-label="Network">
          {networks.map((item) => (
            <button key={item.key} type="button" role="radio" aria-checked={item.key === value} className={cx("fw-paycoin-net", item.key === value && "is-on")} onClick={() => onChange(item.key)}>
              <span className="fw-paycoin-net-top"><strong>{item.network_label}</strong>{item.standard && <em>{item.standard}</em>}</span>
              <small className={cx(item.fee === "high" && "is-warn")}>{FEE_TEXT[item.fee] || ""}</small>
              {item.recommended && <span className="fw-paycoin-tag">Recommended</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CryptoInvoice({ invoice, onPaid }) {
  const { toast } = useStore()
  const [qr, setQr] = useState("")
  const [state, setState] = useState(invoice)
  const [now, setNow] = useState(Date.now() / 1000)
  const [copied, setCopied] = useState("")

  useEffect(() => {
    QRCode.toDataURL(invoice.address, { margin: 1, width: 360, color: { dark: "#111111", light: "#ffffff" } }).then(setQr).catch(() => setQr(""))
  }, [invoice.address])

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now() / 1000), 1000)
    const poll = setInterval(async () => {
      try {
        const data = await api.get("/api/billing/invoice/" + invoice.id)
        setState(data.invoice)
        if (data.invoice.status === "paid") {
          clearInterval(poll)
          onPaid()
        }
      } catch (problem) {
        // keep waiting; the next poll retries
      }
    }, 8000)
    return () => { clearInterval(clock); clearInterval(poll) }
  }, [invoice.id])

  function copy(text, what) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(what)
      toast(what + " copied", "success")
      setTimeout(() => setCopied(""), 1800)
    }).catch(() => toast("Copy failed. Select the text and copy it by hand.", "error"))
  }

  const total = Math.max(1, (state.expires_at || 0) - (state.created_at || state.expires_at - 1800))
  const left = Math.max(0, Math.round(state.expires_at - now))
  const share = Math.max(0, Math.min(100, (left / total) * 100))
  const clock = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0")
  const network = state.network_label + (state.standard ? " (" + state.standard + ")" : "")

  if (state.status === "paid") {
    return (
      <div className="fw-payinv-done">
        <span className="fw-payinv-done-icon"><CheckCircle2 size={34} /></span>
        <strong>Payment received</strong>
        <p>Your plan is on. Taking you to Plan and usage…</p>
      </div>
    )
  }
  return (
    <div className="fw-payinv">
      <div className="fw-payinv-status">
        <span className="fw-payinv-pulse" aria-hidden="true" />
        <span>{left > 0 ? "Waiting for your payment" : "Still watching for 24 hours"}</span>
        <span className="fw-payinv-clock">{left > 0 ? clock : "late payments count"}</span>
      </div>
      <div className="fw-payinv-bar" aria-hidden="true"><i style={{ width: share + "%" }} /></div>

      <div className="fw-payinv-grid">
        <div className="fw-payinv-qr">
          {qr ? <img src={qr} alt={"QR code of the " + network + " address"} /> : <div className="fw-payinv-qr-empty" />}
          <span><CoinGlyph coin={state.coin} size={22} /></span>
        </div>
        <div className="fw-payinv-fields">
          <div className="fw-payinv-field">
            <span className="fw-payinv-label">Send exactly</span>
            <button type="button" className={cx("fw-payinv-copy is-amount", copied === "Amount" && "is-copied")} onClick={() => copy(state.amount, "Amount")} aria-label={"Copy amount " + state.amount}>
              <strong>{state.amount}</strong><em>{state.coin}</em>{copied === "Amount" ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <div className="fw-payinv-field">
            <span className="fw-payinv-label">To this address</span>
            <button type="button" className={cx("fw-payinv-copy", copied === "Address" && "is-copied")} onClick={() => copy(state.address, "Address")} aria-label="Copy address">
              <code>{state.address}</code>{copied === "Address" ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <div className="fw-payinv-net"><CoinGlyph coin={state.coin} size={18} /><span>{state.coin + " on " + network}</span></div>
        </div>
      </div>

      <div className="fw-payinv-warn">
        <TriangleAlert size={16} />
        <span>{"Use the " + network + " network only. Coins sent on any other network are lost. Send the amount to the last digit: it is how your payment is found. Wallet fees go on top."}</span>
      </div>
      <ul className="fw-checkout-trust">
        <li><ShieldCheck size={13} />Paid straight to Forkwise's own wallet. No card or account details needed.</li>
        <li><Lock size={13} />Your plan switches on by itself a few minutes after the network confirms the payment. You can close this window.</li>
      </ul>
    </div>
  )
}

function CheckoutDialog({ plan, yearly, info, onClose }) {
  const { toast, user } = useStore()
  const methods = (info && info.methods) || []
  const firstOn = (methods.find((item) => item.enabled) || {}).key || "card"
  const [method, setMethod] = useState(firstOn)
  const [period, setPeriod] = useState(yearly ? "year" : "month")
  const [busy, setBusy] = useState(false)
  const [invoice, setInvoice] = useState(null)
  const coins = ((methods.find((item) => item.key === "crypto") || {}).coins) || []
  const [coin, setCoin] = useState("")

  useEffect(() => {
    if (plan) {
      setMethod(firstOn)
      setPeriod(yearly ? "year" : "month")
      setBusy(false)
      setInvoice(null)
      setCoin(coins.length ? ((coins.find((item) => item.recommended) || coins[0]).key) : "")
    }
  }, [plan])

  const prices = (info && info.prices && plan && info.prices[plan.key]) || {}
  const total = prices[period] || 0
  const perMonth = period === "year" ? Math.round((total / 12) * 100) / 100 : total
  const chosen = methods.find((item) => item.key === method) || {}

  async function pay() {
    setBusy(true)
    try {
      const data = await api.post("/api/billing/checkout", { plan: plan.key, period, method, coin })
      if (data.invoice) {
        setInvoice(data.invoice)
        setBusy(false)
        return
      }
      window.location.href = data.url
    } catch (problem) {
      toast(problem.message, "error")
      setBusy(false)
    }
  }

  return (
    <Dialog open={Boolean(plan)} onClose={onClose} size="md" title={plan ? "Upgrade to " + plan.name : ""} description={invoice ? "Pay from any wallet, for example Trust Wallet. The payment goes straight to Forkwise's wallet." : method === "card" ? "You'll finish on a secure payment page. Your card details never touch Forkwise servers." : "Choose a coin and network. You'll get an address and an exact amount to send."}
      footer={invoice ? <Button variant="ghost" onClick={onClose}>Close</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={Lock} loading={busy} disabled={!chosen.enabled || (method === "crypto" && !coin)} onClick={pay}>{"Continue to payment · $" + total}</Button></>}>
      {plan && invoice && <CryptoInvoice invoice={invoice} onPaid={() => { setTimeout(() => window.location.assign("/app/billing?paid=1"), 1500) }} />}
      {plan && !invoice && (
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
                  <span><strong>{item.key === "card" ? "Card" : "Crypto"}</strong><small>{item.key === "card" ? "Visa, Mastercard, Amex, PayPal, Apple Pay" : "USDT, USDC or Bitcoin, from any wallet"}</small></span>
                  {!item.enabled && <Badge>Soon</Badge>}
                </button>
              ))}
            </div>
          </div>
          {method === "crypto" && coins.length > 0 && (
            <div className="fw-field">
              <span className="fw-field-label">Coin and network</span>
              <CoinPicker options={coins} value={coin} onChange={setCoin} />
            </div>
          )}
          <div className="fw-checkout-summary">
            <div><span>{plan.name} · {period === "year" ? "12 months" : "30 days"}</span><span>${total}</span></div>
            {period === "year" && <div className="fw-muted"><span>That's ${perMonth} a month</span><span /></div>}
            <div className="fw-checkout-total"><span>Due today</span><strong>${total}</strong></div>
          </div>
          <ul className="fw-checkout-trust">
            <li><ShieldCheck size={13} />{method === "card" ? "Processed by Lemon Squeezy, our merchant of record. Taxes are added at checkout where required." : "Paid straight to Forkwise's wallet. Your plan turns on by itself when the network confirms the payment."}</li>
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
