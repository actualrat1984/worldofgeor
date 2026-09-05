// Session Recaps (Wave H21) — per-member session recap entries with
// auto-linked entities pinned to the timeline and the calendar.
//
// Entities link by exact-title match against the gated wiki index, reusing
// the mentions.js gate (WIKI_INDEX_URL + same-origin credentials +
// safeMentionEntry): unknown names stay plain text, links only ever point
// at ^/wiki/ folios. Each entry pins to a live timeline event (auto-matched
// from its date-era text, else a manual pick from live fetched events,
// linking /timeline) and to a calendar month (linking /calendar). Entries
// live in member-keyed localStorage, labeled device-honest, with reversible
// (restorable) delete. Pure helpers are exported so node --test can verify
// linking, pins, round-trips, and escaping without a browser.
import { escapeHtml, isWikiUrl } from './timeline.js'
import { WIKI_INDEX_URL, MENTION_FETCH_INIT, safeMentionEntry, buildMentionLookup } from './mentions.js'
import { currentMemberEmail } from './chapter-meta.js'
export { WIKI_INDEX_URL } from './mentions.js'

// The only canon reads this room ever makes: the gated wiki index (reused
// from mentions.js — same-origin session cookie, anon fetches 401) and the
// gated timeline index. No calendar fetch: months are member-typed text.
export const RECAP_TIMELINE_URL = '/wiki/timeline-index.json'
export const RECAP_FETCH_INIT = { credentials: 'same-origin', headers: { Accept: 'application/json' } }
export const RECAP_TIMELINE_HREF = '/timeline'
export const RECAP_CALENDAR_HREF = '/calendar'
export const RECAP_TITLE_MAX = 120
export const RECAP_DATE_MAX = 160
export const RECAP_MONTH_MAX = 120
export const RECAP_BODY_MAX = 20000
export const RECAP_EVENT_TEXT_MAX = 500
export const RECAP_STORAGE_LABEL = 'Kept on this device only — per member.'
export const RECAP_EMPTY_TEXT = 'No session recaps yet — file the first one after play.'

const cleanText = value => (typeof value === 'string' ? value.trim() : '')

// One live timeline event, shaped and capped. Null when the canon entry
// carries no event prose — never invent dates or titles.
export function safeRecapEvent(item) {
  const event = cleanText(item?.event).slice(0, RECAP_EVENT_TEXT_MAX)
  if (!event) return null
  return {
    date: cleanText(item?.date).slice(0, RECAP_DATE_MAX),
    event,
    era: cleanText(item?.era).slice(0, RECAP_TITLE_MAX),
  }
}

// Stable picker value for one live event: its own date + prose, quoted back
// verbatim in the pin. Built only from live fetched events.
export function recapEventKey(event) {
  if (!event) return ''
  return `${cleanText(event.date) || 'undated'} — ${cleanText(event.event)}`
}

// Gated load: same-origin credentials on both canon indexes (anon → 401).
// fetchImpl is injectable so tests can assert the gated contract.
export async function loadRecapIndexes(fetchImpl = globalThis.fetch) {
  const init = { ...RECAP_FETCH_INIT, headers: { ...RECAP_FETCH_INIT.headers } }
  const [wikiResponse, timelineResponse] = await Promise.all([
    fetchImpl(WIKI_INDEX_URL, { ...MENTION_FETCH_INIT, headers: { ...MENTION_FETCH_INIT.headers } }),
    fetchImpl(RECAP_TIMELINE_URL, init),
  ])
  for (const response of [wikiResponse, timelineResponse]) {
    if (response?.status === 401) {
      const denied = new Error('Sign in to open the session recaps')
      denied.status = 401
      throw denied
    }
    if (!response?.ok) throw new Error('The archive indexes are temporarily unavailable')
  }
  const wikiRaw = await wikiResponse.json()
  const timelineRaw = await timelineResponse.json()
  const wiki = (Array.isArray(wikiRaw) ? wikiRaw : []).map(safeMentionEntry).filter(Boolean)
  const rawEvents = Array.isArray(timelineRaw?.events) ? timelineRaw.events : []
  const events = rawEvents.map(safeRecapEvent).filter(Boolean)
  return { wiki, lookup: buildMentionLookup(wiki), events }
}

