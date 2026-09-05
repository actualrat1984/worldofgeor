// Wave H13: gallery mass-curation (per-member, device-local) + manuscript
// presence v1 (same-device tabs only). Curation is member-keyed localStorage
// — never canon, never shared — with honest device-local labels; presence is
// a localStorage heartbeat visible only to tabs on this device, explicitly
// NOT live collaborators. Tests verify scoping across members, select-all /
// clear partitioning of the 78 live entries, heartbeat register/clear with
// the honest label, escaping of hostile names, and that the canon index is
// never mutated (deep-freeze).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyCurationFilter,
  clearCurationNames,
  cleanCurationName,
  cleanCurationTag,
  curationKey,
  curationTagValues,
  hideCurationNames,
  parseCuration,
  renderCurationSummary,
  selectAllNames,
  serializeCuration,
  toggleCurationTags,
} from '../public/gallery-curation.js'
import {
  PRESENCE_STORAGE_LABEL,
  PRESENCE_TAB_TTL_MS,
  parsePresence,
  presenceHeartbeat,
  presenceKey,
  presenceLeave,
  presenceTabCount,
  renderPresence,
} from '../public/manuscript-presence.js'

const data = JSON.parse(readFileSync(new URL('../dist/wiki/gallery-index.json', import.meta.url), 'utf8'))
const entries = data.entries

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) freezeDeep(value[key])
  }
  return value
}

// --- Curation keys scope per member; canon index is read-only --------------

test('curation keys scope per member and never share a blob', () => {
  const ada = curationKey('Ada@Example.com')
  const bob = curationKey('bob@example.com')
  assert.ok(ada && bob)
  assert.notEqual(ada, bob, 'members never share curation')
  assert.match(ada, /^geor:gallery-curation:ada@example\.com$/)
  assert.equal(curationKey('   '), curationKey('local'))
})

test('curation round-trips per member and stays invisible across members', () => {
  const ada = toggleCurationTags({ tags: {}, hidden: [] }, ['Aelis', 'Amelia'], 'favorite')
  assert.deepEqual(ada.tags.Aelis, ['favorite'])
  assert.deepEqual(ada.tags.Amelia, ['favorite'])
  const adaHidden = hideCurationNames(ada, ['Aelis'], true)
  assert.ok(adaHidden.hidden.includes('Aelis'))
  assert.ok(!adaHidden.hidden.includes('Amelia'))

  const adaBlob = serializeCuration(adaHidden)
  const bob = parseCuration(adaBlob)
  // Bob's view of the same blob is empty until he curates his own.
  const bobEmpty = parseCuration(serializeCuration({ tags: {}, hidden: [] }))
  assert.deepEqual(bobEmpty.tags, {})
  assert.deepEqual(bobEmpty.hidden, [])
  // The blob Ada wrote round-trips exactly back to Ada's curation.
  assert.deepEqual(parseCuration(adaBlob), adaHidden)
  assert.deepEqual(adaBlob, serializeCuration(parseCuration(adaBlob)))

  // Toggling the same tag again removes it (reversible, idempotent).
  const unTagged = toggleCurationTags(adaHidden, ['Aelis'], 'favorite')
  assert.ok(!unTagged.tags.Aelis)
  // Unhiding restores the entry to view.
  const revealed = hideCurationNames(adaHidden, ['Aelis'], false)
  assert.ok(!revealed.hidden.includes('Aelis'))
  // Clearing tags drops tags but keeps hide flags unless asked.
  const cleared = clearCurationNames(adaHidden, ['Amelia'], false)
  assert.ok(!cleared.tags.Amelia)
  assert.deepEqual(cleared.hidden, ['Aelis'])
})

test('select-all and clear partition the 78 live entries', () => {
  assert.equal(entries.length, 78)
  const all = selectAllNames(entries)
  assert.equal(all.length, 78)
  assert.equal(new Set(all).size, 78)
  const none = selectAllNames([])
  assert.deepEqual(none, [])
  assert.equal(none.length + all.length, 78, 'select-all + clear partition the live archive')
})

test('applyCurationFilter hides, tags filter, and includeHidden reveals', () => {
  const curation = toggleCurationTags({ tags: {}, hidden: [] }, ['Aelis'], 'favorite')
  const hidden = hideCurationNames(curation, ['Emrys — Life Before Ge\'or'], true)
  assert.equal(applyCurationFilter(entries, hidden).length, 77)
  assert.ok(applyCurationFilter(entries, hidden).every(entry => entry.name !== 'Emrys — Life Before Ge\'or'))
  const tagged = applyCurationFilter(entries, hidden, { tag: 'favorite' })
  assert.equal(tagged.length, 1)
  assert.equal(tagged[0].name, 'Aelis')
  const reveal = applyCurationFilter(entries, hidden, { includeHidden: true })
  assert.equal(reveal.length, 78)
  // A blank curation changes nothing.
  assert.equal(applyCurationFilter(entries, { tags: {}, hidden: [] }).length, 78)
})

