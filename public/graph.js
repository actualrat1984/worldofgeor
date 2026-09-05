// Vault Relation Graph (Wave H16) — pure helpers are exported so node --test
// can verify the deterministic seeded force-ish layout, SVG rendering, the
// ^/wiki/ link gate, and the neighborhood view without a browser. Browser
// rendering only runs when `document` exists.
import { escapeHtml, isWikiUrl } from './timeline.js'
import { isWebState, stateColor } from './webs.js'

export const GRAPH_W = 900
export const GRAPH_H = 720
export const GRAPH_CX = GRAPH_W / 2
export const GRAPH_CY = GRAPH_H / 2
export const GRAPH_R = 300
export const GRAPH_HOPS = 2
export const GRAPH_SEED = 1

// Deterministic mulberry32 — the only randomness in the layout is this
// seeded angular jitter, so identical input always yields identical
// coordinates. No live physics anywhere near the tests.
export function seededRandom(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const round2 = value => Math.round(value * 100) / 100

// Force-ish relaxation: every faction starts on a seeded-jitter circle slot,
// then a fixed number of deterministic repulsion / spring / centering passes
// spread the chart. Deterministic by construction — identical input (same
// seed) always yields identical coordinates.
export function layoutGraph(factions, edges, seed = GRAPH_SEED) {
  const list = [...(factions ?? [])]
  const count = list.length
  const random = seededRandom(seed)
  const nodes = list.map((faction, index) => {
    const jitter = (random() - 0.5) * 0.12
    const angle = count === 0 ? 0 : (index / count) * Math.PI * 2 - Math.PI / 2 + jitter
    return {
      name: String(faction?.name ?? ''),
      path: typeof faction?.path === 'string' ? faction.path : '',
      x: GRAPH_CX + GRAPH_R * Math.cos(angle),
      y: GRAPH_CY + GRAPH_R * Math.sin(angle),
    }
  })
  const byName = new Map(nodes.map(node => [node.name, node]))
  const links = []
  for (const edge of edges ?? []) {
    const a = byName.get(edge?.a)
    const b = byName.get(edge?.b)
    if (!a || !b || a.name === b.name) continue
    if (!isWebState(edge?.state)) continue
    links.push({
      a: a.name,
      b: b.name,
      state: edge.state,
      why: typeof edge?.why === 'string' ? edge.why : '',
      path: typeof edge?.path === 'string' ? edge.path : '',
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
    })
  }
  const ideal = 110
  for (let pass = 0; pass < 90; pass++) {
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const dx = nodes[j].x - nodes[i].x
        const dy = nodes[j].y - nodes[i].y
        const d2 = Math.max(dx * dx + dy * dy, 1)
        const d = Math.sqrt(d2)
        const push = Math.min(900 / d2, 5) / d
        nodes[i].x -= dx * push * 0.5
        nodes[i].y -= dy * push * 0.5
        nodes[j].x += dx * push * 0.5
        nodes[j].y += dy * push * 0.5
      }
    }
    for (const link of links) {
      const a = byName.get(link.a)
      const b = byName.get(link.b)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.001)
      if (d <= ideal) continue
      const pull = Math.min(d - ideal, 40) * 0.02
      const fx = (dx / d) * pull
      const fy = (dy / d) * pull
      a.x += fx
      a.y += fy
      b.x -= fx
      b.y -= fy
    }
    for (const node of nodes) {
      node.x += (GRAPH_CX - node.x) * 0.03
      node.y += (GRAPH_CY - node.y) * 0.03
    }
  }
  // Deterministic de-collision: no two nodes may share a slot.
  for (let pass = 0; pass < 60; pass++) {
    let moved = false
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        if (Math.abs(nodes[j].x - nodes[i].x) < 2 && Math.abs(nodes[j].y - nodes[i].y) < 2) {
          nodes[j].x = Math.min(GRAPH_W - 40, Math.max(40, nodes[j].x + 3))
          moved = true
        }
      }
    }
    if (!moved) break
  }
  for (const node of nodes) {
    node.x = round2(node.x)
    node.y = round2(node.y)
  }
  for (const link of links) {
    const a = byName.get(link.a)
    const b = byName.get(link.b)
    link.ax = a.x
    link.ay = a.y
    link.bx = b.x
    link.by = b.y
  }
  return { nodes, links }
}

