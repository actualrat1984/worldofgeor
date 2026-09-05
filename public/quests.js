// Quest Board (Wave F4 + H12b) — a guild-board skin over the author's real
// threads. No new API: boards render from GET /api/arcs plus
// GET /api/threads?arc=, and state seals move through the existing
// PATCH /api/threads/:id endpoint. H12b adds client-side reward lines
// (parsed from the thread's existing title — threads carry no note or
// body field, see threadJson in worker.js), per-member claim flags in
// member-keyed localStorage, and device-persisted status filters. Pure
// helpers are exported so node --test can verify the open/settled split,
// rewards, claims, filters, and the escaped guild renderings without a
// browser. Browser rendering only runs when `document` exists.
import { escapeHtml } from './timeline.js'

export const QUEST_OPEN_STATES = ['seed', 'active']
export const QUEST_SETTLED_STATES = ['resolved']
const QUEST_SEAL = {
  seed: 'SEED',
  active: 'ACTIVE',
  resolved: 'RESOLVED',
}

export const questStateOf = thread => (thread?.state === 'active' || thread?.state === 'resolved' ? thread.state : 'seed')

// Split one arc's (or many arcs') threads into open postings
// (seed/active) and the settled rolls (resolved). Unknown states
// fall back to seed — an unsealed posting stays pinned, never lost.
export function splitQuestThreads(threads) {
  const open = []
  const settled = []
  for (const thread of threads ?? []) {
    if (questStateOf(thread) === 'resolved') settled.push(thread)
    else open.push(thread)
  }
  return { open, settled }
}

// Sorted arc options for the board filter. Empty titles omitted.
export function questArcOptions(arcs) {
  const options = []
  for (const arc of arcs ?? []) {
    const title = typeof arc?.title === 'string' ? arc.title.trim() : ''
    if (title && arc?.id != null) options.push({ id: String(arc.id), title })
  }
  return options.sort((a, b) => a.title.localeCompare(b.title))
}

// --- Rewards (H12b) -----------------------------------------------------
// Threads expose only id/arc_id/title/state (plus stamps) — there is no
// note or body field to read, so an optional reward rides in the title
// after a "Reward:" marker, e.g. "Rescue the caravan — Reward: 200 gold".
// Nothing is invented: no marker means no reward row at all.
export const QUEST_REWARD_MAX = 180

// The reward promised after the marker, trimmed and capped. Empty when
// the title carries no marker — callers render no row in that case.
export function questRewardOf(thread) {
  const title = typeof thread?.title === 'string' ? thread.title : ''
  const match = title.match(/reward\s*:(.*)$/is)
  if (!match) return ''
  return match[1].trim().slice(0, QUEST_REWARD_MAX)
}

// The posting title with any reward tail removed, so the reward row
// never duplicates the heading. Titles without a marker pass through.
export function questTitleOf(thread) {
  const title = typeof thread?.title === 'string' ? thread.title : ''
  const index = title.search(/reward\s*:/i)
  const base = index === -1 ? title : title.slice(0, index)
  return base.trim().replace(/[\s—–\-·|:]+$/, '').trim()
}

// --- Claims (H12b) -------------------------------------------------------
// Per-member, per-thread "claimed" markers in member-keyed localStorage,
// following the chapter-meta (H11b) precedent. Device-local by design:
// claims never touch the API and are visible only to the claiming
// member on the device where they were marked. Reversible via unclaim.
export const QUEST_CLAIM_KEY_PREFIX = 'geor:quest-claims:'
export const QUEST_CLAIM_STORAGE_LABEL = 'Claims stay on this device only — per member, per contract.'
const QUEST_CLAIM_ID_MAX = 200
const QUEST_CLAIM_COUNT_MAX = 500

function cleanQuestMember(value) {
  const member = String(value ?? '').trim().toLowerCase()
  return member || 'local'
}

