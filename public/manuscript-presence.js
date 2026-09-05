// Manuscript presence v1 (Wave H13) — same-device, multi-tab "you have this
// chapter open in N tab(s)" dots on the manuscript list. Honest scope: this
// is NOT live multi-member presence. localStorage is per-device, so a
// heartbeat here can only ever see other tabs of the same browser on this
// device. There is no server channel, no polling, no fetch — purely
// localStorage heartbeats + storage events, and it never blocks, never
// locks, never claims collaborators it cannot see. Each tab owns exactly one
// per-path key, so tabs never clobber each other. Pure helpers are exported
// so node --test can verify the heartbeat lifecycle and the honest label.
import { escapeHtml } from './timeline.js'

export const PRESENCE_KEY_PREFIX = 'geor:manuscript-presence:'
export const PRESENCE_TAB_TTL_MS = 15000
export const PRESENCE_HEARTBEAT_MS = 6000
export const PRESENCE_STORAGE_LABEL = 'Single-device presence v1 — this device only, no live collaborators yet.'

function cleanPresencePath(value) {
  if (typeof value !== 'string') return null
  const path = value.trim()
  if (!path || path.length > 500 || path.includes('..') || /[<>\u0000-\u001F\u007F]/.test(path)) return null
  return path
}

// Base prefix for one path — the browser scans `${this}:<tabId>` keys.
export function presenceKey(path) {
  const clean = cleanPresencePath(path)
  if (!clean) return null
  return `${PRESENCE_KEY_PREFIX}${clean}`
}

export function cleanTabId(value) {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return /^[a-z0-9-]{1,80}$/i.test(id) ? id : null
}

// Parse stored presence JSON into live tabs (stale heartbeats pruned).
export function parsePresence(raw, now = Date.now()) {
  let data = null
  try { data = JSON.parse(String(raw ?? '[]')) } catch { data = null }
  if (!Array.isArray(data)) return []
  const out = []
  for (const row of data) {
    const id = cleanTabId(row?.id)
    const at = typeof row?.at === 'number' && Number.isFinite(row.at) ? row.at : NaN
    if (!id || !Number.isFinite(at)) continue
    if (now - at > PRESENCE_TAB_TTL_MS) continue
    out.push({ id, at })
  }
  return out
}

export function serializePresence(tabs) {
  return JSON.stringify((tabs ?? []).map(tab => ({ id: String(tab?.id ?? ''), at: tab?.at })))
}

// Register this tab's fresh heartbeat (pure). Returns a new array.
export function presenceHeartbeat(tabs, tabId, now = Date.now()) {
  const id = cleanTabId(tabId)
  if (!id) return [...(tabs ?? [])]
  const seen = new Set()
  const out = []
  for (const tab of tabs ?? []) {
    if (!cleanTabId(tab?.id) || seen.has(tab.id)) continue
    seen.add(tab.id)
    out.push({ id: tab.id, at: tab.id === id ? now : tab.at })
  }
  if (!seen.has(id)) out.push({ id, at: now })
  return out
}

// Remove this tab from the list (pure).
export function presenceLeave(tabs, tabId) {
  const id = cleanTabId(tabId)
  if (!id) return [...(tabs ?? [])]
  return (tabs ?? []).filter(tab => tab.id !== id)
}

export function presenceTabCount(tabs) {
  return (tabs ?? []).length
}

// The presence dot + honest label, or '' when nobody has it open. Defensive:
// invalid tab ids and stale heartbeats never render.
export function renderPresence(tabs, now = Date.now()) {
  const live = (tabs ?? []).filter(tab => cleanTabId(tab?.id) && Number.isFinite(tab?.at) && now - tab.at <= PRESENCE_TAB_TTL_MS)
  const count = live.length
  if (count < 1) return ''
  const tabWord = count === 1 ? 'tab' : 'tabs'
  return `<span class="inline-flex items-center gap-1.5" data-presence="live" role="status">`
    + `<span aria-hidden="true" class="inline-block h-2 w-2 rounded-full bg-gold"></span>`
    + `<span class="text-[10px] text-cream/60">you have this open in ${count} ${tabWord} · ${escapeHtml(PRESENCE_STORAGE_LABEL)}</span>`
    + `</span>`
}

// --- Browser wiring (never runs under node --test) --------------------------
export function initManuscriptPresence(list, noteEl) {
  if (typeof document === 'undefined' || !list) return null
  const tabId = `presence-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  let openPath = null
  let timer = null

  const readTabs = path => {
    const base = presenceKey(path)
    if (!base) return []
    const now = Date.now()
    const tabs = []
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const storageKey = localStorage.key(i)
        if (typeof storageKey === 'string' && storageKey.startsWith(`${base}:`)) {
          const parsed = parsePresence(localStorage.getItem(storageKey), now)
          for (const tab of parsed) tabs.push(tab)
        }
      }
    } catch { return [] }
    return tabs
  }

  const heartbeat = () => {
    const base = presenceKey(openPath)
    if (!base) return
    try { localStorage.setItem(`${base}:${tabId}`, serializePresence([{ id: tabId, at: Date.now() }])) } catch {}
  }

  const leave = () => {
    const base = presenceKey(openPath)
    if (!base) return
    try { localStorage.removeItem(`${base}:${tabId}`) } catch {}
  }

  const paint = () => {
    if (noteEl) noteEl.textContent = PRESENCE_STORAGE_LABEL
    if (!openPath) return
    for (const button of list.querySelectorAll('[data-manuscript-path]')) {
      button.querySelector('[data-presence-dot]')?.remove()
      const tabs = readTabs(button.dataset.manuscriptPath)
      if (!tabs.length) continue
      const wrap = document.createElement('span')
      wrap.dataset.presenceDot = 'live'
      wrap.innerHTML = renderPresence(tabs)
      button.appendChild(wrap)
    }
  }

  const start = () => {
    clearInterval(timer)
    if (!openPath) return
    heartbeat()
    timer = setInterval(heartbeat, PRESENCE_HEARTBEAT_MS)
    paint()
  }

  const open = path => {
    leave()
    openPath = path
    start()
  }

  const close = () => {
    clearInterval(timer)
    leave()
    openPath = null
    paint()
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', event => {
      if (typeof event?.key === 'string' && event.key.startsWith(PRESENCE_KEY_PREFIX)) paint()
    })
    window.addEventListener('pagehide', leave)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') leave()
      else if (openPath) heartbeat()
    })
  }

  return { open, close, paint }
}
