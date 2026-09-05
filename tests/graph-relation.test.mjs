import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { __test } from '../worker.js'
import { escapeHtml, isWikiUrl } from '../public/timeline.js'
import {
  GRAPH_H,
  GRAPH_HOPS,
  GRAPH_W,
  layoutGraph,
  neighborhoodFor,
  renderEdgeDetailRow,
  renderGraphEdge,
  renderGraphNode,
  renderGraphSVG,
  renderNeighborhoodView,
} from '../public/graph.js'

const data = JSON.parse(readFileSync(new URL('../dist/wiki/webs-index.json', import.meta.url), 'utf8'))
const { factions, edges } = data

// Truth BFS over the raw index edges — the only authority for "who is a
// real neighbor at hop k" in the neighborhood tests below.
function bfsHops(start, links, names) {
  const dist = new Map([[start, 0]])
  const queue = [start]
  while (queue.length) {
    const current = queue.shift()
    for (const link of links) {
      if (link.a !== current && link.b !== current) continue
      const other = link.a === current ? link.b : link.a
      if (!names.has(other) || dist.has(other)) continue
      dist.set(other, dist.get(current) + 1)
      queue.push(other)
    }
  }
  return dist
}

test('graph layout pins all 30 edges to the on-disk webs index, deep-equal', () => {
  assert.equal(data.files_scanned, 486)
  assert.equal(factions.length, 38)
  assert.equal(edges.length, 30)
  const layout = layoutGraph(factions, edges)
  assert.equal(layout.nodes.length, factions.length)
  assert.equal(layout.links.length, edges.length)
  // Every edge in the drawn graph IS an index edge, payload for payload.
  const pinned = layout.links.map(({ a, b, state, why, path }) => ({ a, b, state, why, path }))
  assert.deepEqual(pinned, edges)
  // Spot-check the proven pairs from the vault relation lines.
  const find = (a, b) => edges.find(edge =>
    (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a))
  assert.equal(find('Aelefer', 'Tunwif').state, 'allied')
  assert.equal(find('Klobiendar', 'Xi').state, 'war')
  assert.equal(find('Loren', 'Pontificate of Eris').state, 'tense')
  // Link endpoints mirror the final layout coordinates.
  for (const link of layout.links) {
    const a = layout.nodes.find(node => node.name === link.a)
    const b = layout.nodes.find(node => node.name === link.b)
    assert.equal(link.ax, a.x)
    assert.equal(link.ay, a.y)
    assert.equal(link.bx, b.x)
    assert.equal(link.by, b.y)
  }
})