function cleanQuestClaimId(value) {
  if (typeof value !== 'string') return null
  const id = value.trim()
  if (!id || id.length > QUEST_CLAIM_ID_MAX) return null
  return id
}

// Storage key scoping one member's claims. Different members never
// share a key, so one member's marks stay invisible to the other.
export function questClaimKey(member) {
  return `${QUEST_CLAIM_KEY_PREFIX}${cleanQuestMember(member)}`
}

// Parse a stored claims payload into a deduped id list. Any garbage —
// non-JSON, non-arrays, hostile entries — reads as no claims.
export function parseQuestClaims(raw) {
  let data = Array.isArray(raw) ? raw : null
  if (!data) {
    try { data = JSON.parse(String(raw ?? '')) } catch { return [] }
  }
  if (!Array.isArray(data)) return []
  const seen = new Set()
  for (const item of data) {
    const id = cleanQuestClaimId(item)
    if (id && !seen.has(id)) seen.add(id)
    if (seen.size >= QUEST_CLAIM_COUNT_MAX) break
  }
  return [...seen]
}

export function serializeQuestClaims(ids) {
  return JSON.stringify(parseQuestClaims(ids))
}

export function isQuestClaimed(claimedIds, threadId) {
  const id = cleanQuestClaimId(threadId == null ? '' : String(threadId))
  if (!id || !Array.isArray(claimedIds)) return false
  return claimedIds.includes(id)
}

export function withQuestClaim(claimedIds, threadId) {
  const id = cleanQuestClaimId(threadId == null ? '' : String(threadId))
  const list = parseQuestClaims(claimedIds)
  if (!id || list.includes(id)) return list
  return [...list, id].slice(0, QUEST_CLAIM_COUNT_MAX)
}

export function withoutQuestClaim(claimedIds, threadId) {
  const id = cleanQuestClaimId(threadId == null ? '' : String(threadId))
  const list = parseQuestClaims(claimedIds)
  return id ? list.filter(entry => entry !== id) : list
}

// Storage round-trip over a Storage-like ({getItem,setItem}), so tests
// can pass a fake store. Failures (blocked storage) read as no claims.
export function readQuestClaims(store, member) {
  try {
    const raw = store?.getItem?.(questClaimKey(member))
    if (!raw) return []
    return parseQuestClaims(raw)
  } catch { return [] }
}

export function writeQuestClaims(store, member, ids) {
  try {
    store?.setItem?.(questClaimKey(member), serializeQuestClaims(ids))
    return true
  } catch { return false }
}

// --- Status filters (H12b) -----------------------------------------------
// Client-side only: All / Open / Settled / Claimed-by-me. The choice
// persists per device (one shared key — it is a view preference, not a
// member mark). Claimed-by-me spans states: a settled contract a member
// claimed still shows under their claimed filter.
export const QUEST_STATUS_FILTERS = Object.freeze(['all', 'open', 'settled', 'claimed'])
export const QUEST_STATUS_FILTER_LABELS = Object.freeze({ all: 'All', open: 'Open', settled: 'Settled', claimed: 'Claimed by me' })
export const QUEST_STATUS_FILTER_KEY = 'geor:quest-status-filter'

export function cleanQuestStatusFilter(value) {
  return QUEST_STATUS_FILTERS.includes(value) ? value : 'all'
}

// One thread against one filter. Unknown filters read as all — a bad
// stored value never hides the boards.
export function questFilterMatches(thread, filter, claimedIds = []) {
  const mode = cleanQuestStatusFilter(filter)
  if (mode === 'all') return true
  if (mode === 'claimed') return isQuestClaimed(claimedIds, thread?.id)
  const state = questStateOf(thread)
  if (mode === 'open') return state === 'seed' || state === 'active'
  return state === 'resolved'
}

export function filterQuestThreads(threads, filter, claimedIds = []) {
  return [...(threads ?? [])].filter(thread => questFilterMatches(thread, filter, claimedIds))
}

