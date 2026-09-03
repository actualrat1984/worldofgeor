// Diplomacy Webs (Wave D2) — pure helpers are exported so node --test
// can verify the radial layout, SVG rendering, and the ^/wiki/ link gate
// without a browser. Browser rendering only runs when `document` exists.
import { escapeHtml, isWikiUrl } from './timeline.js'

export const WEB_STATES = ['allied', 'tense', 'war']
export const WEB_COLORS = { allied: '#d4af37', tense: '#e08a3c', war: '#c0392b' }
export const WEB_R = 320
export const WEB_CX = 400
export const WEB_CY = 360

export function stateColor(state) {
  return WEB_COLORS[state] ?? '#888888'
}

export function isWebState(state) {
  return WEB_STATES.includes(state)
}

// Factions on a circle, starting at the top and walking clockwise. Every
// node keeps a fixed angular slot, so no two nodes share a position.
export function layoutWeb(factions, edges) {
  const list = [...(factions ?? [])]
  const count = list.length
  const nodes = list.map((faction, index) => {
    const angle = count === 0 ? 0 : (index / count) * Math.PI * 2 - Math.PI / 2
    return {
      name: String(faction?.name ?? ''),
      path: typeof faction?.path === 'string' ? faction.path : '',
      x: WEB_CX + WEB_R * Math.cos(angle),
      y: WEB_CY + WEB_R * Math.sin(angle),
    }
  })
  const byName = new Map(nodes.map(node => [node.name, node]))
  const links = []
  for (const edge of edges ?? []) {
    const a = byName.get(edge?.a)
    const b = byName.get(edge?.b)
    if (!a || !b || a.name === b.name) continue
    if (!isWebState(edge?.state)) continue
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    const dx = mx - WEB_CX
    const dy = my - WEB_CY
    const pull = 0.35
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
      cx: mx - dx * pull,
      cy: my - dy * pull,
    })
  }
  return { nodes, links }
}

// One faction node: a ^/wiki/ path becomes a link, hostile or empty paths
// render as plain text — never an off-site href.
export function renderWebNode(node) {
  const label = escapeHtml(node.name)
  const shape = `<circle r="7" class="web-node" fill="none" stroke="currentColor" stroke-width="1.5" /><text y="22" text-anchor="middle" class="web-label">${label}</text>`
  const inner = isWikiUrl(node.path)
    ? `<a href="${escapeHtml(node.path)}">${shape}</a>`
    : shape
  return `<g transform="translate(${node.x.toFixed(1)} ${node.y.toFixed(1)})" data-faction="${escapeHtml(node.name)}" class="text-gold" tabindex="0" role="button" aria-label="${label}">${inner}</g>`
}

// Curved edges bow toward the rim so crossing lines stay readable. Each
// edge carries its evidence in data attributes for the context card.
export function renderWebEdge(link, index) {
  const color = stateColor(link.state)
  return `<path d="M ${link.ax.toFixed(1)} ${link.ay.toFixed(1)} Q ${link.cx.toFixed(1)} ${link.cy.toFixed(1)} ${link.bx.toFixed(1)} ${link.by.toFixed(1)}" class="web-edge web-edge-${link.state}" fill="none" stroke="${color}" stroke-width="2" stroke-opacity="0.65" data-edge="${index}" tabindex="0" role="button" aria-label="${escapeHtml(link.a)} ${link.state} ${escapeHtml(link.b)}"><title>${escapeHtml(link.a)} — ${link.state} — ${escapeHtml(link.b)}</title></path>`
}

export function renderWebSVG(layout) {
  const nodes = [...(layout?.nodes ?? [])]
  const links = [...(layout?.links ?? [])]
  const width = WEB_CX * 2
  const height = WEB_CY * 2
  const edges = links.map((link, index) => renderWebEdge(link, index)).join('')
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Diplomacy web" class="web-svg">${edges}${nodes.map(renderWebNode).join('')}</svg>`
}

// Context card body for one edge: names, state, evidence note, and a wiki
// link that only renders for validated ^/wiki/ paths.
export function renderEdgeCard(link, factionsByName) {
  const name = xf => {
    const entry = factionsByName.get(xf)
    const label = escapeHtml(xf)
    return entry && isWikiUrl(entry.path) ? `<a href="${escapeHtml(entry.path)}">${label}</a>` : label
  }
  const source = isWikiUrl(link.path)
    ? `<a href="${escapeHtml(link.path)}">Read the evidence in the wiki</a>`
    : `<span>Evidence: ${escapeHtml(link.why)}</span>`
  return `<p class="text-[10px] tracking-[.25em] text-gold">${escapeHtml(link.state).toUpperCase()}</p>`
    + `<p class="font-display text-lg mt-1">${name(link.a)} <span class="text-cream/40">· ${escapeHtml(link.state)} ·</span> ${name(link.b)}</p>`
    + `<p class="mt-2 text-cream/60">${escapeHtml(link.why)}</p>`
    + `<p class="mt-3 text-gold">${source}</p>`
}

