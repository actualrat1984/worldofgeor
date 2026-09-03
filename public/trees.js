// Family Trees (Wave D1) — pure helpers are exported so node --test
// can verify the layered layout, SVG rendering, and the ^/wiki/ link gate
// without a browser. Browser rendering only runs when `document` exists.
import { escapeHtml, isWikiUrl } from './timeline.js'

export const TREE_DX = 180
export const TREE_DY = 150
export const TREE_NODE_W = 150
export const TREE_NODE_H = 44
export const TREE_PAD = 30

// Layer members into generations: roots (no in-house parents) sit on row 0,
// every child one row below its deepest parent. Within a row members keep
// index order, so a simple column grid can never overlap two labels.
export function layoutTree(members) {
  const list = [...(members ?? [])]
  const byName = new Map(list.map(member => [member?.name, member]))
  const generation = new Map()
  const visiting = new Set()
  const generationOf = member => {
    if (generation.has(member?.name)) return generation.get(member.name)
    if (!member || visiting.has(member.name)) return 0
    visiting.add(member.name)
    let depth = 0
    for (const parent of member.parents ?? []) {
      const parentMember = byName.get(parent)
      if (parentMember) depth = Math.max(depth, generationOf(parentMember) + 1)
    }
    visiting.delete(member.name)
    generation.set(member.name, depth)
    return depth
  }
  for (const member of list) generationOf(member)
  const rows = new Map()
  const nodes = list.map(member => {
    const gen = generation.get(member?.name) ?? 0
    const column = rows.get(gen) ?? 0
    rows.set(gen, column + 1)
    return {
      name: String(member?.name ?? ''),
      path: typeof member?.path === 'string' ? member.path : '',
      parents: [...(member?.parents ?? [])],
      spouse: typeof member?.spouse === 'string' ? member.spouse : '',
      generation: gen,
      x: TREE_PAD + column * TREE_DX + TREE_NODE_W / 2,
      y: TREE_PAD + gen * TREE_DY + TREE_NODE_H / 2,
    }
  })
  return nodes
}

// One pedigree node: a ^/wiki/ path becomes a link, hostile or empty paths
// render as plain text — never an off-site href.
export function renderTreeNode(node) {
  const label = escapeHtml(node.name)
  const shape = `<rect x="${-TREE_NODE_W / 2}" y="${-TREE_NODE_H / 2}" width="${TREE_NODE_W}" height="${TREE_NODE_H}" rx="10" class="tree-node" fill="none" stroke="currentColor" stroke-opacity="0.35" /><text text-anchor="middle" dominant-baseline="central" class="tree-label">${label}</text>`
  const inner = isWikiUrl(node.path)
    ? `<a href="${escapeHtml(node.path)}">${shape}</a>`
    : shape
  return `<g transform="translate(${node.x} ${node.y})" data-name="${escapeHtml(node.name)}">${inner}</g>`
}

// Layered SVG pedigree: parents above children, elbow connectors, a dashed
// bond between spouses of the same generation.
export function renderTreeSVG(nodes) {
  const list = [...(nodes ?? [])]
  const byName = new Map(list.map(node => [node.name, node]))
  const width = Math.max(1, ...list.map(node => node.x)) + TREE_NODE_W / 2 + TREE_PAD
  const height = Math.max(1, ...list.map(node => node.y)) + TREE_NODE_H / 2 + TREE_PAD
  const edges = []
  for (const node of list) {
    for (const parent of node.parents ?? []) {
      const source = byName.get(parent)
      if (!source) continue
      const x1 = source.x
      const y1 = source.y + TREE_NODE_H / 2
      const x2 = node.x
      const y2 = node.y - TREE_NODE_H / 2
      const midY = (y1 + y2) / 2
      edges.push(`<path d="M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}" class="tree-edge" fill="none" stroke="currentColor" stroke-opacity="0.3" />`)
    }
  }
  const seen = new Set()
  for (const node of list) {
    const partner = node.spouse ? byName.get(node.spouse) : null
    if (!partner || partner.generation !== node.generation) continue
    const key = [node.name, partner.name].sort().join(' ❦ ')
    if (seen.has(key)) continue
    seen.add(key)
    edges.push(`<line x1="${node.x}" y1="${node.y}" x2="${partner.x}" y2="${partner.y}" class="tree-bond" stroke="currentColor" stroke-opacity="0.4" stroke-dasharray="5 4" />`)
  }
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Family tree" class="tree-svg text-gold">${edges.join('')}${list.map(renderTreeNode).join('')}</svg>`
}

// Sorted house names for the <select>. Empty names omitted.
export function houseNames(houses) {
  const names = []
  for (const house of houses ?? []) {
    const name = typeof house?.house === 'string' ? house.house.trim() : ''
    if (name) names.push(name)
  }
  return names.sort((a, b) => a.localeCompare(b))
}

// --- Browser rendering (never runs under node --test) -----------------------
async function initTrees() {
  const canvas = document.getElementById('treesCanvas')
  const status = document.getElementById('treesStatus')
  const count = document.getElementById('treesCount')
  const select = document.getElementById('houseSelect')
  if (!canvas || !select) return
  try {
    const response = await fetch('/wiki/trees-index.json', { credentials: 'same-origin' })
    if (response.status === 401) {
      location.href = '/?next=' + encodeURIComponent('/trees')
      return
    }
    if (!response.ok) throw new Error('The family trees index could not be opened')
    const data = await response.json()
    const houses = Array.isArray(data?.houses) ? data.houses : []
    select.innerHTML = ''
    for (const name of houseNames(houses)) {
      const option = document.createElement('option')
      option.value = name
      option.textContent = name
      select.appendChild(option)
    }
    const render = () => {
      const house = houses.find(entry => entry?.house === select.value) ?? houses[0]
      if (!house) {
        canvas.innerHTML = '<p class="p-5 text-sm text-cream/40">The archive holds no bloodlines yet.</p>'
        return
      }
      const members = Array.isArray(house.members) ? house.members : []
      canvas.innerHTML = renderTreeSVG(layoutTree(members))
      canvas.setAttribute('aria-busy', 'false')
      const generations = new Set(layoutTree(members).map(node => node.generation)).size
      if (count) count.textContent = `${houses.length} houses · ${houses.reduce((sum, entry) => sum + (entry?.members?.length ?? 0), 0)} members`
      if (status) status.textContent = `${house.house} — ${members.length} members across ${generations} generation${generations === 1 ? '' : 's'}`
    }
    select.addEventListener('change', render)
    render()
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : 'The family trees could not be opened'
  }
}

if (typeof document !== 'undefined') initTrees()
