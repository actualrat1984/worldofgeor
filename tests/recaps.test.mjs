// Wave H21: session recap engine — entities link only on exact gated
// index hits (unknown/hostile names stay plain and escaped), pins quote
// live timeline event + month values with exact /timeline and /calendar
// hrefs, entries round-trip per member and stay invisible across members,
// canon indexes are never mutated, and no fetch URL beyond the wiki index
// and the timeline index is ever added.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { safeMentionEntry, buildMentionLookup } from '../public/mentions.js'
import {
  RECAP_TIMELINE_URL,
  RECAP_TIMELINE_HREF,
  RECAP_CALENDAR_HREF,
  RECAP_EMPTY_TEXT,
  WIKI_INDEX_URL,
  addRecap,
  deleteRecap,
  linkifyRecapEntities,
  matchTimelinePin,
  readRecaps,
  recapEventKey,
  recapStorageKey,
  renderRecapItem,
  renderRecapList,
  resolveRecapPin,
  restoreRecap,
  safeRecapEvent,
  validateRecap,
  writeRecaps,
  loadRecapIndexes,
} from '../public/recaps.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const recapsSrc = readFileSync(path.join(root, 'public', 'recaps.js'), 'utf8')

// Synthetic fixtures (test-only shapes, never shipped as canon).
const WIKI_RAW = [
  { title: 'Kaelis Thorn', url: '/wiki/People/Kaelis-Thorn' },
  { title: 'Erisian Empire', url: '/wiki/Nations/Erisian-Empire' },
  { title: 'Erisian', url: '/wiki/Houses/Erisian' },
  { title: 'Offsite Evil', url: 'https://evil.example/x' },
  { title: '<img src=x onerror=alert(1)>', url: '/wiki/Secrets/Evil' },
]

const TIMELINE_RAW = {
  ages: [{ age: 'Ashen Age' }],
  events: [
    { date: '12 AGD', event: 'The ford fell at dusk', era: 'Ashen Age' },
    { date: '3 BGD', event: 'The reef coves were named', era: 'Tide Age' },
  ],
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key])
    Object.freeze(value)
  }
  return value
}

function snapshot(value) {
  return JSON.parse(JSON.stringify(value))
}

function gatedLookup() {
  const wiki = WIKI_RAW.map(safeMentionEntry).filter(Boolean)
  return { wiki, lookup: buildMentionLookup(wiki) }
}

function fakeStorage() {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value))
    },
    removeItem: key => {
      map.delete(key)
    },
  }
}

function stubFetch(wikiRaw, timelineRaw, calls = []) {
  return async (url, init) => {
    calls.push({ url, init })
    if (url === WIKI_INDEX_URL) return { ok: true, status: 200, json: async () => wikiRaw }
    if (url === RECAP_TIMELINE_URL) return { ok: true, status: 200, json: async () => timelineRaw }
    return { ok: false, status: 404, json: async () => null }
  }
}

test('entity links fire only on exact gated index hits', () => {
  const { lookup } = gatedLookup()
  const html = linkifyRecapEntities('Kaelis Thorn crossed with the Erisian Empire.', lookup)
  assert.match(html, /<a href="\/wiki\/People\/Kaelis-Thorn">Kaelis Thorn<\/a>/)
  assert.match(html, /<a href="\/wiki\/Nations\/Erisian-Empire">Erisian Empire<\/a>/)
})

test('unknown names stay plain text, hostile input stays escaped', () => {
  const { lookup } = gatedLookup()
  const html = linkifyRecapEntities('Unknown Person met <script>alert(1)</script> near the ford.', lookup)
  assert.ok(!html.includes('<a href='), 'no link fires without an exact gated hit')
  assert.ok(html.includes('Unknown Person'), 'unknown names stay plain')
  assert.ok(!html.includes('<script>'), 'hostile markup never passes through')
  assert.ok(html.includes('&lt;script&gt;'), 'hostile markup is escaped')
})

test('non-/wiki/ index urls never become links; hostile titles link safely or not at all', () => {
  const { wiki, lookup } = gatedLookup()
  assert.ok(wiki.every(entry => entry.url.startsWith('/wiki/')), 'gate drops offsite urls before lookup')
  const offsite = linkifyRecapEntities('Offsite Evil waited outside.', lookup)
  assert.ok(!offsite.includes('<a href='), 'offsite title never links')
  const hostile = linkifyRecapEntities('Saw <img src=x onerror=alert(1)> at dawn.', lookup)
  assert.ok(!hostile.includes('<img'), 'hostile title text is escaped')
  assert.ok(!hostile.includes('onerror=alert(1)>'), 'hostile attributes never pass through raw')
  for (const href of [...hostile.matchAll(/href="([^"]*)"/g)].map(match => match[1])) {
    assert.ok(href.startsWith('/wiki/'), 'every emitted href stays on ^/wiki/')
  }
})

