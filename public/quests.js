// Quest Board (Wave F4) — a guild-board skin over the author's real
// threads. No new API: boards render from GET /api/arcs plus
// GET /api/threads?arc=, and state seals move through the existing
// PATCH /api/threads/:id endpoint. Pure helpers are exported so
// node --test can verify the open/settled split and the escaped
// guild renderings without a browser. Browser rendering only runs
// when `document` exists (see bottom guard).
import { escapeHtml } from './timeline.js'

export const QUEST_OPEN_STATES = ['seed', 'active']
export const QUEST_SETTLED_STATES = ['resolved']
const QUEST_SEAL = {
  seed: 'SEED',
  active: 'ACTIVE',
  resolved: 'RESOLVED',
}

const questStateOf = thread => (thread?.state === 'active' || thread?.state === 'resolved' ? thread.state : 'seed')

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

// One guild posting: escaped title, state seal, arc name, and one
// button per state so seed → active → resolved moves in a single
// tap through PATCH /api/threads/:id.
export function renderQuestPosting(thread, arcTitle) {
  const id = escapeHtml(String(thread?.id ?? ''))
  const title = escapeHtml(thread?.title || 'Untitled contract')
  const state = questStateOf(thread)
  const arc = escapeHtml(arcTitle || 'Unbound arc')
  const buttons = ['seed', 'active', 'resolved'].map(option =>
    `<button type="button" data-thread-id="${id}" data-thread-state="${option}" aria-pressed="${option === state ? 'true' : 'false'}"`
    + ` class="rounded-full border px-2.5 py-1 text-[10px] tracking-widest${option === state ? ' border-gold/60 text-gold' : ' border-gold/15 text-cream/40'}">${QUEST_SEAL[option]}</button>`
  ).join('')
  return `<li class="rounded-xl border border-gold/10 px-4 py-3" data-quest-row="${id}">`
    + `<span class="flex items-baseline justify-between gap-3 flex-wrap"><span class="text-sm text-cream/85">❧ ${title}</span>`
    + `<span class="text-[10px] tracking-[.25em] text-gold border border-gold/25 rounded-full px-3 py-1">${QUEST_SEAL[state]}</span></span>`
    + `<span class="mt-1 block text-xs italic font-serif text-cream/40">Pinned under ${arc}</span>`
    + `<span class="mt-2 flex items-center gap-1.5 flex-wrap" role="group" aria-label="Contract state">${buttons}</span>`
    + `</li>`
}

// One per-arc board of open postings. Empty boards say so plainly.
export function renderQuestBoard(arcTitle, threads) {
  const name = escapeHtml(arcTitle || 'Unbound arc')
  const list = [...(threads ?? [])]
  if (!list.length) return `<section class="rounded-xl border border-gold/10 p-5" aria-label="Contracts for ${name}"><h3 class="font-display text-sm tracking-[.2em] text-gold">${name}</h3><p class="mt-3 text-sm text-cream/40">No open contracts — the guild rests easy here.</p></section>`
  return `<section class="rounded-xl border border-gold/10 p-5" aria-label="Contracts for ${name}">`
    + `<h3 class="font-display text-sm tracking-[.2em] text-gold">${name}</h3>`
    + `<ul class="mt-4 grid gap-2">${list.map(thread => renderQuestPosting(thread, arcTitle)).join('')}</ul>`
    + `</section>`
}

// All per-arc boards together. Arcs keep select order; threads are
// already split open by the caller.
export function renderQuestBoards(arcs, threadsByArc) {
  const list = [...(arcs ?? [])]
  if (!list.length) return '<p class="rounded-xl border border-gold/10 p-5 text-sm text-cream/40">No story arcs yet — crown the first one in the plot room.</p>'
  const byArc = threadsByArc instanceof Map ? threadsByArc : new Map()
  return list.map(arc => renderQuestBoard(arc?.title, byArc.get(String(arc?.id)) ?? [])).join('')
}

// The settled rolls: every resolved thread, each still naming its arc.
export function renderSettledContracts(settled) {
  const list = [...(settled ?? [])]
  if (!list.length) return '<p class="text-sm text-cream/40">No settled contracts yet — resolved threads join these rolls.</p>'
  return `<ul class="grid gap-2">${list.map(entry => renderQuestPosting(entry?.thread, entry?.arcTitle)).join('')}</ul>`
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
  if (!boards || !filter) return
  const say = message => { if (status) status.textContent = message }
  let arcs = []
  let threadsByArc = new Map()
  let settled = []

  const visibleArcs = () => (!filter.value ? arcs : arcs.filter(arc => String(arc.id) === filter.value))

  const paint = () => {
    const shown = visibleArcs()
    boards.innerHTML = renderQuestBoards(shown, threadsByArc)
    boards.setAttribute('aria-busy', 'false')
    const shownSettled = !filter.value ? settled : settled.filter(entry => String(entry?.thread?.arc_id) === filter.value)
    if (settledEl) settledEl.innerHTML = renderSettledContracts(shownSettled)
    const openTotal = shown.reduce((sum, arc) => sum + (threadsByArc.get(String(arc.id)) ?? []).length, 0)
    if (count) count.textContent = `${openTotal} open · ${shownSettled.length} settled in view`
    say(shown.length ? `The guild boards show ${openTotal} open contract${openTotal === 1 ? '' : 's'} across ${shown.length} arc${shown.length === 1 ? '' : 's'}.` : 'No arcs on this board.')
  }

  const load = async () => {
    boards.setAttribute('aria-busy', 'true')
    try {
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
    const button = event.target?.closest?.('[data-thread-id][data-thread-state]')
    if (button) moveThread(button.getAttribute('data-thread-id'), button.getAttribute('data-thread-state'))
  })
  settledEl?.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-thread-id][data-thread-state]')
    if (button) moveThread(button.getAttribute('data-thread-id'), button.getAttribute('data-thread-state'))
  })

  await load()
}

if (typeof document !== 'undefined') initQuests()
