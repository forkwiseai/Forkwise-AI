import { api } from "./api"

// Talks to Forkwise for Chrome. The extension lets only forkwiseai.com reach it
// ("externally_connectable"), so other sites cannot link it to an account.

const FALLBACK_IDS = ["ifdnipndnhjfgjgjaljleajebhjpnogn"]

function sendTo(id, message) {
  return new Promise((resolve) => {
    const runtime = window.chrome && window.chrome.runtime
    if (!runtime || !runtime.sendMessage) {
      resolve(null)
      return
    }
    const timer = setTimeout(() => resolve(null), 3000)
    try {
      runtime.sendMessage(id, message, (answer) => {
        clearTimeout(timer)
        if (runtime.lastError) resolve(null)
        else resolve(answer || null)
      })
    } catch (problem) {
      clearTimeout(timer)
      resolve(null)
    }
  })
}

export async function talk(ids, message) {
  for (const id of ids && ids.length ? ids : FALLBACK_IDS) {
    const answer = await sendTo(id, message)
    if (answer) return answer
  }
  return null
}

export async function browserState() {
  const server = await api.get("/api/browser").catch(() => null)
  const ids = (server && server.extension_ids) || FALLBACK_IDS
  const extension = await talk(ids, { type: "hello" })
  return { server, extension, ids }
}

export async function linkBrowser(ids) {
  const data = await api.post("/api/browser/pair")
  const answer = await talk(ids, { type: "pair", token: data.token, server: data.server })
  if (!answer || !answer.ok) throw new Error((answer && answer.error) || "Forkwise for Chrome did not answer. Reload this page and try again.")
  return answer
}

export async function unlinkBrowser(ids) {
  await talk(ids, { type: "unpair" })
  await api.del("/api/browser").catch(() => null)
}

// Called when a signed-in page opens: if the extension is installed but not linked yet,
// link it now, so the user never has to press a button.
let tried = false
export async function autoLink() {
  if (tried) return false
  tried = true
  try {
    if (sessionStorage.getItem("fw-browser-off") === "1") return false
  } catch (problem) {
    // storage blocked: carry on
  }
  const state = await browserState()
  if (!state.extension || !state.extension.installed) return false
  if (state.extension.linked || (state.server && state.server.connected)) return false
  try {
    await linkBrowser(state.ids)
    return true
  } catch (problem) {
    return false
  }
}
