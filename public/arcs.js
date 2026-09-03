// Story Arcs (Wave F1) — pure helpers are exported so node --test
// can verify the layered plot layout, SVG rendering, and thread badges
// without a browser. Browser rendering only runs when `document` exists.
import { escapeHtml } from './timeline.js'

export const PLOT_DX = 210
export const PLOT_DY = 120
export const PLOT_NODE_W = 170
export const PLOT_NODE_H = 48
export const PLOT_PAD = 30

export const THREAD_STATES = ['seed', 'active', 'resolved']
const THREAD_BADGE = {
  seed: 'SEED',
  active: 'ACTIVE',
  resolved: 'RESOLVED',
}

// Layer plots into rows: roots (no known parent) sit on row 0, every child
// one row below its deepest parent. A visiting set keeps hostile cycles
// from hanging the layout — looped plots collapse onto row 0 instead.
export function layoutPlotTree(plots) {
  const list = [...(plots ?? [])]
  const byId = new Map(list.map(plot => [plot?.id, plot]))
  const depth = new Map()
  const visiting = new Set()
  const depthOf = plot => {
    if (!plot || plot.id == null) return 0
    if (depth.has(plot.id)) return depth.get(plot.id)
    if (visiting.has(plot.id)) return 0
    visiting.add(plot.id)
    let level = 0
    const parentId = plot.parent_id ?? null
    if (parentId != null && byId.has(parentId)) level = depthOf(byId.get(parentId)) + 1
    visiting.delete(plot.id)
    depth.set(plot.id, level)
    return level
  }
  for (const plot of list) depthOf(plot)
  // Master roots lead each row so the eye finds the spine first.
  const ordered = [...list].sort((a, b) => Number(Boolean(b?.is_master)) - Number(Boolean(a?.is_master)))
  const rows = new Map()
  const placed = ordered.map(plot => {
    const generation = depth.get(plot?.id) ?? 0
    const column = rows.get(generation) ?? 0
    rows.set(generation, column + 1)
    return {
      id: String(plot?.id ?? ''),
      title: String(plot?.title ?? ''),
      summary: typeof plot?.summary === 'string' ? plot.summary : '',
      is_master: Boolean(plot?.is_master),
      parent_id: plot?.parent_id ?? null,
      generation,
      x: PLOT_PAD + column * PLOT_DX + PLOT_NODE_W / 2,
      y: PLOT_PAD + generation * PLOT_DY + PLOT_NODE_H / 2,
    }
  })
  // The canvas keeps insertion order stable for screen readers; the grid
  // above still guarantees no two nodes share x/y.
  return placed
}

// One plot node: master roots carry a crown class, children plain.
// Titles escape — never raw HTML inside the SVG.
export function renderPlotNode(node) {
  const label = escapeHtml(node.title || 'Untitled plot')
  const crown = node.is_master ? ' ✦' : ''
  const shape = `<rect x="${-PLOT_NODE_W / 2}" y="${-PLOT_NODE_H / 2}" width="${PLOT_NODE_W}" height="${PLOT_NODE_H}" rx="10" class="${node.is_master ? 'plot-master' : 'plot-node'}" fill="none" stroke="currentColor" stroke-opacity="0.4" />`
    + `<text text-anchor="middle" dominant-baseline="central" class="plot-label">${label}${crown}</text>`
  return `<g transform="translate(${node.x} ${node.y})" data-plot-id="${escapeHtml(node.id)}" class="plot-g">${shape}</g>`
}

// Layered SVG plot tree: parents above children with elbow connectors.
// Unknown parents (cross-arc or deleted) draw no edge — never a guess.
export function renderPlotTreeSVG(nodes) {
  const list = [...(nodes ?? [])]
  if (!list.length) return '<p class="p-5 text-sm text-cream/40">No plots yet — crown the master plot to begin the tree.</p>'
  const byId = new Map(list.map(node => [node.id, node]))
  const width = Math.max(1, ...list.map(node => node.x)) + PLOT_NODE_W / 2 + PLOT_PAD
  const height = Math.max(1, ...list.map(node => node.y)) + PLOT_NODE_H / 2 + PLOT_PAD
  const edges = []
  const seen = new Set()
  for (const node of list) {
    if (node.parent_id == null || node.id === node.parent_id) continue
    if (seen.has(node.id)) continue
    seen.add(node.id)
    const source = byId.get(node.parent_id)
    if (!source) continue
    const x1 = source.x
    const y1 = source.y + PLOT_NODE_H / 2
    const x2 = node.x
    const y2 = node.y - PLOT_NODE_H / 2
    const midY = (y1 + y2) / 2
    edges.push(`<path d="M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}" class="plot-edge" fill="none" stroke="currentColor" stroke-opacity="0.3" />`)
  }
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Plot tree" class="plot-svg text-gold">${edges.join('')}${list.map(renderPlotNode).join('')}</svg>`
}

