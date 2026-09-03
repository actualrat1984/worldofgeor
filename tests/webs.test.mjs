import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { __test } from '../worker.js'
import { escapeHtml, isWikiUrl } from '../public/timeline.js'
import {
  WEB_STATES,
  isWebState,
  layoutWeb,
  renderEdgeCard,
  renderFactionCard,
  renderWebEdge,
  renderWebNode,
  renderWebSVG,
  stateColor,
} from '../public/webs.js'

const data = JSON.parse(readFileSync(new URL('../dist/wiki/webs-index.json', import.meta.url), 'utf8'))
const { factions, edges } = data

test('webs index shape: 38 factions, 30 evidence-backed edges joined from vault relation lines by title match', () => {
  assert.equal(data.files_scanned, 486)
  assert.equal(factions.length, 38)
  assert.equal(edges.length, 30)
  const byState = { allied: 0, tense: 0, war: 0 }
  for (const edge of edges) byState[edge.state]++
  assert.deepEqual(byState, { allied: 9, tense: 8, war: 13 })
  assert.ok(edges.every(edge => WEB_STATES.includes(edge.state)))
  assert.ok(edges.every(edge => typeof edge.a === 'string' && typeof edge.b === 'string' && edge.a !== edge.b))
  assert.ok(edges.every(edge => typeof edge.why === 'string' && edge.why.length > 0))
  assert.ok(edges.every(edge => typeof edge.path === 'string'))
  assert.ok(edges.every(edge => isWikiUrl(edge.path)), 'every edge links its evidence in the wiki')
  assert.ok(factions.every(entry => typeof entry.name === 'string' && entry.name.length > 0))
  assert.ok(factions.every(entry => typeof entry.path === 'string' && isWikiUrl(entry.path)))
  // No invented factions: every edge side is a listed faction.
  const known = new Set(factions.map(entry => entry.name))
  assert.ok(edges.every(edge => known.has(edge.a) && known.has(edge.b)))
  // No duplicate pairs.
  const pairs = edges.map(edge => [edge.a, edge.b].sort().join(' ❦ '))
  assert.equal(new Set(pairs).size, pairs.length)
  const names = factions.map(entry => entry.name)
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), 'factions ship pre-sorted')
  // Spot-checks against the vault evidence.
  const find = (a, b) => edges.find(edge =>
    (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a))
  assert.equal(find('Klobiendar', 'Xi').state, 'war')
  assert.equal(find('Cletas Democracy', 'Taberis').state, 'war')
  assert.equal(find('Cletas Democracy', 'Vennerian Trade Republic').state, 'allied')
  assert.equal(find('Anos Plutocracy', 'Vennerian Trade Republic').state, 'tense')
  assert.equal(find('Ameboria', 'Kent').state, 'war')
  assert.equal(find('Coalsteel Kingdom', 'Elf Kingdom').state, 'war')
})

test('layout puts every faction on its own circle slot and drops hostile edges', () => {
  const layout = layoutWeb(factions, edges)
  assert.equal(layout.nodes.length, factions.length)
  const positions = layout.nodes.map(node => `${node.x.toFixed(3)}/${node.y.toFixed(3)}`)
  assert.equal(new Set(positions).size, positions.length, 'overlapping nodes')
  assert.equal(layout.links.length, edges.length)
  assert.deepEqual(layoutWeb([], []), { nodes: [], links: [] })
  // Hostile states and unknown factions never become links.
  const hostile = layoutWeb(
    [{ name: 'A', path: '' }, { name: 'B', path: '' }],
    [
      { a: 'A', b: 'B', state: 'war', why: 'x', path: '' },
      { a: 'A', b: 'B', state: 'cold', why: 'x', path: '' },
      { a: 'A', b: 'https://evil.example/x', why: 'x', path: '' },
      { a: 'A', b: 'A', state: 'war', why: 'x', path: '' },
    ],
  )
  assert.equal(hostile.links.length, 1)
  assert.equal(hostile.links[0].state, 'war')
  assert.equal(isWebState('allied'), true)
  assert.equal(isWebState('cold'), false)
  assert.equal(stateColor('war'), '#c0392b')
})

test('rendered nodes and cards link only ^/wiki/ paths; hostile or empty paths render as text', () => {
  const layout = layoutWeb(factions, edges)
  const svg = renderWebSVG(layout)
  assert.match(svg, /<svg[^>]*viewBox="0 0 \d+ \d+"/)
  assert.match(svg, /href="\/wiki\//)
  assert.match(svg, /Vennerian Trade Republic/)
  assert.match(svg, /web-edge-war/)
  assert.match(svg, /web-edge-allied/)
  assert.match(svg, /web-edge-tense/)
  for (const member of [
    { name: 'Nowhere', path: '', x: 0, y: 0 },
    { name: 'Evil', path: 'javascript:alert(1)', x: 0, y: 0 },
    { name: 'Offsite', path: 'https://evil.example/wiki/x', x: 0, y: 0 },
    { name: 'Sneaky', path: '/evil', x: 0, y: 0 },
  ]) {
    const html = renderWebNode(member)
    assert.doesNotMatch(html, /href="/, member.name)
    assert.match(html, new RegExp(escapeHtml(member.name)))
  }
  const byName = new Map(factions.map(entry => [entry.name, entry]))
  const card = renderEdgeCard(edges[0], byName)
  assert.match(card, /\/wiki\//)
  const hostileCard = renderEdgeCard({ ...edges[0], path: 'https://evil.example/x' }, byName)
  assert.doesNotMatch(hostileCard, /href="https:\/\/evil/)
  const factionCard = renderFactionCard({ name: factions[0].name, path: factions[0].path }, layout.links)
  assert.match(factionCard, new RegExp(escapeHtml(factions[0].name)))
  const edgeHtml = renderWebEdge(layout.links[0], 0)
  assert.match(edgeHtml, /data-edge="0"/)
})

test('webs gate: worker treats page and script as private', () => {
  assert.equal(__test.isPrivatePath('/webs'), true)
  assert.equal(__test.isPrivatePath('/webs/'), true)
  assert.equal(__test.isPrivatePath('/webs.html'), true)
  assert.equal(__test.isPrivatePath('/webs.js'), true)
  assert.equal(__test.isPrivatePath('/wiki/webs-index.json'), true)
})

test('webs shell fetches the gated index, mounts filters and card, stays noindex', () => {
  const html = readFileSync(new URL('../public/webs.html', import.meta.url), 'utf8')
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive" \/>/)
  assert.match(html, /id="websCanvas"/)
  assert.match(html, /id="websStatus"/)
  assert.match(html, /id="webCard"/)
  assert.match(html, /src="\/webs\.js"/)
  assert.match(html, /src="\/archive-compass\.js"/)
  const script = readFileSync(new URL('../public/webs.js', import.meta.url), 'utf8')
  assert.match(script, /from '\.\/timeline\.js'/)
  assert.match(script, /isWikiUrl/)
  assert.match(script, /escapeHtml/)
  assert.match(script, /\/wiki\/webs-index\.json/)
  const workerSource = readFileSync(new URL('../worker.js', import.meta.url), 'utf8')
  assert.match(workerSource, /\['\/webs', '\/webs\.html'\]/)
  assert.match(workerSource, /'\/webs\.js'/)
  const compass = readFileSync(new URL('../public/archive-compass.js', import.meta.url), 'utf8')
  assert.match(compass, /url: '\/webs'/)
})