// One faction node: a ^/wiki/ path becomes a link, hostile or empty paths
// render as plain text — never an off-site href.
export function renderGraphNode(node) {
  const label = escapeHtml(node.name)
  const shape = `<circle r="7" class="graph-node-dot" fill="none" stroke="currentColor" stroke-width="1.5" /><text y="22" text-anchor="middle" class="graph-label">${label}</text>`
  const inner = isWikiUrl(node.path)
    ? `<a href="${escapeHtml(node.path)}">${shape}</a>`
    : shape
  return `<g transform="translate(${node.x.toFixed(2)} ${node.y.toFixed(2)})" data-faction="${label}" class="text-gold" tabindex="0" role="button" aria-label="${label}">${inner}</g>`
}

// One straight pinned edge between two factions, state-colored like the
// diplomacy webs, carrying its payload for the evidence row.
export function renderGraphEdge(link, index) {
  const color = stateColor(link.state)
  return `<line x1="${link.ax.toFixed(2)}" y1="${link.ay.toFixed(2)}" x2="${link.bx.toFixed(2)}" y2="${link.by.toFixed(2)}" class="graph-edge graph-edge-${link.state}" stroke="${color}" stroke-width="1.5" stroke-opacity="0.55" data-edge="${index}" tabindex="0" role="button" aria-label="${escapeHtml(link.a)} ${link.state} ${escapeHtml(link.b)}"><title>${escapeHtml(link.a)} — ${link.state} — ${escapeHtml(link.b)}</title></line>`
}

export function renderGraphSVG(layout) {
  const nodes = [...(layout?.nodes ?? [])]
  const links = [...(layout?.links ?? [])]
  const edges = links.map((link, index) => renderGraphEdge(link, index)).join('')
  return `<svg viewBox="0 0 ${GRAPH_W} ${GRAPH_H}" width="100%" role="img" aria-label="Vault relation graph" class="graph-svg">${edges}${nodes.map(renderGraphNode).join('')}</svg>`
}

// Accessible detail row for one edge: names, pinned state, the vault `why`
// always shown escaped, and a wiki link that only renders for validated
// ^/wiki/ paths — otherwise the evidence stays plain text.
export function renderEdgeDetailRow(link, factionsByName) {
  const name = xf => {
    const entry = factionsByName.get(xf)
    const label = escapeHtml(xf)
    return entry && isWikiUrl(entry.path) ? `<a href="${escapeHtml(entry.path)}">${label}</a>` : label
  }
  const source = isWikiUrl(link.path)
    ? `<a href="${escapeHtml(link.path)}">Read the evidence in the wiki</a>`
    : `<span>Evidence: ${escapeHtml(link.why)}</span>`
  return `<li data-graph-edge="${escapeHtml(link.a)}|${escapeHtml(link.b)}" class="rounded-lg border border-gold/10 bg-ink/60 p-3">
    <p class="text-[10px] tracking-[.25em] text-gold">${escapeHtml(link.state).toUpperCase()}</p>
    <p class="text-sm mt-1">${name(link.a)} <span class="text-cream/40">· ${escapeHtml(link.state)} ·</span> ${name(link.b)}</p>
    <p class="text-xs mt-1 text-cream/60">${escapeHtml(link.why)}</p>
    <p class="text-xs mt-2 text-gold">${source}</p>
  </li>`
}

// Neighborhood of one faction: BFS over the loaded links only, capped at
// maxHops. No invented relations — every edge and hop comes from the index.
export function neighborhoodFor(name, nodes, links, maxHops = GRAPH_HOPS) {
  const names = new Set((nodes ?? []).map(node => node.name))
  const node = (nodes ?? []).find(entry => entry.name === name) ?? null
  if (!node) return { node: null, hops: new Map(), edges: [] }
  const hops = new Map([[name, 0]])
  let frontier = [name]
  for (let hop = 1; hop <= maxHops; hop++) {
    const next = []
    for (const current of frontier) {
      for (const link of links ?? []) {
        if (link.a !== current && link.b !== current) continue
        const other = link.a === current ? link.b : link.a
        if (!names.has(other) || hops.has(other)) continue
        hops.set(other, hop)
        next.push(other)
      }
    }
    if (next.length === 0) break
    frontier = next
  }
  const edges = (links ?? []).filter(link => hops.has(link.a) && hops.has(link.b))
  return { node, hops, edges, maxHops }
}