test('hostile names and tags are cleaned and escaped, never injected', () => {
  assert.equal(cleanCurationName('<img src=x onerror=alert(1)>'), null)
  assert.equal(cleanCurationName('a"b'), 'a"b', 'quotes are escaped at render, not stripped')
  assert.equal(cleanCurationName('   '), null)
  assert.equal(cleanCurationTag('  spaced  out  '), 'spaced out')
  const html = renderCurationSummary({ tags: { '<b>x</b>': ['<i>y</i>'] }, hidden: ['<script>'] })
  // Names/tags never render raw — hostile rows only feed counts; the label's
  // ampersand is escaped.
  assert.doesNotMatch(html, /<b>|<i>|<script>/)
  assert.match(html, /1 tag on 1 character/)
  assert.match(html, /1 hidden from your view/)
  assert.ok(html.includes('&amp;'))
  assert.ok(html.includes('kept on this device only, per member; never the archive'))
})

test('canon index is never mutated — deep-frozen entries survive every helper', () => {
  const frozen = freezeDeep(entries)
  assert.ok(Object.isFrozen(frozen[0]))
  let curation = { tags: {}, hidden: [] }
  curation = toggleCurationTags(curation, selectAllNames(frozen), 'keeper-note')
  const taggedBlob = serializeCuration(curation)
  assert.deepEqual(parseCuration(taggedBlob).tags.Aelis, ['keeper-note'])
  assert.deepEqual(curationTagValues(parseCuration(taggedBlob)), ['keeper-note'])
  curation = hideCurationNames(curation, selectAllNames(frozen), true)
  curation = clearCurationNames(curation, selectAllNames(frozen), true)
  assert.deepEqual(curationTagValues(curation), [])
  assert.deepEqual(curation.hidden, [])
  applyCurationFilter(frozen, curation, { includeHidden: true })
  assert.equal(selectAllNames(frozen).length, 78)
  assert.equal(frozen.length, 78)
  assert.equal(frozen[0].name, entries[0].name)
  // Round-trip parse/serialize of a hostile blob is safe.
  assert.deepEqual(parseCuration('{"tags":{"<x>":["a"]},"hidden":[42,"<y>"]}'), { tags: {}, hidden: [] })
  assert.deepEqual(parseCuration('not json{{'), { tags: {}, hidden: [] })
})

// --- Manuscript presence v1 (same-device tabs only) ------------------------

test('presence heartbeat registers and clears tabs; stale tabs prune', () => {
  const now = Date.now()
  const mine = 'presence-tab-1'
  let tabs = presenceHeartbeat([], mine, now)
  assert.equal(tabs.length, 1)
  assert.equal(tabs[0].id, mine)
  assert.equal(tabs[0].at, now)
  // A second tab registers alongside.
  tabs = presenceHeartbeat(tabs, 'presence-tab-2', now + 1000)
  assert.equal(tabs.length, 2)
  assert.equal(presenceTabCount(tabs), 2)
  // My heartbeat refreshes only my own timestamp.
  tabs = presenceHeartbeat(tabs, mine, now + 2000)
  assert.equal(tabs.length, 2)
  assert.equal(tabs.find(tab => tab.id === mine).at, now + 2000)
  // Leaving removes only my tab.
  tabs = presenceLeave(tabs, mine)
  assert.equal(tabs.length, 1)
  assert.equal(tabs[0].id, 'presence-tab-2')
  // Stale heartbeats fall away only at parse time — raw count still sees them.
  const stale = [{ id: 'presence-tab-2', at: now - PRESENCE_TAB_TTL_MS - 1 }]
  assert.equal(presenceTabCount(stale), 1, 'raw count does not prune')
  assert.equal(parsePresence(JSON.stringify(stale), Date.now()).length, 0, 'parsing prunes stale heartbeats')
})

test('presence render carries the honest single-device label, never live collaborators', () => {
  const now = Date.now()
  const rendered = renderPresence([{ id: 'tab-a', at: now }])
  assert.match(rendered, /you have this open in 1 tab/)
  assert.match(rendered, /data-presence="live"/)
  assert.ok(rendered.includes(PRESENCE_STORAGE_LABEL))
  assert.match(PRESENCE_STORAGE_LABEL, /this device only, no live collaborators yet/)
  assert.match(renderPresence([{ id: 'a', at: now }, { id: 'b', at: now }]), /2 tabs/)
  assert.equal(renderPresence([]), '')
  // A hostile tab id or a stale heartbeat can never render.
  assert.equal(renderPresence([{ id: '<img src=x>', at: now }]), '')
  assert.equal(renderPresence([{ id: 'ok-tab', at: now - PRESENCE_TAB_TTL_MS - 1 }]), '')
})

test('presence keys are path-scoped and reject hostile paths', () => {
  const key = presenceKey('Books/Ember/Arrival.md')
  assert.match(key, /^geor:manuscript-presence:Books\/Ember\/Arrival\.md$/)
  for (const bad of ['', '../secret', '/wiki/a<b', 'x'.repeat(501), 42, null]) {
    assert.equal(presenceKey(bad), null, String(bad))
  }
  // Two different chapters never share a presence namespace.
  assert.notEqual(presenceKey('Books/Ember/Arrival.md'), presenceKey('Books/Ember/Leaving.md'))
})
