import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { __test } from '../worker.js'
import { escapeHtml, isWikiUrl } from '../public/timeline.js'
import {
  ORACLE_MODES,
  pickRandom,
  renderOracleLink,
  renderOracleResult,
  rollCharacter,
  rollConflict,
  rollOracle,
  rollPlace,
  rollTagWrinkle,
  seededRandom,
  tagPageToWikiUrl,
} from '../public/oracle.js'

const gallery = JSON.parse(readFileSync(new URL('../dist/wiki/gallery-index.json', import.meta.url), 'utf8'))
const gazetteer = JSON.parse(readFileSync(new URL('../dist/wiki/gazetteer-index.json', import.meta.url), 'utf8'))
const timeline = JSON.parse(readFileSync(new URL('../dist/wiki/timeline-index.json', import.meta.url), 'utf8'))
const tags = JSON.parse(readFileSync(new URL('../dist/wiki/tags-index.json', import.meta.url), 'utf8'))
const characters = gallery.entries
const places = gazetteer.entries
const events = timeline.events
const tagItems = tags.items
const indexes = { characters, places, events, tags: tagItems }

test('oracle source indexes hold 78 souls, 486 nations, 71 events, 1,069 tags', () => {
  assert.equal(characters.length, 78)
  assert.equal(places.length, 486)
  assert.equal(events.length, 71)
  assert.equal(tagItems.length, 1069)
  assert.ok(characters.some(entry => entry.name === 'Aelis'))
  assert.ok(places.some(entry => entry.name === 'Aeger' && isWikiUrl(entry.path)))
  assert.ok(events.every(entry => typeof entry.event === 'string' && entry.event.length > 0))
  assert.ok(tagItems.every(item => typeof item.tag === 'string' && Array.isArray(item.pages)))
  const dragons = tagItems.find(item => item.tag === 'dragons')
  assert.equal(dragons.pages[0].title, 'Dragonreach')
  assert.equal(tagPageToWikiUrl('World/Locations/Continents/Erisdar/Dragonreach.md'), '/wiki/World/Locations/Continents/Erisdar/Dragonreach/')
  assert.equal(tagPageToWikiUrl('World/Nations/Foo/index.md'), '/wiki/World/Nations/Foo/')
  assert.equal(tagPageToWikiUrl(''), null)
  assert.equal(tagPageToWikiUrl('../evil.md'), null)
})

test('seeded rolls are deterministic and every element comes from the indexes', () => {
  for (const mode of ORACLE_MODES) {
    const first = rollOracle(mode, indexes, seededRandom(4242))
    const second = rollOracle(mode, indexes, seededRandom(4242))
    assert.deepEqual(first, second)
  }
  const character = rollOracle('character', indexes, seededRandom(7))
  assert.ok(characters.includes(character.character))
  assert.ok(tagItems.some(item => item.tag === character.tag))
  const place = rollOracle('place', indexes, seededRandom(7))
  assert.ok(places.includes(place.place))
  const conflict = rollOracle('conflict', indexes, seededRandom(7))
  assert.ok(places.includes(conflict.sideA))
  assert.ok(places.includes(conflict.sideB))
  assert.notEqual(conflict.sideA, conflict.sideB)
  assert.ok(events.includes(conflict.event))
  assert.ok(tagItems.some(item => item.tag === conflict.tag))
  // Unknown modes fall back to character; empty pools stay null, never invented.
  assert.equal(rollOracle('nope', indexes, seededRandom(1)).mode, 'character')
  assert.equal(rollOracle('character', { characters: [], places, events, tags: tagItems }, seededRandom(1)).character, null)
  assert.equal(pickRandom([], seededRandom(1)), null)
  assert.equal(pickRandom(null, seededRandom(1)), null)
  assert.deepEqual(rollTagWrinkle([], seededRandom(1)), { tag: null, tagTitle: null, tagUrl: null })
  const wrinkle = rollTagWrinkle(tagItems, seededRandom(11))
  assert.ok(tagItems.some(item => item.tag === wrinkle.tag))
  assert.ok(wrinkle.tagUrl === null || isWikiUrl(wrinkle.tagUrl))
  assert.equal(rollCharacter(characters, tagItems, seededRandom(3)).character.name.length > 0, true)
  assert.equal(rollPlace(places, tagItems, seededRandom(3)).place.name.length > 0, true)
  assert.equal(rollConflict([places[0]], events, tagItems, seededRandom(3)).sideB, places[0])
})