test('longest exact title wins, partial words never link', () => {
  const { lookup } = gatedLookup()
  const html = linkifyRecapEntities('The Erisian Empire marched.', lookup)
  assert.equal([...html.matchAll(/<a href=/g)].length, 1, 'one link for the longest exact title')
  assert.match(html, />Erisian Empire<\/a>/)
  const partial = linkifyRecapEntities('ErisianEmpire rose.', lookup)
  assert.ok(!partial.includes('<a href='), 'mid-word runs never link')
})

test('timeline pin auto-matches live event dates and quotes them at /timeline', () => {
  const { lookup } = gatedLookup()
  const events = TIMELINE_RAW.events.map(safeRecapEvent)
  const entry = { title: 'The ford', dateText: 'Late 12 AGD, Embermoon', monthText: 'Embermoon', body: 'Kaelis Thorn held the line.' }
  const pin = resolveRecapPin(entry, events)
  assert.ok(pin && pin.auto, 'live date auto-matches')
  assert.equal(pin.event.event, 'The ford fell at dusk')
  const html = renderRecapItem(entry, lookup, events)
  assert.match(html, /href="\/timeline"/, 'timeline href is exactly /timeline')
  assert.ok(html.includes('12 AGD — The ford fell at dusk'), 'pin quotes the live event values')
})

test('calendar pin quotes the month at exactly /calendar', () => {
  const { lookup } = gatedLookup()
  const events = TIMELINE_RAW.events.map(safeRecapEvent)
  const html = renderRecapItem({ title: 'Tides', dateText: '', monthText: 'Embermoon', body: 'Quiet watch.' }, lookup, events)
  assert.match(html, /<a href="\/calendar"[^>]*>Embermoon<\/a>/)
  assert.equal(RECAP_TIMELINE_HREF, '/timeline')
  assert.equal(RECAP_CALENDAR_HREF, '/calendar')
})

test('manual live event pick pins when the date matches nothing', () => {
  const { lookup } = gatedLookup()
  const events = TIMELINE_RAW.events.map(safeRecapEvent)
  const key = recapEventKey(events[1])
  const entry = { title: 'Reefs', dateText: 'some undated evening', eventKey: key, body: 'Named the coves.' }
  const pin = resolveRecapPin(entry, events)
  assert.ok(pin && !pin.auto, 'manual live pick resolves')
  const html = renderRecapItem(entry, lookup, events)
  assert.match(html, /href="\/timeline"/)
  assert.ok(html.includes('3 BGD — The reef coves were named'), 'pin quotes the picked live event')
})

test('unknown event keys stay unpinned — never invented', () => {
  const events = TIMELINE_RAW.events.map(safeRecapEvent)
  assert.equal(resolveRecapPin({ dateText: 'no date anywhere', eventKey: 'made-up — event' }, events), null)
  const { lookup } = gatedLookup()
  const html = renderRecapItem({ title: 'Drift', body: 'Nothing dated.' }, lookup, events)
  assert.ok(!html.includes('href="/timeline"'), 'no timeline pin without a live match')
  assert.ok(html.includes('NOT PINNED YET'), 'honest unpinned state')
})

test('entries round-trip per member and stay invisible across members', () => {
  const storage = fakeStorage()
  const first = addRecap(storage, 'mikhail@example.com', { title: 'Ford', dateText: '12 AGD', monthText: 'Embermoon', body: 'Kaelis Thorn held.' })
  assert.ok(first.entry && first.entry.id, 'entry files')
  assert.equal(readRecaps(storage, 'mikhail@example.com').length, 1)
  assert.deepEqual(readRecaps(storage, 'ichi@example.com'), [], 'members never see each other')
  assert.notEqual(recapStorageKey('mikhail@example.com'), recapStorageKey('ichi@example.com'))
  const second = addRecap(storage, 'mikhail@example.com', { title: 'Reefs', body: 'Named the coves.' })
  assert.equal(readRecaps(storage, 'mikhail@example.com').length, 2)
  assert.ok(second.entry)
})

test('delete is reversible via restore', () => {
  const storage = fakeStorage()
  const { entry } = addRecap(storage, 'mikhail@example.com', { title: 'Ford', body: 'Held the line.' })
  assert.equal(deleteRecap(storage, 'mikhail@example.com', entry.id), true)
  const { lookup } = gatedLookup()
  const events = TIMELINE_RAW.events.map(safeRecapEvent)
  assert.ok(!renderRecapList(readRecaps(storage, 'mikhail@example.com'), lookup, events).includes('Ford'), 'deleted hides from list')
  assert.equal(restoreRecap(storage, 'mikhail@example.com', entry.id), true)
  assert.ok(renderRecapList(readRecaps(storage, 'mikhail@example.com'), lookup, events).includes('Ford'), 'restore brings it back')
  assert.equal(deleteRecap(storage, 'mikhail@example.com', 'missing-id'), false)
})

