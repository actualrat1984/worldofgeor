// Diplomacy Webs manager (Wave H12d) — edge filters, per-member edge notes,
// proposal composer. Canon read-only: every helper below only READS the
// shared edges array (built from vault evidence in webs-index.json). Notes
// and proposals live in member+edge-keyed localStorage on this device only —
// they are never shared, never sent, and never written back to canon.
// Pure helpers are exported so node --test can verify filters, note
// round-trips, proposal text, and escaping without a browser.
import { escapeHtml } from './timeline.js'
import { WEB_STATES } from './webs.js'

export const WEB_FILTERS_KEY = 'geor:webs-filters'
export const WEB_NOTE_KEY_PREFIX = 'geor:webs-note:'
export const EDGE_NOTE_MAX = 2000
export const PROPOSAL_SUGGESTION_MAX = 500
export const PROPOSAL_REASON_MAX = 1000
export const WEB_FILTERS_STORAGE_LABEL = 'Filters are kept on this device only.'
export const WEB_NOTE_STORAGE_LABEL = 'Personal reading notes — kept on this device only, per member, per edge. Never shared, never canon.'
export const WEB_PROPOSAL_LABEL = 'Proposal for Mikhail — not a canon edit. Copy only, nothing is sent.'

// --- Member + edge scoping -------------------------------------------------
// Same honesty rule as the chapter-meta precedent: the key carries the member
// (lowercased identity, 'local' fallback) plus the canonical edge key, so one
// member's reading notes are invisible to every other member on this device.
function cleanMember(value) {
  const member = String(value ?? '').trim().toLowerCase()
  return member || 'local'
}

function cleanFactionName(value) {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!name || name.length > 200) return null
  return name
}

// Canonical edge key: both sides sorted so A❦B and B❦A share one note slot.
export function edgeKey(a, b) {
  const first = cleanFactionName(a)
  const second = cleanFactionName(b)
  if (!first || !second || first === second) return null
  return [first, second].sort((x, y) => x.localeCompare(y)).join(' ❦ ')
}

export function websNoteKey(member, a, b) {
  const key = edgeKey(a, b)
  if (!key) return null
  return `${WEB_NOTE_KEY_PREFIX}${cleanMember(member)}:${key}`
}

// --- Per-member edge notes (localStorage, device-only) ----------------------
export function cleanEdgeNote(value) {
  if (value == null || value === '') return ''
  const text = String(value)
  if (!text) return ''
  return text.length <= EDGE_NOTE_MAX ? text : null
}

export function readEdgeNote(store, member, a, b) {
  try {
    const key = websNoteKey(member, a, b)
    if (!key) return ''
    const raw = store?.getItem?.(key)
    if (raw == null || raw === '') return ''
    const clean = cleanEdgeNote(raw)
    return clean === null ? '' : clean
  } catch { return '' }
}

// Saving an empty note removes it (reversible delete has its own button too).
export function writeEdgeNote(store, member, a, b, text) {
  const clean = cleanEdgeNote(text)
  if (clean === null) return false
  try {
    const key = websNoteKey(member, a, b)
    if (!key) return false
    if (clean === '') store?.removeItem?.(key)
    else store?.setItem?.(key, clean)
    return true
  } catch { return false }
}

export function deleteEdgeNote(store, member, a, b) {
  try {
    const key = websNoteKey(member, a, b)
    if (!key) return false
    store?.removeItem?.(key)
    return true
  } catch { return false }
}

export function renderEdgeNoteView(note) {
  const body = String(note ?? '')
  if (!body.trim()) {
    return '<p class="text-xs text-cream/30">No personal note on this edge yet — your reading notes stay here, on this device.</p>'
  }
  return `<div class="text-sm text-cream/80 leading-relaxed whitespace-pre-wrap">${escapeHtml(body)}</div>`
}

// --- Edge filters (client-side, device-persisted) ---------------------------
export function cleanStateFilter(value) {
  const state = String(value ?? '').trim().toLowerCase()
  return WEB_STATES.includes(state) ? state : 'all'
}

export function cleanFactionFilter(value, factions) {
  const name = cleanFactionName(value)
  if (!name) return ''
  if (!Array.isArray(factions)) return name
  return factions.some(entry => entry?.name === name) ? name : ''
}