test('result cards link only ^/wiki/ paths; hostile or empty paths render as text', () => {
  const html = renderOracleResult(rollOracle('conflict', indexes, seededRandom(99)))
  assert.match(html, /CONFLICT OMEN/)
  assert.match(html, /WRINKLE/)
  assert.match(renderOracleResult(rollOracle('character', indexes, seededRandom(99))), /CHARACTER OMEN/)
  assert.match(renderOracleResult(rollOracle('place', indexes, seededRandom(99))), /PLACE OMEN/)
  assert.match(renderOracleResult(null), /silent/)
  for (const entry of [
    { name: 'Nowhere' },
    { name: 'Nowhere Too', path: '' },
    { name: 'Evil', path: 'javascript:alert(1)' },
    { name: 'Offsite', path: 'https://evil.example/wiki/x' },
    { name: 'Sneaky', path: '/evil' },
  ]) {
    assert.doesNotMatch(renderOracleLink(entry.name, entry.path), /href="/, entry.name)
  }
  assert.match(renderOracleLink('/wiki/World/History/Characters/Aelis/', '/wiki/World/History/Characters/Aelis/'), /href="\/wiki\//)
  const hostile = renderOracleResult({ mode: 'character', character: { name: '<img src=x onerror=alert(1)>', path: 'https://evil.example/x' }, tag: '<script>', tagTitle: '<b>', tagUrl: 'javascript:alert(1)' })
  assert.doesNotMatch(hostile, /<img src=x/)
  assert.doesNotMatch(hostile, /<script>/)
  assert.doesNotMatch(hostile, /href="/)
  assert.match(hostile, /&lt;img/)
  assert.match(hostile, new RegExp(escapeHtml('#<script>')))
})

test('oracle gate: worker treats page and script as private', () => {
  assert.equal(__test.isPrivatePath('/oracle'), true)
  assert.equal(__test.isPrivatePath('/oracle/'), true)
  assert.equal(__test.isPrivatePath('/oracle.html'), true)
  assert.equal(__test.isPrivatePath('/oracle.js'), true)
  assert.equal(__test.isPrivatePath('/wiki/tags-index.json'), true)
})

test('oracle shell mounts three mode tabs, a result card, and a reroll; stays noindex', () => {
  const html = readFileSync(new URL('../public/oracle.html', import.meta.url), 'utf8')
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive" \/>/)
  assert.match(html, /id="tabCharacter"/)
  assert.match(html, /id="tabPlace"/)
  assert.match(html, /id="tabConflict"/)
  assert.match(html, /data-mode="character"/)
  assert.match(html, /data-mode="place"/)
  assert.match(html, /data-mode="conflict"/)
  assert.match(html, /id="oracleResult"/)
  assert.match(html, /id="oracleReroll"/)
  assert.match(html, /id="oracleStatus"/)
  assert.match(html, /id="oracleCount"/)
  assert.match(html, /src="\/oracle\.js"/)
  assert.match(html, /src="\/archive-compass\.js"/)
  const script = readFileSync(new URL('../public/oracle.js', import.meta.url), 'utf8')
  assert.match(script, /from '\.\/timeline\.js'/)
  assert.match(script, /isWikiUrl/)
  assert.match(script, /escapeHtml/)
  assert.match(script, /\/wiki\/gallery-index\.json/)
  assert.match(script, /\/wiki\/gazetteer-index\.json/)
  assert.match(script, /\/wiki\/timeline-index\.json/)
  assert.match(script, /\/wiki\/tags-index\.json/)
  const workerSource = readFileSync(new URL('../worker.js', import.meta.url), 'utf8')
  assert.match(workerSource, /\['\/oracle', '\/oracle\.html'\]/)
  assert.match(workerSource, /'\/oracle\.js'/)
  const compass = readFileSync(new URL('../public/archive-compass.js', import.meta.url), 'utf8')
  assert.match(compass, /url: '\/oracle'/)
})
