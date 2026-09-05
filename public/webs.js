// Diplomacy Webs (Wave D2) — pure helpers are exported so node --test
// can verify the radial layout, SVG rendering, and the ^/wiki/ link gate
// without a browser. Browser rendering only runs when `document` exists.
import { escapeHtml, isWikiUrl } from './timeline.js'
import {
  WEB_FILTERS_STORAGE_LABEL,
  WEB_NOTE_STORAGE_LABEL,
  WEB_PROPOSAL_LABEL,
  buildEdgeProposal,
  cleanFactionFilter,
  cleanStateFilter,
  countWebEdges,
  deleteEdgeNote,
  filterWebEdges,
  readEdgeNote,
  recallWebFilters,
  renderEdgeNoteView,
  renderEdgeProposalPreview,
  writeEdgeNote,
  writeWebFilters,
} from './webs-manager.js'

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
function deviceStore() {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

async function currentMember() {
  try {
    const response = await fetch('/api/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    if (!response.ok) return 'local'
    const data = await response.json()
    return typeof data?.email === 'string' && data.email.trim() ? data.email.trim() : 'local'
  } catch { return 'local' }
}

async function initWebs() {
  const canvas = document.getElementById('websCanvas')
  const status = document.getElementById('websStatus')
  const count = document.getElementById('websCount')
  const card = document.getElementById('webCard')
  if (!canvas) return
  const filters = [...document.querySelectorAll('.web-filter')]
  const factionPick = document.getElementById('websFaction')
  let data = null
  let member = 'local'
  const remembered = recallWebFilters(deviceStore())
  let activeState = cleanStateFilter(remembered.state)
  let activeFaction = typeof remembered.faction === 'string' ? remembered.faction : ''
  const rememberFilters = () => {
    writeWebFilters(deviceStore(), { state: activeState, faction: activeFaction }, Array.isArray(data?.factions) ? data.factions : [])
  }
  const paintFactionOptions = factions => {
    if (!factionPick) return
    const counts = new Map()
    for (const edge of Array.isArray(data?.edges) ? data.edges : []) {
      counts.set(edge?.a, (counts.get(edge?.a) ?? 0) + 1)
      counts.set(edge?.b, (counts.get(edge?.b) ?? 0) + 1)
    }
    const current = factionPick.value || activeFaction || ''
    factionPick.innerHTML = '<option value="">All factions</option>'
      + factions.map(entry => {
        const name = entry?.name ?? ''
        const n = counts.get(name) ?? 0
        return `<option value="${escapeHtml(name)}">${escapeHtml(name)} · ${n}</option>`
      }).join('')
    factionPick.value = factions.some(entry => entry?.name === current) ? current : ''
    activeFaction = cleanFactionFilter(factionPick.value, factions)
  }
  const paintFilterButtons = kept => {
    const counts = countWebEdges(Array.isArray(data?.edges) ? data.edges : kept)
    for (const btn of filters) {
      const state = btn.getAttribute('data-state') || 'all'
      const n = state === 'all' ? counts.all : (counts[state] ?? 0)
      const label = state === 'all' ? 'ALL' : state.toUpperCase()
      btn.textContent = `${label} · ${n}`
      const on = state === activeState
      btn.classList.toggle('bg-gold/10', on)
      btn.classList.toggle('border-gold/40', on)
      btn.classList.toggle('text-gold', on)
      btn.classList.toggle('text-cream/60', !on)
      btn.classList.toggle('border-gold/20', !on)
    }
  }
  const copyText = async text => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        area.remove()
        return ok
      } catch { return false }
    }
  }
  const paint = () => {
    const factions = Array.isArray(data?.factions) ? data.factions : []
    const edges = Array.isArray(data?.edges) ? data.edges : []
    activeFaction = cleanFactionFilter(activeFaction, factions)
    const kept = filterWebEdges(edges, { state: activeState, faction: activeFaction })
    rememberFilters()
    const layout = layoutWeb(factions, kept)
    canvas.innerHTML = renderWebSVG(layout)
    canvas.setAttribute('aria-busy', 'false')
    const byName = new Map(factions.map(entry => [entry?.name, entry]))
    const showEdge = (a, b) => {
      const link = layout.links.find(entry => (entry.a === a && entry.b === b) || (entry.a === b && entry.b === a))
      if (!link || !card) return
      const note = readEdgeNote(deviceStore(), member, link.a, link.b)
      card.innerHTML = renderEdgeCard(link, byName)
        + `<div class="mt-5 border-t border-gold/10 pt-4" data-manager="${escapeHtml(link.a)}|${escapeHtml(link.b)}">`
        + `<p class="text-[10px] tracking-[.25em] text-gold">PERSONAL EDGE NOTE</p>`
        + `<div class="mt-2" data-note-view>${renderEdgeNoteView(note)}</div>`
        + `<label class="block mt-3 text-xs text-cream/40" for="webNoteField">Your reading note on ${escapeHtml(link.a)} · ${escapeHtml(link.state)} · ${escapeHtml(link.b)}</label>`
        + `<textarea id="webNoteField" rows="3" maxlength="2000" class="mt-1 w-full bg-ink border border-gold/20 rounded-lg px-3 py-2 text-sm text-cream/85">${escapeHtml(note)}</textarea>`
        + `<p class="text-[10px] tracking-[.15em] text-cream/30 mt-1">${escapeHtml(WEB_NOTE_STORAGE_LABEL)}</p>`
        + `<p class="flex items-center gap-2 mt-2 flex-wrap">`
        + `<button type="button" data-note-save class="text-xs bg-gold text-ink rounded-full px-4 py-2 font-semibold">KEEP NOTE</button>`
        + `<button type="button" data-note-delete class="text-xs border border-gold/25 text-gold rounded-full px-4 py-2">DELETE NOTE</button>`
        + `<span role="status" class="text-xs text-cream/40" data-note-say></span></p>`
        + `<div class="mt-5 border-t border-gold/10 pt-4">`
        + `<p class="text-[10px] tracking-[.25em] text-gold">PROPOSAL COMPOSER</p>`
        + `<p class="text-[10px] tracking-[.15em] text-cream/30 mt-1">${escapeHtml(WEB_PROPOSAL_LABEL)}</p>`
        + `<label class="block mt-3 text-xs text-cream/40" for="webSuggestField">Suggested change</label>`
        + `<input id="webSuggestField" type="text" maxlength="500" placeholder="e.g. mark this pact as tense" class="mt-1 w-full bg-ink border border-gold/20 rounded-lg px-3 py-2 text-sm text-cream/85" />`
        + `<label class="block mt-3 text-xs text-cream/40" for="webReasonField">Reason (optional)</label>`
        + `<textarea id="webReasonField" rows="2" maxlength="1000" class="mt-1 w-full bg-ink border border-gold/20 rounded-lg px-3 py-2 text-sm text-cream/85"></textarea>`
        + `<p class="flex items-center gap-2 mt-2 flex-wrap">`
        + `<button type="button" data-proposal-copy class="text-xs bg-gold text-ink rounded-full px-4 py-2 font-semibold">COPY PROPOSAL</button>`
        + `<span role="status" class="text-xs text-cream/40" data-proposal-say></span></p>`
        + `<div class="mt-3" data-proposal-view>${renderEdgeProposalPreview('')}</div>`
        + `</div></div>`
      const sayNote = message => { const el = card.querySelector('[data-note-say]'); if (el) el.textContent = message }
      const sayProposal = message => { const el = card.querySelector('[data-proposal-say]'); if (el) el.textContent = message }
      card.querySelector('[data-note-save]')?.addEventListener('click', () => {
        const field = card.querySelector('#webNoteField')
        const ok = writeEdgeNote(deviceStore(), member, link.a, link.b, field ? field.value : '')
        const fresh = readEdgeNote(deviceStore(), member, link.a, link.b)
        const view = card.querySelector('[data-note-view]')
        if (view) view.innerHTML = renderEdgeNoteView(fresh)
        sayNote(ok ? (fresh ? 'Kept on this device — per member, per edge.' : 'Cleared — no note kept on this edge.') : 'That note is too long — keep it under 2000 characters.')
      })
      card.querySelector('[data-note-delete]')?.addEventListener('click', () => {
        const ok = deleteEdgeNote(deviceStore(), member, link.a, link.b)
        const view = card.querySelector('[data-note-view]')
        if (view) view.innerHTML = renderEdgeNoteView('')
        const field = card.querySelector('#webNoteField')
        if (field) field.value = ''
        sayNote(ok ? 'Deleted from this device — nothing was ever shared.' : 'Nothing to delete.')
      })
      card.querySelector('[data-proposal-copy]')?.addEventListener('click', async () => {
        const suggestion = card.querySelector('#webSuggestField')?.value ?? ''
        const reason = card.querySelector('#webReasonField')?.value ?? ''
        const built = buildEdgeProposal({ edge: link, suggestion, reason })
        const view = card.querySelector('[data-proposal-view]')
        if (!built.ok) {
          if (view) view.innerHTML = renderEdgeProposalPreview('')
          sayProposal(built.error)
          return
        }
        if (view) view.innerHTML = renderEdgeProposalPreview(built.text)
        const copied = await copyText(built.text)
        sayProposal(copied ? 'Copied — a proposal for Mikhail, not a canon edit. Nothing was sent.' : 'Copy failed in this browser — select the preview text by hand.')
      })
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
    paintFilterButtons(kept)
    if (status) {
      const bits = [`${factions.length} factions`, `${kept.length} recorded relations`]
      if (activeState !== 'all') bits.push(`state: ${activeState}`)
      if (activeFaction) bits.push(`faction: ${activeFaction}`)
      status.textContent = activeFaction || activeState !== 'all'
        ? `${kept.length} relations — ${bits.join(' · ')}`
        : `${factions.length} factions across ${kept.length} recorded relations`
      status.textContent += ` · ${WEB_FILTERS_STORAGE_LABEL}`
    }
  }
  for (const btn of filters) {
    btn.addEventListener('click', () => {
      activeState = cleanStateFilter(btn.getAttribute('data-state'))
      paint()
    })
  }
  factionPick?.addEventListener('change', () => {
    activeFaction = cleanFactionFilter(factionPick.value, Array.isArray(data?.factions) ? data.factions : [])
    paint()
  })
  try {
    const response = await fetch('/wiki/webs-index.json', { credentials: 'same-origin' })
    if (response.status === 401) {
      location.href = '/?next=' + encodeURIComponent('/webs')
      return
    }
    if (!response.ok) throw new Error('The diplomacy webs index could not be opened')
    data = await response.json()
    member = await currentMember()
    paintFactionOptions(Array.isArray(data?.factions) ? data.factions : [])
    paint()
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : 'The diplomacy webs could not be opened'
  }
}

if (typeof document !== 'undefined') initWebs()