test('validation rejects hollow and oversized recaps', () => {
  assert.ok(validateRecap({ title: '', body: '' }).length > 0, 'title and body required')
  assert.ok(validateRecap({ title: 'T', body: '' }).length > 0, 'body required')
  assert.ok(validateRecap({ title: 'T', body: 'x'.repeat(20001) }).length > 0, 'body cap enforced')
  assert.deepEqual(validateRecap({ title: 'T', body: 'Held.' }), [], 'good recap passes')
})

test('rendered recaps escape every hostile field', () => {
  const { lookup } = gatedLookup()
  const events = TIMELINE_RAW.events.map(safeRecapEvent)
  const html = renderRecapItem({
    title: '<script>alert(1)</script>',
    dateText: '12 AGD"><b>',
    monthText: '<i>Ember</i>',
    body: 'Kaelis Thorn <img src=x onerror=alert(2)>',
  }, lookup, events)
  assert.ok(!html.includes('<script>') && !html.includes('<img'), 'hostile fields never pass through')
  assert.ok(html.includes('&lt;script&gt;'), 'hostile title is escaped')
  assert.match(html, /<a href="\/wiki\/People\/Kaelis-Thorn">Kaelis Thorn<\/a>/, 'exact hits still link beside hostile text')
})

test('empty state is honest about the device-local list', () => {
  const { lookup } = gatedLookup()
  const html = renderRecapList([], lookup, [])
  assert.ok(html.includes(RECAP_EMPTY_TEXT), 'honest empty state renders')
})

test('canon indexes are never mutated (deep-frozen)', () => {
  const wikiRaw = deepFreeze(snapshot(WIKI_RAW))
  const timelineRaw = deepFreeze(snapshot(TIMELINE_RAW))
  const wikiBefore = snapshot(wikiRaw)
  const timelineBefore = snapshot(timelineRaw)
  const wiki = wikiRaw.map(safeMentionEntry).filter(Boolean)
  const lookup = buildMentionLookup(wiki)
  const events = timelineRaw.events.map(safeRecapEvent)
  linkifyRecapEntities('Kaelis Thorn and the Erisian Empire at 12 AGD.', lookup)
  matchTimelinePin('12 AGD', events)
  resolveRecapPin({ dateText: '12 AGD', eventKey: recapEventKey(events[0]) }, events)
  renderRecapItem({ title: 'T', dateText: '12 AGD', monthText: 'M', body: 'Kaelis Thorn' }, lookup, events)
  writeRecaps(fakeStorage(), 'mikhail@example.com', [{ id: 'x', title: 'T', body: 'B' }])
  assert.deepEqual(snapshot(wikiRaw), wikiBefore, 'wiki index untouched')
  assert.deepEqual(snapshot(timelineRaw), timelineBefore, 'timeline index untouched')
})

test('gated load fetches only the wiki index and timeline index, same-origin', async () => {
  const calls = []
  const indexes = await loadRecapIndexes(stubFetch(snapshot(WIKI_RAW), snapshot(TIMELINE_RAW), calls))
  assert.equal(indexes.wiki.length, 4, 'offsite entry gated out, hostile title kept as escaped text')
  assert.equal(indexes.events.length, 2)
  const urls = calls.map(call => call.url).sort()
  assert.deepEqual(urls, [RECAP_TIMELINE_URL, WIKI_INDEX_URL].sort())
  for (const call of calls) {
    assert.equal(call.init?.credentials, 'same-origin', `${call.url} stays same-origin`)
  }
  assert.equal(RECAP_TIMELINE_URL, '/wiki/timeline-index.json')
})

test('denied canon reads surface a 401 for the redirect', async () => {
  const denied = async () => ({ ok: false, status: 401, json: async () => null })
  await assert.rejects(loadRecapIndexes(denied), error => error?.status === 401)
})

test('no new fetch urls beyond the wiki index and the timeline index', () => {
  assert.ok(recapsSrc.includes("WIKI_INDEX_URL") && recapsSrc.includes("from './mentions.js'"), 'wiki index url reused from the mentions gate')
  const literals = [...recapsSrc.matchAll(/'(\/[^']*)'/g)].map(match => match[1])
  const allowed = new Set(['/wiki/timeline-index.json', '/timeline', '/calendar', '/recaps', '/?next='])
  for (const literal of literals) {
    assert.ok(allowed.has(literal), `no invented route or endpoint: ${literal}`)
  }
  assert.ok(!recapsSrc.includes('http://') && !recapsSrc.includes('https://'), 'no off-origin urls')
  assert.ok(!recapsSrc.includes('/api/'), 'no new api endpoints')
})