export function renderFactionCard(node, links) {
  const label = escapeHtml(node.name)
  const head = isWikiUrl(node.path) ? `<a href="${escapeHtml(node.path)}">${label}</a>` : label
  const rows = links
    .filter(link => link.a === node.name || link.b === node.name)
    .map(link => {
      const other = link.a === node.name ? link.b : link.a
      return `<li><button type="button" data-goto-edge="${escapeHtml(link.a)}|${escapeHtml(link.b)}" class="text-gold underline decoration-gold/30 underline-offset-4">${escapeHtml(other)}</button> <span class="text-cream/40">— ${escapeHtml(link.state)} · ${escapeHtml(link.why)}</span></li>`
    })
    .join('')
  return `<p class="font-display text-lg">${head}</p>`
    + (rows
      ? `<ul class="mt-2 space-y-1.5">${rows}</ul>`
      : `<p class="mt-2 text-cream/40">No recorded pacts or rivalries.</p>`)
}

// --- Browser rendering (never runs under node --test) -----------------------
async function initWebs() {
  const canvas = document.getElementById('websCanvas')
  const status = document.getElementById('websStatus')
  const count = document.getElementById('websCount')
  const card = document.getElementById('webCard')
  if (!canvas) return
  const filters = [...document.querySelectorAll('.web-filter')]
  let data = null
  let activeState = 'all'
  const paint = () => {
    const factions = Array.isArray(data?.factions) ? data.factions : []
    const edges = Array.isArray(data?.edges) ? data.edges : []
    const kept = activeState === 'all' ? edges : edges.filter(edge => edge?.state === activeState)
    const layout = layoutWeb(factions, kept)
    canvas.innerHTML = renderWebSVG(layout)
    canvas.setAttribute('aria-busy', 'false')
    const byName = new Map(factions.map(entry => [entry?.name, entry]))
    const showEdge = (a, b) => {
      const link = layout.links.find(entry => (entry.a === a && entry.b === b) || (entry.a === b && entry.b === a))
      if (!link || !card) return
      card.innerHTML = renderEdgeCard(link, byName)
    }
    canvas.querySelectorAll('[data-edge]').forEach(el => {
      const open = () => {
        const link = layout.links[Number(el.getAttribute('data-edge'))]
        if (link) showEdge(link.a, link.b)
      }
      el.addEventListener('click', open)
      el.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      })
    })
    canvas.querySelectorAll('[data-faction]').forEach(el => {
      const open = () => {
        const node = layout.nodes.find(entry => entry.name === el.getAttribute('data-faction'))
        if (!node || !card) return
        card.innerHTML = renderFactionCard(node, layout.links)
        card.querySelectorAll('[data-goto-edge]').forEach(btn => {
          btn.addEventListener('click', () => {
            const [a, b] = String(btn.getAttribute('data-goto-edge')).split('|')
            showEdge(a, b)
          })
        })
      }
      el.addEventListener('click', open)
      el.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      })
    })
    if (count) count.textContent = `${factions.length} factions · ${kept.length} relations`
    if (status) {
      status.textContent = activeState === 'all'
        ? `${factions.length} factions across ${kept.length} recorded relations`
        : `${kept.length} ${activeState} relations across ${factions.length} factions`
    }
  }
  for (const btn of filters) {
    btn.addEventListener('click', () => {
      activeState = btn.getAttribute('data-state') || 'all'
      for (const other of filters) {
        const on = other === btn
        other.classList.toggle('bg-gold/10', on)
        other.classList.toggle('border-gold/40', on)
        other.classList.toggle('text-gold', on)
        other.classList.toggle('text-cream/60', !on)
      }
      paint()
    })
  }
  try {
    const response = await fetch('/wiki/webs-index.json', { credentials: 'same-origin' })
    if (response.status === 401) {
      location.href = '/?next=' + encodeURIComponent('/webs')
      return
    }
    if (!response.ok) throw new Error('The diplomacy webs index could not be opened')
    data = await response.json()
    paint()
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : 'The diplomacy webs could not be opened'
  }
}

if (typeof document !== 'undefined') initWebs()
