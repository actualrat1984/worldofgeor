import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { escapeHtml } from '../public/timeline.js'
import { WEB_STATES } from '../public/webs.js'
import {
  EDGE_NOTE_MAX,
  PROPOSAL_REASON_MAX,
  PROPOSAL_SUGGESTION_MAX,
  WEB_FILTERS_KEY,
  WEB_FILTERS_STORAGE_LABEL,
  WEB_NOTE_KEY_PREFIX,
  WEB_NOTE_STORAGE_LABEL,
  WEB_PROPOSAL_LABEL,
  buildEdgeProposal,
  cleanFactionFilter,
  cleanStateFilter,
  countWebEdges,
  deleteEdgeNote,
  edgeKey,
  filterWebEdges,
  readEdgeNote,
  recallWebFilters,
  renderEdgeNoteView,
  renderEdgeProposalPreview,
  websNoteKey,
  writeEdgeNote,
  writeWebFilters,
} from '../public/webs-manager.js'

const data = JSON.parse(readFileSync(new URL('../dist/wiki/webs-index.json', import.meta.url), 'utf8'))
const { factions, edges } = data

function memoryStore() {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
    keys: () => [...map.keys()],
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

test('filters partition the 30 live edges by state with live counts', () => {
  assert.equal(edges.length, 30)
  const counts = countWebEdges(edges)
  assert.deepEqual(counts, { all: 30, allied: 9, tense: 8, war: 13 })
  for (const state of WEB_STATES) {
    const kept = filterWebEdges(edges, { state })
    assert.equal(kept.length, counts[state], `state ${state}`)
    assert.ok(kept.every(edge => edge.state === state))
  }
  const all = filterWebEdges(edges, { state: 'all' })
  assert.equal(all.length, 30)
  assert.notEqual(all, edges, 'fresh array, never the canon reference')
  assert.equal(cleanStateFilter('cold'), 'all')
  assert.equal(cleanStateFilter(null), 'all')
})

test('filters partition by faction: every kept edge touches the faction', () => {
  const target = factions[0].name
  const kept = filterWebEdges(edges, { state: 'all', faction: target })
  const manual = edges.filter(edge => edge.a === target || edge.b === target)
  assert.deepEqual(kept, manual)
  assert.ok(kept.length > 0, 'first faction holds at least one edge')
  assert.ok(kept.every(edge => edge.a === target || edge.b === target))
  // Combined state + faction narrows both ways.
  for (const state of WEB_STATES) {
    const both = filterWebEdges(edges, { state, faction: target })
    assert.ok(both.every(edge => edge.state === state && (edge.a === target || edge.b === target)))
    assert.ok(both.length <= kept.length)
  }
  // Unknown factions reset to unfiltered at the UI layer (cleanFactionFilter
  // returns ''), while the pure filter stays an exact match — never invented.
  assert.equal(cleanFactionFilter('No Such Court', factions), '')
  assert.equal(filterWebEdges(edges, { faction: '' }).length, 30)
  assert.equal(filterWebEdges(edges, { faction: 'No Such Court' }).length, 0)
  assert.equal(cleanFactionFilter('', factions), '')
})

test('filters persist on this device and recall sanitized', () => {
  const store = memoryStore()
  assert.deepEqual(recallWebFilters(store, factions), { state: 'all', faction: '' })
  assert.equal(writeWebFilters(store, { state: 'war', faction: factions[3].name }, factions), true)
  assert.deepEqual(recallWebFilters(store, factions), { state: 'war', faction: factions[3].name })
  // Hostile stored values recall to safe defaults, never invented states.
  store.setItem(WEB_FILTERS_KEY, JSON.stringify({ state: 'cold', faction: 'No Such Court' }))
  const recalled = recallWebFilters(store, factions)
  assert.equal(recalled.state, 'all')
  assert.equal(recalled.faction, '')
  assert.match(WEB_FILTERS_STORAGE_LABEL, /this device/i)
})

test('notes round-trip per member+edge and stay invisible across members', () => {
  const store = memoryStore()
  const [first, second] = [edges[0], edges[1]]
  assert.equal(readEdgeNote(store, 'ichi@geor.example', first.a, first.b), '')
  assert.equal(writeEdgeNote(store, 'ichi@geor.example', first.a, first.b, 'Ichi reads this pact as fragile.'), true)
  assert.equal(readEdgeNote(store, 'ichi@geor.example', first.a, first.b), 'Ichi reads this pact as fragile.')
  // Another member sees nothing; another edge sees nothing; reversed sides share one slot.
  assert.equal(readEdgeNote(store, 'eran@geor.example', first.a, first.b), '')
  assert.equal(readEdgeNote(store, 'ichi@geor.example', second.a, second.b), '')
  assert.equal(readEdgeNote(store, 'ichi@geor.example', first.b, first.a), 'Ichi reads this pact as fragile.')
  assert.equal(edgeKey(first.a, first.b), edgeKey(first.b, first.a))
  assert.ok(websNoteKey('ichi@geor.example', first.a, first.b).startsWith(WEB_NOTE_KEY_PREFIX))
  // Reversible delete clears the slot.
  assert.equal(deleteEdgeNote(store, 'ichi@geor.example', first.a, first.b), true)
  assert.equal(readEdgeNote(store, 'ichi@geor.example', first.a, first.b), '')
  // Over-long notes are rejected without touching storage.
  assert.equal(writeEdgeNote(store, 'ichi@geor.example', first.a, first.b, 'x'.repeat(EDGE_NOTE_MAX + 1)), false)
  assert.equal(readEdgeNote(store, 'ichi@geor.example', first.a, first.b), '')
  assert.match(WEB_NOTE_STORAGE_LABEL, /this device/i)
  assert.match(WEB_NOTE_STORAGE_LABEL, /never canon/i)
})

test('proposal text quotes live canon values and escapes hostile input', () => {
  const edge = edges.find(entry => entry.a === 'Klobiendar' || entry.b === 'Klobiendar')
  const built = buildEdgeProposal({ edge, suggestion: 'Revisit this line at the next council', reason: 'The evidence reads older than the pact.' })
  assert.equal(built.ok, true)
  assert.match(built.text, /Proposal for Mikhail/)
  assert.match(built.text, /not a canon edit/)
  assert.match(built.text, new RegExp(escapeHtml(edge.a)))
  assert.match(built.text, new RegExp(escapeHtml(edge.b)))
  assert.match(built.text, new RegExp(edge.state))
  assert.match(built.text, new RegExp(escapeHtml(edge.why.slice(0, 24))))
  assert.match(built.text, /Revisit this line/)
  // Hostile input travels as inert text: the escaped preview carries no tags.
  const hostile = buildEdgeProposal({
    edge,
    suggestion: '<img src=x onerror=alert(1)> crown them',
    reason: '<script>alert(2)</script> because',
  })
  assert.equal(hostile.ok, true)
  const preview = renderEdgeProposalPreview(hostile.text)
  assert.doesNotMatch(preview, /<img/)
  assert.doesNotMatch(preview, /<script/)
  assert.match(preview, /&lt;img/)
  assert.match(preview, /&lt;script/)
  const noteView = renderEdgeNoteView('<script>alert(3)</script>')
  assert.doesNotMatch(noteView, /<script/)
  assert.match(noteView, /&lt;script/)
  // Empty suggestion is refused; over-long fields are refused.
  assert.equal(buildEdgeProposal({ edge, suggestion: '   ', reason: '' }).ok, false)
  assert.equal(buildEdgeProposal({ edge, suggestion: 'y'.repeat(PROPOSAL_SUGGESTION_MAX + 1), reason: '' }).ok, false)
  assert.equal(buildEdgeProposal({ edge, suggestion: 'fine', reason: 'z'.repeat(PROPOSAL_REASON_MAX + 1) }).ok, false)
  assert.match(WEB_PROPOSAL_LABEL, /not a canon edit/)
  assert.match(WEB_PROPOSAL_LABEL, /nothing is sent/i)
})

test('canon edge objects are never mutated: deep-frozen live data survives every helper', () => {
  const snapshot = JSON.parse(JSON.stringify({ factions, edges }))
  deepFreeze(factions)
  deepFreeze(edges)
  const store = memoryStore()
  filterWebEdges(edges, { state: 'war', faction: factions[0].name })
  countWebEdges(edges)
  recallWebFilters(store, factions)
  writeWebFilters(store, { state: 'tense', faction: '' }, factions)
  edgeKey(edges[0].a, edges[0].b)
  websNoteKey('ichi@geor.example', edges[0].a, edges[0].b)
  readEdgeNote(store, 'ichi@geor.example', edges[0].a, edges[0].b)
  writeEdgeNote(store, 'ichi@geor.example', edges[0].a, edges[0].b, 'a quiet reading')
  deleteEdgeNote(store, 'ichi@geor.example', edges[0].a, edges[0].b)
  buildEdgeProposal({ edge: edges[5], suggestion: 'recheck', reason: 'why not' })
  renderEdgeNoteView('x')
  renderEdgeProposalPreview('y')
  cleanStateFilter('war')
  cleanFactionFilter(factions[0].name, factions)
  assert.deepEqual(JSON.parse(JSON.stringify({ factions, edges })), snapshot)
})

test('manager shell: copy-only composer, no send path, device-honest labels in the page', () => {
  const manager = readFileSync(new URL('../public/webs-manager.js', import.meta.url), 'utf8')
  assert.doesNotMatch(manager, /fetch\s*\(/)
  assert.doesNotMatch(manager, /XMLHttpRequest/)
  assert.doesNotMatch(manager, /navigator\.sendBeacon/)
  assert.doesNotMatch(manager, /\/api\//)
  const script = readFileSync(new URL('../public/webs.js', import.meta.url), 'utf8')
  assert.match(script, /webs-manager\.js/)
  assert.match(script, /clipboard\.writeText/)
  assert.doesNotMatch(script, /\/api\/additions/)
  const html = readFileSync(new URL('../public/webs.html', import.meta.url), 'utf8')
  assert.match(html, /id="websFaction"/)
  assert.match(html, /FILTERS ARE KEPT ON THIS DEVICE ONLY/)
})
