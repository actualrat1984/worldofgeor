import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')
const loadJson = (file) => JSON.parse(read(file))

// Wave H6 — canonical numbers, recomputed from the generator outputs on disk.
// Nations come from the gazetteer, characters from the gallery, ages/events
// from the timeline, species from the wiki index (same prefix the
// /api/world-stats endpoint counts). Continents are map canon. Nothing here
// is a hardcoded snapshot: if the vault grows, the surfaces must follow.
const gazetteer = loadJson('dist/wiki/gazetteer-index.json')
const gallery = loadJson('dist/wiki/gallery-index.json')
const timeline = loadJson('dist/wiki/timeline-index.json')
const wikiIndex = loadJson('dist/wiki-index.json')

const NATIONS = gazetteer.entries.length
const CHARACTERS = gallery.entries.length
const AGES = timeline.ages.length
const EVENTS = timeline.events.length
const SPECIES = wikiIndex.filter(
  (item) => typeof item?.url === 'string' && item.url.startsWith('/wiki/World/Species/'),
).length
const CONTINENTS = 17 // map canon

const index = read('index.html')
const dashboard = read('public/dashboard.html')
const atlas = read('public/atlas.html')

function heroChip(label) {
  const match = index.match(new RegExp(`<b class="text-gold">(\\d+)</b>\\s*${label}`))
  assert.ok(match, `hero chip ${label} is present`)
  return Number(match[1])
}

test('hero chips match the canonical nations, species, and continents counts', () => {
  assert.equal(heroChip('NATIONS'), NATIONS)
  assert.equal(heroChip('PEOPLES'), SPECIES)
  assert.equal(heroChip('CONTINENTS'), CONTINENTS)
})

test('archive strip data-counts match ages, events, nations, and characters', () => {
  const strip = (index.match(/<section id="archive-counts"[\s\S]*?<\/section>/) || [])[0]
  assert.ok(strip, 'landing keeps its #archive-counts strip')
  const pairs = [...strip.matchAll(/<span data-count="(\d+)">[^<]*<\/span>\s*<\/p>\s*<p[^>]*>([^<]+)<\/p>/g)]
    .map((match) => [match[2].trim(), Number(match[1])])
  assert.deepEqual(
    pairs,
    [['AGES', AGES], ['EVENTS', EVENTS], ['NATIONS', NATIONS], ['CHARACTERS', CHARACTERS]],
    'strip counts equal the recomputed canonicals',
  )
})

test('dashboard fallbacks show the canonical counts before hydration', () => {
  const fallback = (id) => {
    const match = dashboard.match(new RegExp(`<p id="${id}"[^>]*>([^<]+)</p>`))
    assert.ok(match, `dashboard fallback #${id} is present`)
    return Number(match[1])
  }
  assert.equal(fallback('statNations'), NATIONS)
  assert.equal(fallback('statSpecies'), SPECIES)
  assert.equal(fallback('statAges'), AGES)
})

test('atlas copy states the canonical nations count with honest wording', () => {
  assert.ok(atlas.includes(`${NATIONS} recorded nations`), 'atlas states the canonical nations count')
})

test('species prose lines match the canonical species count', () => {
  assert.ok(
    index.includes(`Browse ${SPECIES} sentient peoples by lineage, origin, and form.`),
    'landing bestiary prose states the canonical species count',
  )
  assert.ok(
    dashboard.includes(`${SPECIES} sentient peoples, filterable by lineage with direct wiki folios.`),
    'dashboard species prose states the canonical species count',
  )
})