// Apply one status filter across every per-arc open list and the
// settled rolls in a single pass for the browser paint.
export function partitionQuestsByFilter(threadsByArc, settled, filter, claimedIds = []) {
  const mode = cleanQuestStatusFilter(filter)
  const open = new Map()
  if (threadsByArc instanceof Map) {
    for (const [arcId, threads] of threadsByArc) open.set(arcId, filterQuestThreads(threads, mode, claimedIds))
  }
  return {
    open,
    settled: [...(settled ?? [])].filter(entry => questFilterMatches(entry?.thread, mode, claimedIds)),
  }
}

// One guild posting: escaped title, state seal, arc name, an escaped
// reward row only when the title carries one, claim toggle, and one
// button per state so seed → active → resolved moves in a single tap
// through PATCH /api/threads/:id. options.claimedIds marks this
// device's claims for the viewing member.
export function renderQuestPosting(thread, arcTitle, options = {}) {
  const claimedIds = Array.isArray(options?.claimedIds) ? options.claimedIds : []
  const claimed = isQuestClaimed(claimedIds, thread?.id)
  const id = escapeHtml(String(thread?.id ?? ''))
  const title = escapeHtml(questTitleOf(thread) || 'Untitled contract')
  const state = questStateOf(thread)
  const arc = escapeHtml(arcTitle || 'Unbound arc')
  const reward = questRewardOf(thread)
  const rewardRow = reward
    ? `<span class="mt-1 block text-xs text-gold/80" data-quest-reward="${id}">Reward · ${escapeHtml(reward)}</span>`
    : ''
  const buttons = ['seed', 'active', 'resolved'].map(option =>
    `<button type="button" data-thread-id="${id}" data-thread-state="${option}" aria-pressed="${option === state ? 'true' : 'false'}"`
    + ` class="rounded-full border px-2.5 py-1 text-[10px] tracking-widest${option === state ? ' border-gold/60 text-gold' : ' border-gold/15 text-cream/40'}">${QUEST_SEAL[option]}</button>`
  ).join('')
  const claimRow = `<span class="mt-2 flex items-center gap-1.5 flex-wrap"><button type="button" data-claim-thread-id="${id}" aria-pressed="${claimed ? 'true' : 'false'}" title="${escapeHtml(QUEST_CLAIM_STORAGE_LABEL)}"`
    + ` class="rounded-full border px-2.5 py-1 text-[10px] tracking-widest${claimed ? ' border-gold/60 text-gold' : ' border-gold/15 text-cream/40'}">${claimed ? 'CLAIMED — UNDO' : 'CLAIM'}</button></span>`
  return `<li class="rounded-xl border border-gold/10 px-4 py-3" data-quest-row="${id}">`
    + `<span class="flex items-baseline justify-between gap-3 flex-wrap"><span class="text-sm text-cream/85">❧ ${title}</span>`
    + `<span class="text-[10px] tracking-[.25em] text-gold border border-gold/25 rounded-full px-3 py-1">${QUEST_SEAL[state]}</span></span>`
    + `<span class="mt-1 block text-xs italic font-serif text-cream/40">Pinned under ${arc}</span>`
    + rewardRow
    + `<span class="mt-2 flex items-center gap-1.5 flex-wrap" role="group" aria-label="Contract state">${buttons}</span>`
    + claimRow
    + `</li>`
}

// One per-arc board of open postings. Empty boards say so plainly.
export function renderQuestBoard(arcTitle, threads, options = {}) {
  const name = escapeHtml(arcTitle || 'Unbound arc')
  const list = [...(threads ?? [])]
  if (!list.length) return `<section class="rounded-xl border border-gold/10 p-5" aria-label="Contracts for ${name}"><h3 class="font-display text-sm tracking-[.2em] text-gold">${name}</h3><p class="mt-3 text-sm text-cream/40">No open contracts — the guild rests easy here.</p></section>`
  return `<section class="rounded-xl border border-gold/10 p-5" aria-label="Contracts for ${name}">`
    + `<h3 class="font-display text-sm tracking-[.2em] text-gold">${name}</h3>`
    + `<ul class="mt-4 grid gap-2">${list.map(thread => renderQuestPosting(thread, arcTitle, options)).join('')}</ul>`
    + `</section>`
}

