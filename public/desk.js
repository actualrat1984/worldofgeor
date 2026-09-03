// Author's Desk (Wave F3) — composite command view over existing JSON
// endpoints only: /api/notes, /api/arcs, /api/threads?arc=, /api/primer,
// and /wiki/timeline-index.json. Pure helpers are exported so node --test
// can verify rendering + graceful degrade without a browser. Browser
// rendering only runs when `document` exists. No redirects here: a 401 on
// any single endpoint degrades that panel alone, never the whole desk.
import { escapeHtml } from './timeline.js'

const DESK_NEXT = '/desk'
const MAX_DESK_NOTES = 5
const MAX_DESK_ARCS = 6
const MAX_THREAD_ARCS = 20
const THREAD_OPEN = new Set(['seed', 'active'])

export function panelError(message) {
  return `<p class="text-xs text-cream/40">${escapeHtml(message || 'This panel is temporarily unavailable.')}</p>`
}

export function signInPrompt(name) {
  return `<p class="text-xs text-cream/40">Sign in to open ${escapeHtml(name)}. <a class="text-gold" href="/?next=${encodeURIComponent(DESK_NEXT)}">Sign in →</a></p>`
}

// --- My Notes (from GET /api/notes -> { notes }) ---------------------------
export function summarizeNotes(notes) {
  const list = Array.isArray(notes) ? notes : []
  const open = list.reduce((count, note) => {
    const checklist = Array.isArray(note?.checklist) ? note.checklist : []
    return count + checklist.filter(item => !item?.done).length
  }, 0)
  return { total: list.length, open }
}

export function renderNotesPanel(notes, error) {
  if (error === 'unauthorized') return signInPrompt('the notebook')
  if (error) return panelError(error)
  const list = [...(Array.isArray(notes) ? notes : [])].slice(0, MAX_DESK_NOTES)
  if (!list.length) return '<p class="text-xs text-cream/40">No notes yet — <a class="text-gold" href="/notebook">write the first one →</a></p>'
  const { total, open } = summarizeNotes(notes)
  const items = list.map(note => {
    const title = typeof note?.title === 'string' && note.title.trim() ? note.title : 'Untitled note'
    const excerpt = String(note?.body ?? '').slice(0, 90)
    return `<li><a href="/notebook" class="block rounded-lg border border-gold/10 px-4 py-3">`
      + `<span class="block text-sm font-semibold text-cream/90 truncate">${escapeHtml(title)}</span>`
      + (excerpt ? `<span class="block text-xs text-cream/50 mt-1 line-clamp-2">${escapeHtml(excerpt)}</span>` : '')
      + `</a></li>`
  }).join('')
  const meta = open ? `${total} note${total === 1 ? '' : 's'} · ${open} open item${open === 1 ? '' : 's'}` : `${total} note${total === 1 ? '' : 's'}`
  return `<p class="text-[10px] tracking-widest text-cream/40">${escapeHtml(meta.toUpperCase())}</p><ul class="grid gap-2">${items}</ul>`
}

// --- Arc status (from GET /api/arcs -> { arcs } + per-arc threads) ----------
export function summarizeArcs(arcs, threadCounts) {
  const list = Array.isArray(arcs) ? arcs : []
  const counts = threadCounts && typeof threadCounts === 'object' ? threadCounts : {}
  let open = 0
  for (const arc of list) open += Number(counts[arc?.id]?.open) || 0
  return { total: list.length, open }
}

export function renderArcsPanel(arcs, threadCounts, error) {
  if (error === 'unauthorized') return signInPrompt('the plot room')
  if (error) return panelError(error)
  const list = [...(Array.isArray(arcs) ? arcs : [])].slice(0, MAX_DESK_ARCS)
  if (!list.length) return '<p class="text-xs text-cream/40">No arcs yet — <a class="text-gold" href="/arcs">crown the first one →</a></p>'
  const counts = threadCounts && typeof threadCounts === 'object' ? threadCounts : {}
  const items = list.map(arc => {
    const title = typeof arc?.title === 'string' && arc.title.trim() ? arc.title : 'Untitled arc'
    const status = typeof arc?.status === 'string' && arc.status ? arc.status : 'unknown'
    const threads = counts[arc?.id]
    const threadLine = threads ? `${threads.open} of ${threads.total} threads open` : 'threads unread'
    return `<li><a href="/arcs" class="flex items-center gap-3 flex-wrap rounded-lg border border-gold/10 px-4 py-3">`
      + `<span class="flex-1 min-w-[140px] text-sm font-semibold text-cream/90 truncate">${escapeHtml(title)}</span>`
      + `<span class="text-[10px] tracking-widest text-gold border border-gold/25 rounded-full px-3 py-1">${escapeHtml(status.toUpperCase())}</span>`
      + `<span class="w-full text-[10px] tracking-widest text-cream/40">${escapeHtml(threadLine.toUpperCase())}</span>`
      + `</a></li>`
  }).join('')
  const { total, open } = summarizeArcs(arcs, threadCounts)
  return `<p class="text-[10px] tracking-widest text-cream/40">${escapeHtml(`${total} ARC${total === 1 ? '' : 'S'} · ${open} OPEN THREAD${open === 1 ? '' : 'S'}`)}</p><ul class="grid gap-2">${items}</ul>`
}

// --- Timeline ref (from /wiki/timeline-index.json) --------------------------
export function summarizeTimeline(timeline) {
  const ages = Array.isArray(timeline?.ages) ? timeline.ages : []
  const events = Array.isArray(timeline?.events) ? timeline.events : []
  return { ages: ages.length, events: events.length, presentYear: typeof timeline?.present_year === 'string' ? timeline.present_year : '' }
}