// Rendered neighborhood view: the faction's name (wiki-linked when valid),
// hop-grouped reachable factions, and every pinned edge with its evidence.
export function renderNeighborhoodView(name, nodes, links, factionsByName, maxHops = GRAPH_HOPS) {
  const { node, hops, edges } = neighborhoodFor(name, nodes, links, maxHops)
  if (!node) return '<p class="text-sm text-cream/60">That faction is not recorded in the relation graph.</p>'
  const label = escapeHtml(node.name)
  const head = isWikiUrl(node.path) ? `<a href="${escapeHtml(node.path)}">${label}</a>` : label
  const linkName = xf => {
    const entry = factionsByName.get(xf)
    const text = escapeHtml(xf)
    return entry && isWikiUrl(entry.path) ? `<a href="${escapeHtml(entry.path)}">${text}</a>` : text
  }
  const reachable = hops.size - 1
  const byHop = []
  for (let hop = 1; hop <= maxHops; hop++) {
    const namesAtHop = [...hops.entries()]
      .filter(([, at]) => at === hop)
      .map(([entry]) => entry)
      .sort((a, b) => a.localeCompare(b))
    if (namesAtHop.length) {
      byHop.push(`<p class="text-xs mt-2 text-cream/50"><span class="text-gold">${hop} hop${hop === 1 ? '' : 's'}</span> · ${namesAtHop.map(linkName).join(', ')}</p>`)
    }
  }
  const sorted = [...edges].sort((u, v) =>
    `${u.a}|${u.b}`.localeCompare(`${v.a}|${v.b}`))
  return `<p class="font-display text-lg">${head}</p>
    <p class="text-xs mt-1 text-cream/50">${reachable} faction${reachable === 1 ? '' : 's'} reachable within ${maxHops} recorded hop${maxHops === 1 ? '' : 's'} — only pinned vault relations, nothing invented.</p>
    ${byHop.join('')}
    ${sorted.length
      ? `<ul class="mt-3 space-y-2">${sorted.map(link => renderEdgeDetailRow(link, factionsByName)).join('')}</ul>`
      : '<p class="mt-3 text-sm text-cream/40">No recorded pacts or rivalries connect this faction.</p>'}
    <p class="text-[10px] tracking-[.2em] text-cream/30 mt-4">ALL 30 EDGES PINNED TO VAULT SOURCES · 2-HOP VIEW</p>`
}

// --- Browser rendering (never runs under node --test) -----------------------
async function initGraph() {
  const canvas = document.getElementById('graphCanvas')
  const status = document.getElementById('graphStatus')
  const count = document.getElementById('graphCount')
  const detail = document.getElementById('graphDetail')
  if (!canvas) return
  try {
    const response = await fetch('/wiki/webs-index.json', { credentials: 'same-origin' })
    if (response.status === 401) {
      location.href = '/?next=' + encodeURIComponent('/graph')
      return
    }
    if (!response.ok) throw new Error('The relation graph index could not be opened')
    const data = await response.json()
    const factions = Array.isArray(data?.factions) ? data.factions : []
    const edges = Array.isArray(data?.edges) ? data.edges : []
    const layout = layoutGraph(factions, edges)
    canvas.innerHTML = renderGraphSVG(layout)
    canvas.setAttribute('aria-busy', 'false')
    const byName = new Map(factions.map(entry => [entry?.name, entry]))
    const openNeighborhood = name => {
      if (detail) detail.innerHTML = renderNeighborhoodView(name, layout.nodes, layout.links, byName)
    }
    const openEdge = index => {
      const link = layout.links[Number(index)]
      if (!link || !detail) return
      detail.innerHTML = `<p class="font-display text-lg">${escapeHtml(link.a)} <span class="text-cream/40">· ${escapeHtml(link.state)} ·</span> ${escapeHtml(link.b)}</p>`
        + `<ul class="mt-3 space-y-2">${renderEdgeDetailRow(link, byName)}</ul>`
        + '<p class="text-[10px] tracking-[.2em] text-cream/30 mt-4">EVIDENCE ROW · PINNED TO VAULT SOURCE</p>'
    }
    canvas.querySelectorAll('[data-faction]').forEach(el => {
      const open = () => openNeighborhood(String(el.getAttribute('data-faction')))
      el.addEventListener('click', open)
      el.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      })
    })
    canvas.querySelectorAll('[data-edge]').forEach(el => {
      const open = () => openEdge(el.getAttribute('data-edge'))
      el.addEventListener('click', open)
      el.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      })
    })
    if (count) count.textContent = `${factions.length} factions · ${edges.length} pinned relations`
    if (status) status.textContent = `${factions.length} factions · ${edges.length} edges — every bond carries its vault evidence`
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : 'The relation graph could not be opened'
  }
}

if (typeof document !== 'undefined') initGraph()