// All per-arc boards together. Arcs keep select order; threads are
// already split open by the caller.
export function renderQuestBoards(arcs, threadsByArc, options = {}) {
  const list = [...(arcs ?? [])]
  if (!list.length) return '<p class="rounded-xl border border-gold/10 p-5 text-sm text-cream/40">No story arcs yet — crown the first one in the plot room.</p>'
  const byArc = threadsByArc instanceof Map ? threadsByArc : new Map()
  return list.map(arc => renderQuestBoard(arc?.title, byArc.get(String(arc?.id)) ?? [], options)).join('')
}

// The settled rolls: every resolved thread, each still naming its arc.
export function renderSettledContracts(settled, options = {}) {
  const list = [...(settled ?? [])]
  if (!list.length) return '<p class="text-sm text-cream/40">No settled contracts yet — resolved threads join these rolls.</p>'
  return `<ul class="grid gap-2">${list.map(entry => renderQuestPosting(entry?.thread, entry?.arcTitle, options)).join('')}</ul>`
}

// --- Browser rendering (never runs under node --test) -----------------------
async function requestQuests(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options })
  if (response.status === 401) {
    location.href = '/?next=' + encodeURIComponent('/quests')
    throw new Error('Sign in to open the quest board')
  }
  if (!response.ok) {
    let message = 'The quest board is temporarily unavailable'
    try { message = (await response.json())?.error || message } catch {}
    throw new Error(message)
  }
  return response.json()
}