// Sorted arc options for the <select>. Empty titles omitted.
export function arcOptions(arcs) {
  const options = []
  for (const arc of arcs ?? []) {
    const title = typeof arc?.title === 'string' ? arc.title.trim() : ''
    if (title && arc?.id != null) options.push({ id: String(arc.id), title })
  }
  return options.sort((a, b) => a.title.localeCompare(b.title))
}

// One thread row: escaped title, state badge, and one button per state so
// seed → active → resolved moves in a single tap.
export function renderThreadItem(thread) {
  const id = escapeHtml(String(thread?.id ?? ''))
  const title = escapeHtml(thread?.title || 'Untitled thread')
  const state = THREAD_STATES.includes(thread?.state) ? thread.state : 'seed'
  const buttons = THREAD_STATES.map(option =>
    `<button type="button" data-thread-id="${id}" data-thread-state="${option}" aria-pressed="${option === state ? 'true' : 'false'}"`
    + ` class="rounded-full border px-2.5 py-1 text-[10px] tracking-widest${option === state ? ' border-gold/60 text-gold' : ' border-gold/15 text-cream/40'}">${THREAD_BADGE[option]}</button>`
  ).join('')
  return `<li class="flex items-center gap-3 flex-wrap rounded-xl border border-gold/10 px-4 py-3" data-thread-row="${id}">`
    + `<span class="flex-1 min-w-[160px] text-sm text-cream/85">${title}</span>`
    + `<span class="flex items-center gap-1.5" role="group" aria-label="Thread state">${buttons}</span>`
    + `</li>`
}

export function renderThreadList(threads) {
  const list = [...(threads ?? [])]
  if (!list.length) return '<p class="p-5 text-sm text-cream/40">No open threads — seed the first one below.</p>'
  return `<ul class="grid gap-2">${list.map(renderThreadItem).join('')}</ul>`
}

// --- Browser rendering (never runs under node --test) -----------------------
async function requestArcs(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options })
  if (response.status === 401) {
    location.href = '/?next=' + encodeURIComponent('/arcs')
    throw new Error('Sign in to open the story arcs')
  }
  if (!response.ok) {
    let message = 'The story arcs are temporarily unavailable'
    try { message = (await response.json())?.error || message } catch {}
    throw new Error(message)
  }
  return response.json()
}

