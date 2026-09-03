import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { __test } from '../worker.js'
import { escapeHtml, isWikiUrl } from '../public/timeline.js'
import {
  distinctValues,
  entryStatus,
  filterGallery,
  gallerySummary,
  renderGallery,
  renderGalleryCard,
} from '../public/gallery.js'

const data = JSON.parse(readFileSync(new URL('../dist/wiki/gallery-index.json', import.meta.url), 'utf8'))
const entries = data.entries

test('gallery index shape: 78 named entries scanned from 78 character files', () => {
  assert.equal(data.files_scanned, 78)
  assert.equal(entries.length, 78)
  assert.equal(new Set(entries.map(entry => entry.name)).size, 78)
  assert.ok(entries.every(entry => typeof entry.name === 'string' && entry.name.length > 0))
  assert.ok(entries.every(entry => entry.path === undefined || typeof entry.path === 'string'))
  assert.ok(entries.every(entry => !entry.path || isWikiUrl(entry.path)))
  assert.equal(entries.filter(entry => entry.path).length, 75)
  assert.equal(entries.filter(entry => entryStatus(entry) === 'historical').length, 7)
  assert.deepEqual(distinctValues(entries, 'house'), ['Eisenheart', 'Lulit', 'Mortvagn'])
  assert.equal(distinctValues(entries, 'species').length, 16)
  assert.deepEqual(distinctValues(entries, 'nation'), ['Grimmel Republic', 'Moonfang Dominion', 'Spasia'])
  // Spot-checks against the generator output.
  const aelis = entries.find(entry => entry.name === 'Aelis')
  assert.equal(aelis.species, 'Human')
  assert.equal(aelis.nation, 'Moonfang Dominion')
  const amelia = entries.find(entry => entry.name === 'Amelia')
  assert.equal(amelia.house, 'Lulit')
  assert.equal(amelia.nation, 'Grimmel Republic')
  const emrys = entries.find(entry => entry.name === 'Emrys')
  assert.equal(emrys.house, 'Eisenheart')
})

test('filters narrow by house, species, nation, status, and name search', () => {
  assert.equal(filterGallery(entries, {}).length, 78)
  assert.ok(filterGallery(entries, { house: 'Eisenheart' }).length > 0)
  assert.ok(filterGallery(entries, { house: 'Eisenheart' }).every(entry => entry.house === 'Eisenheart'))
  assert.ok(filterGallery(entries, { species: 'Human' }).every(entry => entry.species === 'Human'))
  assert.ok(filterGallery(entries, { nation: 'Grimmel Republic' }).every(entry => entry.nation === 'Grimmel Republic'))
  assert.equal(filterGallery(entries, { status: 'historical' }).length, 7)
  assert.equal(filterGallery(entries, { status: 'active' }).length, 71)
  assert.ok(filterGallery(entries, { status: 'active' }).every(entry => entryStatus(entry) === 'active'))
  const searched = filterGallery(entries, { query: 'aelis' })
  assert.equal(searched.length, 1)
  assert.equal(searched[0].name, 'Aelis')
  assert.equal(filterGallery(entries, { query: '  EM ' }).some(entry => entry.name === 'Emrys'), true)
  const combined = filterGallery(entries, { house: 'Eisenheart', species: 'Human', nation: 'Grimmel Republic', status: 'active', query: '' })
  assert.ok(combined.length > 0)
  assert.ok(combined.every(entry => entry.house === 'Eisenheart' && entry.species === 'Human'))
  assert.deepEqual(filterGallery(entries, { house: 'No Such House' }), [])
  assert.deepEqual(filterGallery([], { query: 'aelis' }), [])
  // Nameless rows never render; blank filters keep everything.
  assert.deepEqual(filterGallery([{ name: '' }, { name: '  ' }, null], {}), [])
  assert.equal(entryStatus({}), 'active')
  assert.equal(entryStatus({ status: 'historical' }), 'historical')
  assert.deepEqual(distinctValues([], 'house'), [])
})

test('cards carry initial-letter avatars and link only ^/wiki/ paths; hostile or empty paths render as text', () => {
  const html = renderGallery(entries)
  assert.match(html, /data-character="Aelis"/)
  assert.match(html, /href="\/wiki\//)
  assert.match(html, />A</)
  assert.equal(gallerySummary(entries), '78 characters · 3 houses')
  assert.equal(gallerySummary(filterGallery(entries, { house: 'Lulit' })).split('·')[1].trim(), '1 house')
  for (const entry of [
    { name: 'Nowhere' },
    { name: 'Nowhere Too', path: '' },
    { name: 'Evil', path: 'javascript:alert(1)' },
    { name: 'Offsite', path: 'https://evil.example/wiki/x' },
    { name: 'Sneaky', path: '/evil' },
  ]) {
    const card = renderGalleryCard(entry)
    assert.doesNotMatch(card, /href="/, entry.name)
    assert.match(card, new RegExp(escapeHtml(entry.name)))
  }
  const hostile = renderGalleryCard({ name: '<img src=x onerror=alert(1)>', path: 'https://evil.example/x' })
  assert.doesNotMatch(hostile, /<img src=x/)
  assert.doesNotMatch(hostile, /href="/)
  assert.match(hostile, /&lt;img/)
  assert.match(renderGallery([]), /No souls match/)
  assert.equal(isWikiUrl('/wiki/World/History/Characters/Aelis/'), true)
})

test('gallery gate: worker treats page and script as private', () => {
  assert.equal(__test.isPrivatePath('/gallery'), true)
  assert.equal(__test.isPrivatePath('/gallery/'), true)
  assert.equal(__test.isPrivatePath('/gallery.html'), true)
  assert.equal(__test.isPrivatePath('/gallery.js'), true)
  assert.equal(__test.isPrivatePath('/wiki/gallery-index.json'), true)
})

test('gallery shell fetches the gated index, mounts every filter, stays noindex', () => {
  const html = readFileSync(new URL('../public/gallery.html', import.meta.url), 'utf8')
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive" \/>/)
  assert.match(html, /id="houseFilter"/)
  assert.match(html, /id="speciesFilter"/)
  assert.match(html, /id="nationFilter"/)
  assert.match(html, /id="statusFilter"/)
  assert.match(html, /id="gallerySearch"/)
  assert.match(html, /id="galleryGrid"/)
  assert.match(html, /id="galleryStatus"/)
  assert.match(html, /id="galleryCount"/)
  assert.match(html, /src="\/gallery\.js"/)
  assert.match(html, /src="\/archive-compass\.js"/)
  const script = readFileSync(new URL('../public/gallery.js', import.meta.url), 'utf8')
  assert.match(script, /from '\.\/timeline\.js'/)
  assert.match(script, /isWikiUrl/)
  assert.match(script, /escapeHtml/)
  assert.match(script, /\/wiki\/gallery-index\.json/)
  const workerSource = readFileSync(new URL('../worker.js', import.meta.url), 'utf8')
  assert.match(workerSource, /\['\/gallery', '\/gallery\.html'\]/)
  assert.match(workerSource, /'\/gallery\.js'/)
  const compass = readFileSync(new URL('../public/archive-compass.js', import.meta.url), 'utf8')
  assert.match(compass, /url: '\/gallery'/)
})