async function initQuests() {
  const boards = document.getElementById('questBoards')
  const settledEl = document.getElementById('settledContracts')
  const status = document.getElementById('questsStatus')
  const count = document.getElementById('questsCount')
  const filter = document.getElementById('questArcFilter')
  const chips = document.getElementById('questStatusFilters')
  if (!boards || !filter) return
  const say = message => { if (status) status.textContent = message }
  const device = (() => { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } })()
  const readFilter = () => {
    try { return cleanQuestStatusFilter(device?.getItem?.(QUEST_STATUS_FILTER_KEY)) }
    catch { return 'all' }
  }
  const keepFilter = value => {
    try { device?.setItem?.(QUEST_STATUS_FILTER_KEY, cleanQuestStatusFilter(value)) } catch {}
  }
  let arcs = []
  let threadsByArc = new Map()
  let settled = []
  let member = 'local'
  let claimedIds = readQuestClaims(device, member)
  let statusFilter = readFilter()

  const visibleArcs = () => (!filter.value ? arcs : arcs.filter(arc => String(arc.id) === filter.value))

  const paintChips = () => {
    if (!chips) return
    for (const button of chips.querySelectorAll('[data-quest-filter]')) {
      const on = button.getAttribute('data-quest-filter') === statusFilter
      button.setAttribute('aria-pressed', on ? 'true' : 'false')
      button.classList.toggle('bg-gold', on)
      button.classList.toggle('text-ink', on)
      button.classList.toggle('font-semibold', on)
      button.classList.toggle('border-gold/60', on)
      button.classList.toggle('text-cream/40', !on)
      button.classList.toggle('border-gold/15', !on)
    }
  }

  const paint = () => {
    const shown = visibleArcs()
    const viewed = partitionQuestsByFilter(threadsByArc, settled, statusFilter, claimedIds)
    boards.innerHTML = renderQuestBoards(shown, viewed.open, { claimedIds })
    boards.setAttribute('aria-busy', 'false')
    const shownSettled = !filter.value ? viewed.settled : viewed.settled.filter(entry => String(entry?.thread?.arc_id) === filter.value)
    if (settledEl) settledEl.innerHTML = renderSettledContracts(shownSettled, { claimedIds })
    const openTotal = shown.reduce((sum, arc) => sum + (viewed.open.get(String(arc.id)) ?? []).length, 0)
    if (count) count.textContent = `${openTotal} open · ${shownSettled.length} settled in view`
    paintChips()
    say(shown.length ? `The guild boards show ${openTotal} open contract${openTotal === 1 ? '' : 's'} across ${shown.length} arc${shown.length === 1 ? '' : 's'}.` : 'No arcs on this board.')
  }

  const loadMember = async () => {
    try {
      const data = await requestQuests('/api/me')
      const email = data?.user?.email ?? data?.email
      if (typeof email === 'string' && email.trim()) member = email.trim()
    } catch {}
    claimedIds = readQuestClaims(device, member)
  }

  const load = async () => {
    boards.setAttribute('aria-busy', 'true')
    try {
      await loadMember()
      const data = await requestQuests('/api/arcs')
      arcs = Array.isArray(data?.arcs) ? data.arcs : []
      filter.innerHTML = ''
      const all = document.createElement('option')
      all.value = ''
      all.textContent = arcs.length ? 'Every arc — the whole guildhall' : 'No arcs yet — crown the first in the plot room'
      filter.appendChild(all)
      for (const entry of questArcOptions(arcs)) {
        const option = document.createElement('option')
        option.value = entry.id
        option.textContent = entry.title
        filter.appendChild(option)
      }
      threadsByArc = new Map()
      settled = []
      await Promise.all(arcs.map(async arc => {
        try {
          const detail = await requestQuests(`/api/threads?arc=${encodeURIComponent(arc.id)}`)
          const { open, settled: done } = splitQuestThreads(detail?.threads)
          threadsByArc.set(String(arc.id), open)
          for (const thread of done) settled.push({ thread, arcTitle: arc.title })
        } catch {
          threadsByArc.set(String(arc.id), [])
        }
      }))
      paint()
    } catch (error) {
      say(error instanceof Error ? error.message : 'The quest board could not be opened')
    }
  }

  filter.addEventListener('change', paint)

  chips?.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-quest-filter]')
    if (!button) return
    statusFilter = cleanQuestStatusFilter(button.getAttribute('data-quest-filter'))
    keepFilter(statusFilter)
    paint()
  })

  const toggleClaim = id => {
    const key = String(id ?? '').trim()
    if (!key) return
    claimedIds = isQuestClaimed(claimedIds, key) ? withoutQuestClaim(claimedIds, key) : withQuestClaim(claimedIds, key)
    writeQuestClaims(device, member, claimedIds)
    paint()
    say(isQuestClaimed(claimedIds, key)
      ? 'Claim marked on this device — only you see it here.'
      : 'Claim released — the posting stands unclaimed on this device.')
  }

  const onPostingClick = event => {
    const claim = event.target?.closest?.('[data-claim-thread-id]')
    if (claim) {
      toggleClaim(claim.getAttribute('data-claim-thread-id'))
      return true
    }
    return false
  }

  const moveThread = async (id, state) => {
    try {
      await requestQuests(`/api/threads/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state }) })
      await load()
      if (filter.value) paint()
      say(state === 'resolved' ? 'Contract settled — it joins the rolls below.' : 'The posting bears a new seal.')
    } catch (error) {
      say(error instanceof Error ? error.message : 'The contract could not be resealed')
    }
  }

  boards.addEventListener('click', event => {
    if (onPostingClick(event)) return
    const button = event.target?.closest?.('[data-thread-id][data-thread-state]')
    if (button) moveThread(button.getAttribute('data-thread-id'), button.getAttribute('data-thread-state'))
  })
  settledEl?.addEventListener('click', event => {
    if (onPostingClick(event)) return
    const button = event.target?.closest?.('[data-thread-id][data-thread-state]')
    if (button) moveThread(button.getAttribute('data-thread-id'), button.getAttribute('data-thread-state'))
  })

  await load()
}

if (typeof document !== 'undefined') initQuests()