// Pure partition of the live edges: canon array is never mutated, the result
// is always a fresh array.
export function filterWebEdges(edges, { state = 'all', faction = '' } = {}) {
  const list = Array.isArray(edges) ? edges : []
  const wanted = cleanStateFilter(state)
  const side = typeof faction === 'string' ? faction.trim() : ''
  return list.filter(edge => {
    if (!edge || typeof edge !== 'object') return false
    if (wanted !== 'all' && edge.state !== wanted) return false
    if (side && edge.a !== side && edge.b !== side) return false
    return true
  })
}

// Live counts straight from the rendered edges — the filter buttons and the
// faction picker both read these, so counts can never drift from the canvas.
export function countWebEdges(edges) {
  const counts = { all: 0, allied: 0, tense: 0, war: 0 }
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!edge || typeof edge !== 'object') continue
    counts.all++
    if (Object.hasOwn(counts, edge.state)) counts[edge.state]++
  }
  return counts
}

export function recallWebFilters(store, factions) {
  const fallback = { state: 'all', faction: '' }
  try {
    const raw = store?.getItem?.(WEB_FILTERS_KEY)
    if (!raw) return fallback
    const saved = JSON.parse(raw)
    if (!saved || typeof saved !== 'object') return fallback
    return {
      state: cleanStateFilter(saved.state),
      faction: cleanFactionFilter(saved.faction, factions),
    }
  } catch { return fallback }
}

export function writeWebFilters(store, { state = 'all', faction = '' } = {}, factions) {
  try {
    store?.setItem?.(WEB_FILTERS_KEY, JSON.stringify({
      state: cleanStateFilter(state),
      faction: cleanFactionFilter(faction, factions),
    }))
    return true
  } catch { return false }
}

// --- Proposal composer (copy-to-clipboard text only) ------------------------
// No send path exists anywhere in this module: no fetch, no XHR, no beacon.
// The text quotes the live canon values (edge a→b, current state, evidence
// note) so a proposal can never silently misquote the archive.
export function sanitizeProposalField(value, max) {
  if (value == null || value === '') return ''
  const text = String(value).trim().replace(/\s+/g, ' ')
  if (!text) return ''
  return text.length <= max ? text : null
}

export function buildEdgeProposal({ edge, suggestion, reason } = {}) {
  if (!edge || typeof edge !== 'object') return { ok: false, error: 'Choose an edge to propose about.' }
  const a = cleanFactionName(edge.a)
  const b = cleanFactionName(edge.b)
  const state = typeof edge.state === 'string' && WEB_STATES.includes(edge.state) ? edge.state : null
  const why = typeof edge.why === 'string' && edge.why.trim() ? edge.why.trim() : null
  if (!a || !b || !state || !why) return { ok: false, error: 'That edge carries no readable canon to quote.' }
  const want = sanitizeProposalField(suggestion, PROPOSAL_SUGGESTION_MAX)
  if (want === null) return { ok: false, error: `Keep the suggested change under ${PROPOSAL_SUGGESTION_MAX} characters.` }
  if (!want) return { ok: false, error: 'Name the change you are suggesting before copying.' }
  const cause = sanitizeProposalField(reason, PROPOSAL_REASON_MAX)
  if (cause === null) return { ok: false, error: `Keep the reason under ${PROPOSAL_REASON_MAX} characters.` }
  const text = 'Proposal for Mikhail — not a canon edit (personal copy, nothing sent)\n'
    + `Edge: ${a} → ${b} (current: ${state})\n`
    + `Evidence (canon, unchanged): ${why}\n`
    + `Suggested change: ${want}\n`
    + `Reason: ${cause || '—'}\n`
    + '— Personal reading note. Canon is unchanged; share this text with Mikhail only if you choose.'
  return { ok: true, text }
}

export function renderEdgeProposalPreview(text) {
  const body = String(text ?? '')
  if (!body.trim()) {
    return '<p class="text-xs text-cream/30">Write the suggested change above — the proposal preview appears here.</p>'
  }
  return `<pre class="text-xs text-cream/70 leading-relaxed whitespace-pre-wrap">${escapeHtml(body)}</pre>`
}