// Auto-pin: first live event whose canon date appears in the entry's
// date-era text (or vice versa for short era tags). Never invented — null
// when nothing live matches, and the manual picker takes over.
export function matchTimelinePin(dateText, events) {
  const needle = cleanText(dateText).toLowerCase()
  if (!needle || !Array.isArray(events)) return null
  for (const event of events) {
    const date = cleanText(event?.date).toLowerCase()
    if (!date) continue
    if (needle.includes(date) || (needle.length >= 3 && date.includes(needle))) return event
  }
  return null
}

// Resolve an entry's timeline pin: auto-match first, manual live pick
// second, unpinned last. Manual picks only resolve against live events.
export function resolveRecapPin(entry, events) {
  const list = Array.isArray(events) ? events : []
  const auto = matchTimelinePin(entry?.dateText, list)
  if (auto) return { event: auto, auto: true }
  const key = cleanText(entry?.eventKey)
  if (key) {
    const picked = list.find(event => recapEventKey(event) === key)
    if (picked) return { event: picked, auto: false }
  }
  return null
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Render body prose with entity links: substrings that exactly match a real
// gated index title (case-insensitive, longest title wins) become links to
// that folio; unknown names stay plain text — never invented links. The
// lookup holds only safeMentionEntry-shaped ^/wiki/ entries, and every href
// is re-checked with isWikiUrl, so hostile index data cannot smuggle a URL.
// All member text is escaped, so hostile input shows as text, never runs.
export function linkifyRecapEntities(text, lookup) {
  const value = String(text ?? '')
  const map = lookup instanceof Map ? lookup : new Map()
  const titles = []
  for (const [key, url] of map) {
    if (!key || typeof url !== 'string' || !isWikiUrl(url)) continue
    if (!titles.some(item => item.key === key)) titles.push({ key, url })
  }
  if (!titles.length) return escapeHtml(value)
  titles.sort((a, b) => b.key.length - a.key.length)
  const pattern = new RegExp(`(?<![A-Za-zÀ-ÖØ-öø-ÿ0-9_])(${titles.map(item => escapeRegExp(item.key)).join('|')})(?![A-Za-zÀ-ÖØ-öø-ÿ0-9_])`, 'gi')
  let out = ''
  let last = 0
  pattern.lastIndex = 0
  let match
  while ((match = pattern.exec(value)) !== null) {
    const hit = map.get(match[1].toLowerCase())
    out += escapeHtml(value.slice(last, match.index))
    if (hit && isWikiUrl(hit)) {
      out += `<a href="${escapeHtml(hit)}">${escapeHtml(match[1])}</a>`
    } else {
      out += escapeHtml(match[1])
    }
    last = match.index + match[1].length
  }
  return out + escapeHtml(value.slice(last))
}

// Pin row: the timeline link quotes the live event's own date + prose, the
// calendar link quotes the member's month text. Hrefs are exactly /timeline
// and /calendar — no invented routes.
export function renderRecapPins(entry, pin) {
  const parts = []
  if (pin?.event) {
    const label = `${cleanText(pin.event.date) || 'undated'} — ${cleanText(pin.event.event)}`
    parts.push(`<a href="${RECAP_TIMELINE_HREF}" class="text-gold underline decoration-gold/30 underline-offset-2">${escapeHtml(label)}</a>`)
    parts.push(`<span class="text-cream/30">${pin.auto ? 'auto-matched' : 'hand-picked'}</span>`)
  }
  const month = cleanText(entry?.monthText)
  if (month) {
    parts.push(`<a href="${RECAP_CALENDAR_HREF}" class="text-gold underline decoration-gold/30 underline-offset-2">${escapeHtml(month)}</a>`)
  }
  if (!parts.length) return '<p class="text-[11px] tracking-widest text-cream/30 mt-3">NOT PINNED YET — ADD A DATE OR PICK AN EVENT</p>'
  return `<p class="text-xs text-cream/50 mt-3 flex items-center gap-2 flex-wrap"><span class="tracking-widest text-cream/30 text-[10px]">PINNED ·</span>${parts.join(' ')}</p>`
}

export function renderRecapItem(entry, lookup, events) {
  const id = escapeHtml(cleanText(entry?.id))
  const title = cleanText(entry?.title) || 'Untitled session'
  const dateText = cleanText(entry?.dateText)
  const pin = resolveRecapPin(entry, events)
  const deleted = Boolean(entry?.deleted)
  return `<article data-recap-id="${id}" class="rounded-xl border border-gold/10 p-5${deleted ? ' opacity-70' : ''}">`
    + `<div class="flex items-start justify-between gap-3">`
    + `<div class="min-w-0"><h3 class="font-display text-lg text-cream/90">${escapeHtml(title)}</h3>`
    + (dateText ? `<p class="text-[11px] tracking-widest text-cream/40 mt-1">${escapeHtml(dateText)}</p>` : '')
    + `</div>`
    + (deleted
      ? `<button type="button" data-recap-restore="${id}" class="shrink-0 text-xs border border-gold/30 text-gold rounded-full px-3 py-1.5">Restore</button>`
      : `<button type="button" data-recap-delete="${id}" class="shrink-0 text-xs text-cream/40 hover:text-cream/80" aria-label="Remove ${escapeHtml(title)}">Remove</button>`)
    + `</div>`
    + `<div class="text-sm text-cream/75 leading-relaxed whitespace-pre-wrap mt-3">${linkifyRecapEntities(entry?.body ?? '', lookup)}</div>`
    + renderRecapPins(entry, pin)
    + `</article>`
}

export function renderRecapList(entries, lookup, events) {
  const live = (Array.isArray(entries) ? entries : []).filter(entry => entry && !entry.deleted)
  if (!live.length) return `<p class="p-5 text-sm text-cream/40">${escapeHtml(RECAP_EMPTY_TEXT)}</p>`
  return live.map(entry => renderRecapItem(entry, lookup, events)).join('')
}

export function renderRecapTrash(entries, lookup, events) {
  const removed = (Array.isArray(entries) ? entries : []).filter(entry => entry && entry.deleted)
  if (!removed.length) return ''
  return `<h2 class="text-[10px] tracking-[.25em] text-cream/40 mt-8">REMOVED — RESTORABLE</h2>`
    + `<div class="mt-3 flex flex-col gap-3">${removed.map(entry => renderRecapItem(entry, lookup, events)).join('')}</div>`
}

// Live form check: plain words, no invented requirements.
export function validateRecap(fields) {
  const data = fields && typeof fields === 'object' ? fields : {}
  const errors = []
  const title = cleanText(data.title)
  if (!title) errors.push('Give the session a title first — the list is unreadable without it.')
  else if (title.length > RECAP_TITLE_MAX) errors.push(`Keep the title under ${RECAP_TITLE_MAX} characters — shorten it, then keep going.`)
  if (cleanText(data.dateText).length > RECAP_DATE_MAX) errors.push(`Keep the date-era line under ${RECAP_DATE_MAX} characters — quote the canon date, then stop.`)
  if (cleanText(data.monthText).length > RECAP_MONTH_MAX) errors.push(`Keep the month line under ${RECAP_MONTH_MAX} characters — one month is enough.`)
  if (cleanText(data.body).length > RECAP_BODY_MAX) errors.push('That recap is over the 20k character cap — trim the body before filing.')
  if (!cleanText(data.body)) errors.push('Write the recap body first — a title alone files nothing.')
  return errors
}

// Storage: one localStorage entry per member, so recaps never leak across
// members on a shared device. Deletes are soft (deleted flag) and restorable.
export function recapStorageKey(member) {
  return `geor:recaps:${cleanText(member) || 'local'}`
}

export function readRecaps(storage, member) {
  try {
    const parsed = JSON.parse(storage.getItem(recapStorageKey(member)) || '[]')
    return Array.isArray(parsed) ? parsed.filter(entry => entry && typeof entry === 'object') : []
  } catch {
    return []
  }
}

export function writeRecaps(storage, member, entries) {
  try {
    storage.setItem(recapStorageKey(member), JSON.stringify(Array.isArray(entries) ? entries : []))
  } catch {}
}

export function addRecap(storage, member, fields) {
  const data = fields && typeof fields === 'object' ? fields : {}
  const errors = validateRecap(data)
  if (errors.length) return { errors }
  const entry = {
    id: `recap-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    title: cleanText(data.title),
    dateText: cleanText(data.dateText).slice(0, RECAP_DATE_MAX),
    monthText: cleanText(data.monthText).slice(0, RECAP_MONTH_MAX),
    eventKey: cleanText(data.eventKey),
    body: cleanText(data.body),
    createdAt: new Date().toISOString(),
    deleted: false,
  }
  const entries = readRecaps(storage, member)
  entries.unshift(entry)
  writeRecaps(storage, member, entries)
  return { entry }
}

export function deleteRecap(storage, member, id) {
  const entries = readRecaps(storage, member)
  const found = entries.find(entry => entry?.id === id)
  if (!found) return false
  found.deleted = true
  writeRecaps(storage, member, entries)
  return true
}

export function restoreRecap(storage, member, id) {
  const entries = readRecaps(storage, member)
  const found = entries.find(entry => entry?.id === id)
  if (!found) return false
  found.deleted = false
  writeRecaps(storage, member, entries)
  return true
}

// --- Browser rendering (never runs under node --test) -----------------------
function initRecaps() {
  const form = document.getElementById('rcForm')
  const titleInput = document.getElementById('rcTitle')
  const dateInput = document.getElementById('rcDate')
  const monthInput = document.getElementById('rcMonth')
  const eventSelect = document.getElementById('rcEvent')
  const bodyInput = document.getElementById('rcBody')
  const errorsBox = document.getElementById('rcErrors')
  const list = document.getElementById('rcList')
  const trash = document.getElementById('rcTrash')
  const status = document.getElementById('rcStatus')
  const count = document.getElementById('rcCount')
  const storageNote = document.getElementById('rcStorageNote')
  if (!form || !titleInput || !bodyInput || !list) return
  if (storageNote) storageNote.textContent = `Entries autosave · ${RECAP_STORAGE_LABEL}`
  const setStatus = message => {
    if (status) status.textContent = message
  }
  let member = 'local'
  let lookup = new Map()
  let events = []
  let entries = []

  const paintErrors = errors => {
    if (!errorsBox) return
    errorsBox.innerHTML = errors.length
      ? errors.map(error => `<li class="text-sm text-amber-200/90">→ ${escapeHtml(error)}</li>`).join('')
      : ''
  }

  const paint = () => {
    list.innerHTML = renderRecapList(entries, lookup, events)
    if (trash) trash.innerHTML = renderRecapTrash(entries, lookup, events)
    const live = entries.filter(entry => !entry?.deleted).length
    if (count) count.textContent = `${live} session ${live === 1 ? 'recap' : 'recaps'}`
    setStatus(events.length ? `${events.length} timeline events loaded — dates auto-pin.` : 'Timeline events could not be loaded — picks are unavailable.')
  }

  const paintPicker = () => {
    if (!eventSelect) return
    const current = eventSelect.value
    eventSelect.innerHTML = '<option value="">No hand-picked event — auto-match the date</option>'
      + events.map(event => {
        const key = recapEventKey(event)
        return `<option value="${escapeHtml(key)}">${escapeHtml(key)}${event.era ? ` · ${escapeHtml(event.era)}` : ''}</option>`
      }).join('')
    eventSelect.value = current
  }

  form.addEventListener('submit', ev => {
    ev.preventDefault()
    const result = addRecap(localStorage, member, {
      title: titleInput.value,
      dateText: dateInput ? dateInput.value : '',
      monthText: monthInput ? monthInput.value : '',
      eventKey: eventSelect ? eventSelect.value : '',
      body: bodyInput.value,
    })
    if (result.errors) {
      paintErrors(result.errors)
      setStatus('The recap needs one more pass — see above.')
      return
    }
    entries = readRecaps(localStorage, member)
    titleInput.value = ''
    if (dateInput) dateInput.value = ''
    if (monthInput) monthInput.value = ''
    if (eventSelect) eventSelect.value = ''
    bodyInput.value = ''
    paintErrors([])
    paint()
    setStatus('Recap filed — entities linked, pins set.')
  })

  list.addEventListener('click', ev => {
    const button = ev.target.closest('[data-recap-delete]')
    if (!button) return
    deleteRecap(localStorage, member, button.getAttribute('data-recap-delete'))
    entries = readRecaps(localStorage, member)
    paint()
    setStatus('Recap removed — restorable below.')
  })

  if (trash) trash.addEventListener('click', ev => {
    const button = ev.target.closest('[data-recap-restore]')
    if (!button) return
    restoreRecap(localStorage, member, button.getAttribute('data-recap-restore'))
    entries = readRecaps(localStorage, member)
    paint()
    setStatus('Recap restored.')
  })

  currentMemberEmail().then(email => {
    member = email && String(email).trim() ? String(email).trim() : 'local'
    entries = readRecaps(localStorage, member)
    paint()
    return loadRecapIndexes()
  }).then(indexes => {
    lookup = indexes.lookup
    events = indexes.events
    paintPicker()
    paint()
  }).catch(error => {
    if (error && error.status === 401) {
      location.href = '/?next=' + encodeURIComponent('/recaps')
      return
    }
    setStatus('The archive indexes are temporarily unavailable — recaps still save on this device.')
    paint()
  })
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initRecaps)
  else initRecaps()
}