test('layout is deterministic per seed: same input -> same coordinates', () => {
  const first = layoutGraph(factions, edges, 20260905)
  const second = layoutGraph(factions, edges, 20260905)
  assert.deepEqual(first, second)
  // All nodes stay inside the canvas on distinct slots.
  const positions = first.nodes.map(node => `${node.x.toFixed(1)}/${node.y.toFixed(1)}`)
  assert.equal(new Set(positions).size, positions.length, 'overlapping nodes')
  for (const node of first.nodes) {
    assert.ok(node.x >= 0 && node.x <= GRAPH_W && node.y >= 0 && node.y <= GRAPH_H, `${node.name} outside canvas`)
  }
  assert.deepEqual(layoutGraph([], []), { nodes: [], links: [] })
  // Hostile edges (unknown factions, bad states, self-loops) never draw.
  const hostile = layoutGraph(
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
})

test('rendered SVG escapes hostile names and whys; links only ^/wiki/ paths', () => {
  const layout = layoutGraph(factions, edges)
  const svg = renderGraphSVG(layout)
  assert.match(svg, /<svg[^>]*viewBox="0 0 \d+ \d+"/)
  assert.match(svg, /href="\/wiki\//)
  assert.match(svg, /Vennerian Trade Republic/)
  assert.match(svg, /graph-edge-war/)
  assert.match(svg, /graph-edge-allied/)
  assert.match(svg, /graph-edge-tense/)
  for (const node of [
    { name: 'Nowhere', path: '', x: 0, y: 0 },
    { name: 'Evil', path: 'javascript:alert(1)', x: 0, y: 0 },
    { name: 'Offsite', path: 'https://evil.example/wiki/x', x: 0, y: 0 },
    { name: 'Sneaky', path: '/evil', x: 0, y: 0 },
    { name: '<img src=x onerror=alert(1)>', path: '/wiki/Real/', x: 0, y: 0 },
  ]) {
    const html = renderGraphNode(node)
    if (isWikiUrl(node.path)) {
      assert.match(html, /href="\/wiki\/Real\/"/, node.name)
    } else {
      assert.doesNotMatch(html, /href="/, node.name)
    }
    assert.ok(html.includes(escapeHtml(node.name)), node.name)
  }
  assert.doesNotMatch(svg, /<script/)
  // A hostile `why` never leaks raw markup into an edge or its detail row.
  const evilEdge = { a: 'A', b: 'B', state: 'war', why: '</li><script>alert(2)</script>', path: 'https://evil.example/why', ax: 0, ay: 0, bx: 5, by: 5 }
  const edgeHtml = renderGraphEdge(evilEdge, 0)
  assert.doesNotMatch(edgeHtml, /<script/)
  const byName = new Map([['A', { name: 'A', path: '' }], ['B', { name: 'B', path: '' }]])
  const hostileRow = renderEdgeDetailRow(evilEdge, byName)
  assert.doesNotMatch(hostileRow, /<script/)
  assert.doesNotMatch(hostileRow, /href="https:\/\/evil/)
  assert.match(hostileRow, /&lt;\/li&gt;&lt;script&gt;alert\(2\)&lt;\/script&gt;/)
  // A validated wiki path becomes the evidence link; an invalid one renders
  // as plain text while the `why` stays visible either way.
  const wikiRow = renderEdgeDetailRow(
    { a: 'A', b: 'B', state: 'war', why: 'Combatants line in the vault', path: '/wiki/World/History/Events/A/' },
    byName,
  )
  assert.match(wikiRow, /href="\/wiki\/World\/History\/Events\/A\/"/)
  assert.match(wikiRow, /Combatants line in the vault/)
  assert.equal(isWikiUrl('/wiki/World/Nations/South Erisdar/Tunwif/'), true)
  assert.equal(isWikiUrl('https://evil.example/wiki/x'), false)
})

test('neighborhood view contains only real neighbors, capped at 2 hops over the 30 edges', () => {
  const layout = layoutGraph(factions, edges)
  const names = new Set(factions.map(entry => entry.name))
  const indexKeys = new Set(edges.map(edge => [edge.a, edge.b].sort().join('|')))
  const byName = new Map(factions.map(entry => [entry.name, entry]))
  for (const faction of factions) {
    const nb = neighborhoodFor(faction.name, layout.nodes, layout.links, GRAPH_HOPS)
    assert.equal(nb.node.name, faction.name)
    assert.equal(nb.hops.get(faction.name), 0)
    // Exactly the true graph-distance set from the index, nothing beyond.
    const truth = bfsHops(faction.name, edges, names)
    const expected = new Map([...truth].filter(([, hop]) => hop >= 1 && hop <= GRAPH_HOPS))
    const actual = new Map([...nb.hops].filter(([, hop]) => hop >= 1).sort())
    assert.deepEqual(actual, expected, `${faction.name}: invented or missing neighbors`)
    // Every neighborhood edge is one of the 30 pinned index edges.
    assert.ok(nb.edges.every(entry => indexKeys.has([entry.a, entry.b].sort().join('|'))), faction.name)
    assert.ok(nb.edges.length <= edges.length, faction.name)
    // Unknown names get an empty neighborhood, never a fabricated one.
    const ghost = neighborhoodFor('Not a Faction', layout.nodes, layout.links, GRAPH_HOPS)
    assert.equal(ghost.node, null)
    assert.equal(ghost.hops.size, 0)
    assert.equal(ghost.edges.length, 0)
  }
  // Rendered view carries the same bounded reality.
  const view = renderNeighborhoodView('Vennerian Trade Republic', layout.nodes, layout.links, byName, GRAPH_HOPS)
  assert.match(view, /Vennerian Trade Republic/)
  assert.match(view, /href="\/wiki\//)
  assert.match(view, /2 hops/)
  assert.doesNotMatch(view, /<script/)
  const unknown = renderNeighborhoodView('Not a Faction', layout.nodes, layout.links, byName)
  assert.match(unknown, /not recorded/)
})

test('graph gate: worker treats page and script as private', () => {
  assert.equal(__test.isPrivatePath('/graph'), true)
  assert.equal(__test.isPrivatePath('/graph/'), true)
  assert.equal(__test.isPrivatePath('/graph.html'), true)
  assert.equal(__test.isPrivatePath('/graph.js'), true)
  assert.equal(__test.isPrivatePath('/wiki/webs-index.json'), true)
})

test('graph shell fetches exactly the one gated index, stays noindex, avoids new URLs', () => {
  const html = readFileSync(new URL('../public/graph.html', import.meta.url), 'utf8')
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive" \/>/)
  assert.match(html, /id="graphCanvas"/)
  assert.match(html, /id="graphStatus"/)
  assert.match(html, /id="graphCount"/)
  assert.match(html, /id="graphDetail"/)
  assert.match(html, /src="\/graph\.js"/)
  assert.match(html, /src="\/archive-compass\.js"/)
  const script = readFileSync(new URL('../public/graph.js', import.meta.url), 'utf8')
  assert.match(script, /from '\.\/timeline\.js'/)
  assert.match(script, /from '\.\/webs\.js'/)
  assert.match(script, /isWikiUrl/)
  assert.match(script, /escapeHtml/)
  assert.match(script, /\/wiki\/webs-index\.json/)
  assert.match(script, /credentials: 'same-origin'/)
  assert.match(script, /response\.status === 401/)
  // No new fetch URLs beyond the existing gated index — exactly one fetch.
  const fetches = [...script.matchAll(/\bfetch\s*\(/g)]
  assert.equal(fetches.length, 1)
  for (const match of fetches) {
    assert.equal(script.slice(match.index, match.index + 29), 'fetch(\'/wiki/webs-index.json\'')
  }
  const workerSource = readFileSync(new URL('../worker.js', import.meta.url), 'utf8')
  assert.match(workerSource, /\['\/graph', '\/graph\.html'\]/)
  assert.match(workerSource, /\['\/graph\/', '\/graph\.html'\]/)
  assert.match(workerSource, /'\/graph\.js'/)
})