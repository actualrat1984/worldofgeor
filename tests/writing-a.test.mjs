// Wave H11a: @mentions from the live gated index + per-member entity
// inventories. Mention links resolve only to real index folio URLs (unknown
// names stay plain text — never invented links); autocomplete loads through
// the same-origin gated fetch; inventory storage is member+entity-keyed
// localStorage (the D1 notes table has no update/delete route and no
// quantity columns, so it cannot round-trip add/remove inventories without
// a migration); user text is escaped everywhere.
import test from 'node:test'
import assert from 'node:assert/strict'
import worker, { __test } from '../worker.js'
import {
  MENTION_FETCH_INIT,
  MENTION_SUGGEST_MAX,
  WIKI_INDEX_URL,
  buildMentionLookup,
  extractMentionQuery,
  insertMention,
  linkifyMentions,
  loadMentionIndex,
  matchMentionCandidates,
  renderMentionSuggestions,
  safeMentionEntry,
} from '../public/mentions.js'
import {
  INVENTORY_ITEM_MAX,
  addInventoryItem,
  cleanInventoryEntity,
  inventoryKey,
  parseInventory,
  removeInventoryItem,
  renderInventoryList,
  serializeInventory,
} from '../public/inventory.js'

const SECRET = 'test-only-secret-that-is-longer-than-32-characters'

const INDEX = [
  { title: 'Aelante', url: '/wiki/World/Locations/Cities/North Erisdar/Aelante/' },
  { title: 'Aeger', url: '/wiki/World/Nations/Central Erisdar/Erisian Empire/Counties/Aeger/' },
  { title: 'Adventurer Guilds', url: '/wiki/World/Systems/Adventurer Guilds/' },
]

// --- Mention links only ever point at real index URLs -----------------------

test('mention entries outside /wiki/ never pass the gate', () => {
  assert.deepEqual(safeMentionEntry(INDEX[0]), INDEX[0])
  for (const bad of [
    { title: 'Evil', url: 'https://evil.example/x' },
    { title: 'Root', url: '/' },
    { title: 'Quote', url: '/wiki/x"onmouseover="y' },
    { title: 'Tag', url: '/wiki/<script>' },
    { title: '', url: '/wiki/World/X/' },
    { title: 42, url: '/wiki/World/X/' },
    null,
    undefined,
  ]) assert.equal(safeMentionEntry(bad), null, JSON.stringify(bad))
})

test('mention links resolve only to exact index titles; unknown names stay plain', () => {
  const lookup = buildMentionLookup(INDEX)
  const linked = linkifyMentions('Met @Aelante near @Aeger.', lookup)
  assert.match(linked, /<a href="\/wiki\/World\/Locations\/Cities\/North Erisdar\/Aelante\/">@Aelante<\/a>/)
  assert.match(linked, /<a href="\/wiki\/World\/Nations\/Central Erisdar\/Erisian Empire\/Counties\/Aeger\/">@Aeger<\/a>/)
  const unknown = linkifyMentions('Met @Nobody Here today.', lookup)
  assert.doesNotMatch(unknown, /<a href=/)
  assert.match(unknown, /@Nobody Here/)
  // Multi-word titles link with trailing prose left plain.
  const guilds = linkifyMentions('Joined @Adventurer Guilds at dawn.', lookup)
  assert.match(guilds, /<a href="\/wiki\/World\/Systems\/Adventurer Guilds\/">@Adventurer Guilds<\/a> at dawn\./)
  assert.match(linkifyMentions('hail @aelante', lookup), /<a href="\/wiki\/World\/Locations\/Cities\/North Erisdar\/Aelante\/">@aelante<\/a>/)
  // First index entry wins duplicates.
  const dupes = buildMentionLookup([...INDEX, { title: 'Aelante', url: '/wiki/Other/' }])
  assert.equal(dupes.get('aelante'), '/wiki/World/Locations/Cities/North Erisdar/Aelante/')
})