export function renderTimelinePanel(timeline, error) {
  if (error === 'unauthorized') return signInPrompt('the chronicle')
  if (error) return panelError(error)
  if (!timeline || typeof timeline !== 'object') return panelError('The chronicle could not be opened.')
  const { ages, events, presentYear } = summarizeTimeline(timeline)
  const names = (Array.isArray(timeline.ages) ? timeline.ages : []).slice(0, 4).map(age => age?.age).filter(name => typeof name === 'string' && name)
  return `<p class="text-[10px] tracking-widest text-gold border border-gold/25 rounded-full px-4 py-1.5 justify-self-start">${escapeHtml(presentYear ? `PRESENT DAY · ${presentYear}` : 'PRESENT DAY')}</p>`
    + `<p class="text-xs text-cream/60">${escapeHtml(`${events} dated events · ${ages} ages`)}</p>`
    + (names.length ? `<p class="text-xs text-cream/40">${escapeHtml(names.join(' · '))}${ages > names.length ? escapeHtml(` · +${ages - names.length} more`) : ''}</p>` : '')
    + `<p class="text-xs"><a class="text-gold" href="/timeline">Walk the ages →</a></p>`
}

// --- Primer progress (from GET /api/primer -> { revealed, count }) -----------
export function summarizePrimer(primer) {
  const revealed = Array.isArray(primer?.revealed) ? primer.revealed : []
  const count = Number.isSafeInteger(primer?.count) ? primer.count : revealed.length
  return { revealed: count, total: null }
}

export function renderPrimerPanel(primer, error) {
  if (error === 'unauthorized') return signInPrompt('the primer')
  if (error) return panelError(error)
  const { revealed } = summarizePrimer(primer)
  if (!revealed) return `<p class="text-xs text-cream/40">No seals opened yet — <a class="text-gold" href="/primer">open the primer →</a></p>`
  return `<p class="text-xs text-cream/60">${escapeHtml(`${revealed} seal${revealed === 1 ? '' : 's'} opened`)}</p>`
    + `<p class="text-xs"><a class="text-gold" href="/primer">Continue the reading →</a></p>`
}

// One tab, every panel: any single failure degrades its own panel only.
export function renderDesk({ notes, notesError, arcs, arcsError, threadCounts, timeline, timelineError, primer, primerError }) {
  return {
    notes: renderNotesPanel(notes, notesError),
    arcs: renderArcsPanel(arcs, threadCounts, arcsError),
    timeline: renderTimelinePanel(timeline, timelineError),
    primer: renderPrimerPanel(primer, primerError),
  }
}

// --- Browser rendering (never runs under node --test) -----------------------
async function fetchPanel(path) {
  try {
    const response = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    if (response.status === 401) return { error: 'unauthorized' }
    if (!response.ok) return { error: 'This panel is temporarily unavailable.' }
    return { data: await response.json() }
  } catch {
    return { error: 'This panel is temporarily unavailable.' }
  }
}

async function threadCountsFor(arcs) {
  const counts = {}
  const list = [...(Array.isArray(arcs) ? arcs : [])].slice(0, MAX_THREAD_ARCS)
  const settled = await Promise.allSettled(list.map(arc =>
    fetch(`/api/threads?arc=${encodeURIComponent(arc.id)}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(async response => ({ id: arc.id, ok: response.ok, threads: response.ok ? (await response.json())?.threads : [] }))
  ))
  for (const entry of settled) {
    if (entry.status !== 'fulfilled' || !entry.value?.ok) continue
    const threads = Array.isArray(entry.value.threads) ? entry.value.threads : []
    counts[entry.value.id] = {
      total: threads.length,
      open: threads.filter(thread => THREAD_OPEN.has(thread?.state)).length,
    }
  }
  return counts
}

async function initDesk() {
  const notesEl = document.getElementById('deskNotes')
  const arcsEl = document.getElementById('deskArcs')
  const timelineEl = document.getElementById('deskTimeline')
  const primerEl = document.getElementById('deskPrimer')
  const status = document.getElementById('deskStatus')
  if (!notesEl || !arcsEl || !timelineEl || !primerEl) return
  try {
    const [notesRes, arcsRes, primerRes, timelineRes] = await Promise.all([
      fetchPanel('/api/notes'),
      fetchPanel('/api/arcs'),
      fetchPanel('/api/primer'),
      fetchPanel('/wiki/timeline-index.json'),
    ])
    const threadCounts = arcsRes.data?.arcs ? await threadCountsFor(arcsRes.data.arcs) : {}
    const panels = renderDesk({
      notes: notesRes.data?.notes, notesError: notesRes.error,
      arcs: arcsRes.data?.arcs, arcsError: arcsRes.error, threadCounts,
      timeline: timelineRes.data, timelineError: timelineRes.error,
      primer: primerRes.data, primerError: primerRes.error,
    })
    notesEl.innerHTML = panels.notes
    arcsEl.innerHTML = panels.arcs
    timelineEl.innerHTML = panels.timeline
    primerEl.innerHTML = panels.primer
    for (const el of [notesEl, arcsEl, timelineEl, primerEl]) el.setAttribute('aria-busy', 'false')
    const failed = [notesRes, arcsRes, primerRes, timelineRes].filter(result => result.error).length
    if (status) status.textContent = failed ? `The desk is open — ${failed} panel${failed === 1 ? '' : 's'} unavailable.` : 'The desk is open.'
  } catch {
    if (status) status.textContent = 'The desk could not be opened.'
  }
}

if (typeof document !== 'undefined') initDesk()