async function initArcs() {
  const canvas = document.getElementById('plotCanvas')
  const status = document.getElementById('arcsStatus')
  const count = document.getElementById('arcsCount')
  const select = document.getElementById('arcSelect')
  const parentSelect = document.getElementById('plotParent')
  const threadList = document.getElementById('threadList')
  const threadStatus = document.getElementById('threadStatus')
  const arcForm = document.getElementById('arcForm')
  const plotForm = document.getElementById('plotForm')
  const threadForm = document.getElementById('threadForm')
  if (!canvas || !select) return
  const say = message => { if (status) status.textContent = message }
  let currentArcId = null
  let currentPlots = []

  const renderDetail = detail => {
    currentPlots = Array.isArray(detail?.plots) ? detail.plots : []
    const nodes = layoutPlotTree(currentPlots)
    canvas.innerHTML = renderPlotTreeSVG(nodes)
    canvas.setAttribute('aria-busy', 'false')
    if (parentSelect) {
      const previous = parentSelect.value
      parentSelect.innerHTML = '<option value="">Root of the arc</option>'
      for (const plot of currentPlots) {
        const option = document.createElement('option')
        option.value = plot.id
        option.textContent = `${plot.is_master ? '✦ ' : ''}${plot.title || 'Untitled plot'}`
        parentSelect.appendChild(option)
      }
      if ([...parentSelect.options].some(option => option.value === previous)) parentSelect.value = previous
    }
    if (threadList) threadList.innerHTML = renderThreadList(detail?.threads)
    const generations = new Set(nodes.map(node => node.generation)).size
    say(`${detail?.arc?.title || 'Arc'} — ${currentPlots.length} plot${currentPlots.length === 1 ? '' : 's'} across ${generations} layer${generations === 1 ? '' : 's'}`)
  }

  const loadArc = async arcId => {
    currentArcId = arcId
    canvas.setAttribute('aria-busy', 'true')
    try {
      renderDetail(await requestArcs(`/api/arcs/${encodeURIComponent(arcId)}`))
    } catch (error) {
      say(error instanceof Error ? error.message : 'The story arcs could not be opened')
    }
  }

  const loadArcs = async () => {
    try {
      const data = await requestArcs('/api/arcs')
      const arcs = Array.isArray(data?.arcs) ? data.arcs : []
      select.innerHTML = ''
      if (!arcs.length) {
        const option = document.createElement('option')
        option.value = ''
        option.textContent = 'No arcs yet — crown the first below'
        select.appendChild(option)
        canvas.innerHTML = '<p class="p-5 text-sm text-cream/40">No story arcs yet — name the first one below.</p>'
        if (threadList) threadList.innerHTML = ''
        say('No story arcs yet.')
      } else {
        for (const entry of arcOptions(arcs)) {
          const option = document.createElement('option')
          option.value = entry.id
          option.textContent = entry.title
          select.appendChild(option)
        }
        if (count) count.textContent = `${arcs.length} arc${arcs.length === 1 ? '' : 's'} in your folio`
        await loadArc(select.value || arcs[0].id)
      }
    } catch (error) {
      say(error instanceof Error ? error.message : 'The story arcs could not be opened')
    }
  }

  select.addEventListener('change', () => { if (select.value) loadArc(select.value) })
  canvas.addEventListener('click', event => {
    const node = event.target?.closest?.('[data-plot-id]')
    if (node && parentSelect) {
      parentSelect.value = node.getAttribute('data-plot-id')
      parentSelect.focus()
      say(`Parent set to “${currentPlots.find(plot => plot.id === parentSelect.value)?.title || 'plot'}” — name the subplot below.`)
    }
  })

  arcForm?.addEventListener('submit', async event => {
    event.preventDefault()
    const title = document.getElementById('arcTitle')?.value ?? ''
    try {
      const data = await requestArcs('/api/arcs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })
      arcForm.reset()
      await loadArcs()
      if (data?.arc?.id) { select.value = data.arc.id; await loadArc(data.arc.id) }
    } catch (error) {
      say(error instanceof Error ? error.message : 'The arc could not be saved')
    }
  })

  plotForm?.addEventListener('submit', async event => {
    event.preventDefault()
    if (!currentArcId) { say('Choose an arc first.'); return }
    const title = document.getElementById('plotTitle')?.value ?? ''
    const isMaster = document.getElementById('plotMaster')?.checked === true
    try {
      await requestArcs('/api/plots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ arc_id: currentArcId, title, parent_id: parentSelect?.value || null, is_master: isMaster }) })
      plotForm.reset()
      await loadArc(currentArcId)
    } catch (error) {
      say(error instanceof Error ? error.message : 'The plot could not be saved')
    }
  })

  threadForm?.addEventListener('submit', async event => {
    event.preventDefault()
    if (!currentArcId) { say('Choose an arc first.'); return }
    const title = document.getElementById('threadTitle')?.value ?? ''
    try {
      await requestArcs('/api/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ arc_id: currentArcId, title }) })
      threadForm.reset()
      await loadArc(currentArcId)
      if (threadStatus) threadStatus.textContent = 'Thread seeded.'
    } catch (error) {
      if (threadStatus) threadStatus.textContent = error instanceof Error ? error.message : 'The thread could not be saved'
    }
  })

  threadList?.addEventListener('click', async event => {
    const button = event.target?.closest?.('[data-thread-id][data-thread-state]')
    if (!button) return
    const id = button.getAttribute('data-thread-id')
    const state = button.getAttribute('data-thread-state')
    try {
      await requestArcs(`/api/threads/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state }) })
      if (currentArcId) await loadArc(currentArcId)
    } catch (error) {
      if (threadStatus) threadStatus.textContent = error instanceof Error ? error.message : 'The thread could not be moved'
    }
  })

  await loadArcs()
}

if (typeof document !== 'undefined') initArcs()