test('mention rendering escapes user text and never invents links', () => {
  const lookup = buildMentionLookup(INDEX)
  const html = linkifyMentions('<script>alert(1)</script> @Aelante & @Nobody <b>', lookup)
  assert.doesNotMatch(html, /<script>|<b>/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /&amp;/)
  // A mention-looking string inside an attack still links only the real folio.
  assert.match(html, /<a href="\/wiki\/World\/Locations/)
  assert.equal((html.match(/<a href=/g) || []).length, 1)
})

// --- Autocomplete is gated + ranked -----------------------------------------

test('mention index loads through the gated same-origin fetch only', async () => {
  assert.equal(WIKI_INDEX_URL, '/wiki-index.json')
  assert.equal(MENTION_FETCH_INIT.credentials, 'same-origin')
  let seenUrl = null
  let seenInit = null
  const fetchImpl = async (url, init) => {
    seenUrl = url; seenInit = init
    return { ok: true, json: async () => [...INDEX, { title: 'Evil', url: 'https://evil.example/' }] }
  }
  const entries = await loadMentionIndex(fetchImpl)
  assert.equal(seenUrl, '/wiki-index.json')
  assert.equal(seenInit?.credentials, 'same-origin')
  assert.match(String(seenInit?.headers?.Accept || ''), /application\/json/)
  assert.equal(entries.length, 3, 'off-index entries are dropped, never suggested')
  await assert.rejects(() => loadMentionIndex(async () => ({ ok: false })), /unavailable/)
})

test('mention candidates rank prefix first, cap, and ignore blanks', () => {
  const pool = [...INDEX, { title: 'Grand Aelante Port', url: '/wiki/World/X/' }]
  const ranked = matchMentionCandidates(pool, 'ael')
  assert.equal(ranked[0].title, 'Aelante')
  assert.ok(ranked.some(entry => entry.title === 'Grand Aelante Port'))
  assert.deepEqual(matchMentionCandidates(pool, '   '), [])
  const many = Array.from({ length: MENTION_SUGGEST_MAX + 5 }, (_, i) => ({ title: `Aelante ${i}`, url: '/wiki/World/X/' }))
  assert.equal(matchMentionCandidates(many, 'aelante').length, MENTION_SUGGEST_MAX)
})

test('mention queries trigger on token @ only, insert cleanly', () => {
  assert.deepEqual(extractMentionQuery('met @Ael', 8), { query: 'Ael', start: 4, end: 8 })
  assert.equal(extractMentionQuery('mail a@b', 8), null, 'mid-word @ never triggers')
  assert.equal(extractMentionQuery('no token here', 13), null)
  assert.equal(extractMentionQuery('@Ael!', 5), null, 'caret past punctuation is not a live query')
  const inserted = insertMention('met @Ael', 8, 'Aelante')
  assert.deepEqual(inserted, { text: 'met @Aelante ', caret: 13 })
  assert.equal(insertMention('plain text', 10, 'Aelante'), null)
  const suggestions = renderMentionSuggestions([INDEX[0], INDEX[1]], 1)
  assert.match(suggestions, /Aelante/)
  assert.match(suggestions, /aria-selected="true"/)
  assert.equal(renderMentionSuggestions([], 0), '')
  const evil = renderMentionSuggestions([{ title: '<img src=x>', url: '/wiki/X/' }], 0)
  assert.doesNotMatch(evil, /<img src=x>/)
})

test('wiki index stays private: anon JSON fetch is rejected at the gate', async () => {
  assert.equal(__test.isPrivatePath('/wiki-index.json'), true)
  const env = { JWT_SECRET: SECRET, ASSETS: { fetch: async () => new Response('x') } }
  const response = await worker.fetch(new Request('https://worldofgeor.com/wiki-index.json', {
    headers: { Accept: 'application/json' },
  }), env, {})
  assert.equal(response.status, 401)
})

// --- Per-member entity inventories ------------------------------------------

test('inventory keys scope per member and entity; non-folios rejected', () => {
  const entity = '/wiki/World/Characters/Ael/'
  const ada = inventoryKey('ada@example.com', entity)
  const bob = inventoryKey('bob@example.com', entity)
  const other = inventoryKey('ada@example.com', '/wiki/World/Nations/X/')
  assert.ok(ada && bob && other)
  assert.notEqual(ada, bob, 'members never share a pack')
  assert.notEqual(ada, other, 'each folio carries its own pack')
  assert.match(ada, /^geor:inventory:ada@example\.com:\/wiki\//)
  for (const bad of ['https://evil.example/x', '/search?q=ael', '/wiki/../secret', '/wiki/a"b', '', null, 42]) {
    assert.equal(inventoryKey('ada@example.com', bad), null, String(bad))
  }
  assert.equal(cleanInventoryEntity('https://worldofgeor.com/wiki/World/X/'), '/wiki/World/X/')
})

test('inventory add/remove round-trips per member and entity', () => {
  const first = addInventoryItem([], { name: 'Emberglass lantern', qty: 2, note: 'Found at Aelante' })
  assert.ok(first.item?.id)
  assert.equal(first.list.length, 1)
  const second = addInventoryItem(first.list, { name: 'Rope', qty: '3' })
  assert.equal(second.list.length, 2)
  assert.equal(second.list[1].qty, 3)
  // Serialize → parse round-trip keeps quantities and notes.
  const round = parseInventory(serializeInventory(second.list))
  assert.deepEqual(round, second.list)
  // Removal drops only the targeted item.
  const after = removeInventoryItem(round, first.item.id)
  assert.equal(after.length, 1)
  assert.equal(after[0].name, 'Rope')
  assert.deepEqual(removeInventoryItem(after, 'no-such-id'), after)
  // Validation, not silent coercion.
  assert.ok(addInventoryItem([], { name: '   ' }).error)
  assert.ok(addInventoryItem([], { name: 'Rope', qty: 0 }).error)
  assert.ok(addInventoryItem([], { name: 'Rope', qty: 2, note: 'x'.repeat(501) }).error)
  const full = Array.from({ length: INVENTORY_ITEM_MAX }, (_, i) => ({ id: `id-${i}`, name: `item ${i}`, qty: 1, note: '' }))
  assert.ok(addInventoryItem(full, { name: 'one more' }).error)
})

test('inventory parsing drops junk and rendering escapes user text', () => {
  const parsed = parseInventory(JSON.stringify([
    { id: 'a1', name: 'Rope', qty: 2, note: 'ok' },
    { id: 'bad id!!', name: '<script>', qty: 'many', note: 42 },
    { name: '', qty: 1 },
    null,
  ]))
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].name, 'Rope')
  assert.equal(parsed[1].qty, 1, 'malformed quantities fall back to 1')
  assert.deepEqual(parseInventory('not json{{'), [])
  assert.deepEqual(parseInventory('{"a":1}'), [])
  const html = renderInventoryList([
    { id: 'a1', name: '<img src=x onerror=alert(1)>', qty: 2, note: 'a & b <c>' },
  ])
  assert.doesNotMatch(html, /<img src=x|<script>|<c>/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(html, /×2/)
  assert.match(html, /a &amp; b/)
  assert.match(renderInventoryList([]), /No items packed/)
})
