import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { __test } from '../worker.js'
import { escapeHtml, isWikiUrl } from '../public/timeline.js'
import {
  filterGazetteer,
  regionsOf,
  renderGazetteerRow,
  sortGazetteer,
} from '../public/gazetteer.js'

const data = JSON.parse(readFileSync(new URL('../dist/wiki/gazetteer-index.json', import.meta.url), 'utf8'))
const entries = data.entries

test('gazetteer index shape: 486 nations joined from Nations files by title match', () => {
  assert.equal(entries.length, 486)
  assert.equal(data.files_scanned, 487)
  assert.ok(entries.every(entry => typeof entry.name === 'string' && entry.name.length > 0))
  assert.ok(entries.every(entry => typeof entry.region === 'string' && typeof entry.path === 'string'))
  assert.ok(entries.every(entry => entry.path === '' || isWikiUrl(entry.path)))
  const withUrls = entries.filter(entry => entry.path !== '')
  assert.equal(withUrls.length, 262)
  assert.equal(regionsOf(entries).length, 34)
  const names = entries.map(entry => entry.name.toLowerCase())
  assert.deepEqual(names, [...names].sort(), 'entries ship pre-sorted by name')
  assert.ok(entries.filter(entry => entry.status).length >= 480, 'frontmatter status survives')
  assert.ok(entries.filter(entry => entry.tags).length >= 480, 'frontmatter tags survive')
})

test('sort helper orders Name/Region/Status both directions, unknown key falls back to name', () => {
  const fixture = [
    { name: 'Venner', region: 'South Erisdar', path: '/wiki/World/Nations/South Erisdar/Venner/', status: 'active' },
    { name: 'Aelefer', region: 'South Erisdar', path: '/wiki/World/Nations/South Erisdar/Aelefer/', status: 'city' },
    { name: 'Dissenbarg', region: 'Dissenbarg', path: '', status: 'active' },
  ]
  assert.deepEqual(sortGazetteer(fixture, 'name').map(entry => entry.name), ['Aelefer', 'Dissenbarg', 'Venner'])
  assert.deepEqual(sortGazetteer(fixture, 'name', 'desc').map(entry => entry.name), ['Venner', 'Dissenbarg', 'Aelefer'])
  assert.deepEqual(sortGazetteer(fixture, 'region').map(entry => entry.name), ['Dissenbarg', 'Aelefer', 'Venner'])
  assert.deepEqual(sortGazetteer(fixture, 'status').map(entry => entry.name), ['Dissenbarg', 'Venner', 'Aelefer'])
  assert.deepEqual(sortGazetteer(fixture, 'bogus').map(entry => entry.name), ['Aelefer', 'Dissenbarg', 'Venner'])
  assert.deepEqual(sortGazetteer([], 'name'), [])
})

test('filter helper matches text across fields and narrows by region exactly', () => {
  const fixture = [
    { name: 'Venner', region: 'South Erisdar', path: '/wiki/World/Nations/South Erisdar/Venner/', status: 'active' },
    { name: 'Aelefer', region: 'South Erisdar', path: '/wiki/World/Nations/South Erisdar/Aelefer/', status: 'city' },
    { name: 'Dissenbarg', region: 'Dissenbarg', path: '', status: 'active' },
  ]
  assert.equal(filterGazetteer(fixture, {}).length, 3)
  assert.deepEqual(filterGazetteer(fixture, { q: 'venner' }).map(entry => entry.name), ['Venner'])
  assert.equal(filterGazetteer(fixture, { q: 'south' }).length, 2)
  assert.equal(filterGazetteer(fixture, { q: 'CITY' }).length, 1)
  assert.equal(filterGazetteer(fixture, { region: 'Dissenbarg' }).length, 1)
  assert.equal(filterGazetteer(fixture, { region: 'South' }).length, 0)
  assert.equal(filterGazetteer(fixture, { q: 'active', region: 'Dissenbarg' }).length, 1)
  assert.deepEqual(regionsOf(fixture), ['Dissenbarg', 'South Erisdar'])
})

test('rendered rows link only ^/wiki/ paths; hostile or empty paths render as text', () => {
  const linked = renderGazetteerRow({ name: 'Aelefer', region: 'South Erisdar', path: '/wiki/World/Nations/South Erisdar/Aelefer/', status: 'city' })
  assert.match(linked, /href="\/wiki\/World\/Nations\/South Erisdar\/Aelefer\/"/)
  for (const entry of [
    { name: 'Nowhere', region: 'Nowhere', path: '', status: '' },
    { name: 'Evil', region: 'Nowhere', path: 'javascript:alert(1)', status: '' },
    { name: 'Offsite', region: 'Nowhere', path: 'https://evil.example/wiki/x', status: '' },
    { name: 'Sneaky', region: 'Nowhere', path: '/evil', status: '' },
  ]) {
    const html = renderGazetteerRow(entry)
    assert.doesNotMatch(html, /href="/, entry.name)
    assert.match(html, new RegExp(escapeHtml(entry.name)))
  }
  assert.equal(isWikiUrl('/wiki/World/Nations/South Erisdar/Aelefer/'), true)
  assert.equal(escapeHtml('<script>"&\'</script>'), '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;')
})

test('gazetteer gate: worker treats page and script as private', () => {
  assert.equal(__test.isPrivatePath('/gazetteer'), true)
  assert.equal(__test.isPrivatePath('/gazetteer/'), true)
  assert.equal(__test.isPrivatePath('/gazetteer.html'), true)
  assert.equal(__test.isPrivatePath('/gazetteer.js'), true)
  assert.equal(__test.isPrivatePath('/wiki/gazetteer-index.json'), true)
})

test('gazetteer shell fetches the gated index, mounts sort/filter/region controls, stays noindex', () => {
  const html = readFileSync(new URL('../public/gazetteer.html', import.meta.url), 'utf8')
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive" \/>/)
  assert.match(html, /id="gazetteerSections"/)
  assert.match(html, /id="gazetteerFilter"/)
  assert.match(html, /id="regionFilter"/)
  assert.match(html, /data-sort="name"/)
  assert.match(html, /src="\/gazetteer\.js"/)
  assert.match(html, /src="\/archive-compass\.js"/)
  const script = readFileSync(new URL('../public/gazetteer.js', import.meta.url), 'utf8')
  assert.match(script, /from '\.\/timeline\.js'/)
  assert.match(script, /isWikiUrl/)
  assert.match(script, /escapeHtml/)
  assert.match(script, /\/wiki\/gazetteer-index\.json/)
  const workerSource = readFileSync(new URL('../worker.js', import.meta.url), 'utf8')
  assert.match(workerSource, /\['\/gazetteer', '\/gazetteer\.html'\]/)
  assert.match(workerSource, /'\/gazetteer\.js'/)
  const compass = readFileSync(new URL('../public/archive-compass.js', import.meta.url), 'utf8')
  assert.match(compass, /url: '\/gazetteer'/)
})
