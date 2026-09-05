import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { escapeHtml, isWikiUrl } from '../public/timeline.js'
import {
  entriesInRegion,
  filterGazetteer,
  findGazetteerEntry,
  regionCounts,
  regionsOf,
  renderBreadcrumbs,
  renderEntryDetail,
  renderGazetteerRow,
  renderRegionIndex,
  sortGazetteer,
} from '../public/gazetteer.js'

const data = JSON.parse(readFileSync(new URL('../dist/wiki/gazetteer-index.json', import.meta.url), 'utf8'))
const entries = data.entries

test('region counts come from live data and sum to the entry total', () => {
  const counts = regionCounts(entries)
  const ungrouped = entries.filter(entry => !(typeof entry?.region === 'string' && entry.region.trim()))
  assert.equal(counts.reduce((sum, { count }) => sum + count, 0) + ungrouped.length, entries.length)
  assert.equal(ungrouped.length, 7, 'region-less folios (the region pages themselves) stay visible, never forced into a region')
  assert.deepEqual(counts.map(({ region }) => region), regionsOf(entries))
  assert.deepEqual(counts, [...counts].sort((a, b) => a.region.localeCompare(b.region)))
  for (const { region, count } of counts) {
    assert.equal(entriesInRegion(entries, region).length, count)
  }
  const central = counts.find(({ region }) => region === 'Central Erisdar')
  assert.ok(central && central.count > 0)
  assert.equal(entries.filter(entry => entry.region === 'Central Erisdar').length, central.count)
})

test('no invented parents: entries carry no hierarchy links, nesting is region grouping only', () => {
  assert.ok(entries.every(entry => entry.parent === undefined && entry.children === undefined))
  assert.deepEqual(Object.keys(entries[0]).sort(), ['name', 'path', 'region', 'status', 'tags'])
  const index = renderRegionIndex(regionCounts(entries))
  assert.doesNotMatch(index, /href="/)
  assert.match(index, /data-region="Central Erisdar"/)
})

test('crumbs link backwards: region view roots home, entry view chains both ancestors', () => {
  const top = renderBreadcrumbs({ view: 'regions' })
  assert.match(top, /aria-current="page">All regions</)
  assert.doesNotMatch(top, /data-crumb/)
  const region = renderBreadcrumbs({ view: 'region', region: 'Central Erisdar' })
  assert.match(region, /<a href="#" data-crumb="regions">All regions<\/a>/)
  assert.match(region, /aria-current="page">Central Erisdar</)
  const linked = entries.find(entry => entry.path !== '' && isWikiUrl(entry.path))
  assert.ok(linked, 'live index holds a wiki-linked entry for the crumb test')
  const entryCrumbs = renderBreadcrumbs({ view: 'entry', region: linked.region, entry: linked })
  assert.match(entryCrumbs, /data-crumb="regions"/)
  assert.match(entryCrumbs, new RegExp(`data-crumb="region" data-region="${escapeHtml(linked.region)}"`))
  assert.match(entryCrumbs, new RegExp(`<a href="${escapeHtml(linked.path)}">${escapeHtml(linked.name)}</a>`))
  const plain = renderBreadcrumbs({ view: 'entry', region: 'Central Erisdar', entry: findGazetteerEntry(entries, 'Aaros') })
  assert.match(plain, /aria-current="page">Aaros</)
  const hrefs = [...plain.matchAll(/href="([^"]*)"/g)].map(match => match[1])
  assert.ok(hrefs.every(href => href === '#' || isWikiUrl(href)), 'crumbs never invent URLs')
})

test('unknown regions and entries render honest empty states', () => {
  assert.deepEqual(entriesInRegion(entries, 'No Such Region'), [])
  assert.deepEqual(entriesInRegion(entries, ''), [])
  assert.equal(findGazetteerEntry(entries, 'No Such Nation'), undefined)
  assert.equal(findGazetteerEntry(entries, ''), undefined)
  const crumbs = renderBreadcrumbs({ view: 'region', region: 'No Such Region' })
  assert.match(crumbs, /No Such Region/)
  assert.match(renderEntryDetail(undefined), /No such entry/)
  assert.match(renderEntryDetail({ name: '' }), /No such entry/)
  assert.match(renderRegionIndex([], { q: 'zzz-no-match' }), /No regions match/)
  assert.match(renderRegionIndex(regionCounts(entries), { q: 'zzz-no-match' }), /No regions match/)
})

test('entry detail: region, status, escaped tag chips, subdivision badge, gated folio link', () => {
  const aaros = findGazetteerEntry(entries, 'Aaros')
  assert.equal(aaros.region, 'Central Erisdar')
  const detail = renderEntryDetail(aaros)
  assert.match(detail, /Central Erisdar/)
  assert.match(detail, /active/)
  assert.match(detail, />subdivision</)
  assert.match(detail, /erisian-empire/)
  assert.doesNotMatch(detail, /href="/, 'Aaros has no wiki path so no folio link is invented')
  const linked = entries.find(entry => entry.path !== '' && isWikiUrl(entry.path))
  assert.match(renderEntryDetail(linked), new RegExp(`href="${escapeHtml(linked.path)}"`))
  const hostile = renderEntryDetail({ name: '<script>"&\'</script>', region: '<b>', status: '<i>', path: 'javascript:alert(1)', tags: ['<img src=x>', 'subdivision'] })
  assert.doesNotMatch(hostile, /<script>/)
  assert.doesNotMatch(hostile, /href="/)
  assert.match(hostile, new RegExp(escapeHtml('<script>"&\'')))
  assert.match(hostile, />subdivision</)
  const plain = renderEntryDetail({ name: 'Lonely', region: 'Nowhere', status: '', path: '', tags: ['free'] })
  assert.doesNotMatch(plain, />subdivision</)
  assert.match(plain, /free/)
})

test('hostile region and entry names escape everywhere and invent no links', () => {
  const evil = '<script>"&\'</script>'
  const crumbs = renderBreadcrumbs({ view: 'entry', region: evil, entry: { name: evil, region: evil, path: 'https://evil.example/wiki/x', status: '' } })
  assert.doesNotMatch(crumbs, /<script>/)
  assert.doesNotMatch(crumbs, /evil\.example/)
  assert.match(crumbs, new RegExp(escapeHtml(evil)))
  const index = renderRegionIndex([{ region: evil, count: 1 }])
  assert.doesNotMatch(index, /<script>/)
  assert.doesNotMatch(index, /href="/)
  const row = renderGazetteerRow({ name: evil, region: evil, path: '/evil', status: evil })
  assert.doesNotMatch(row, /href="/)
  assert.doesNotMatch(row, /<script>/)
  assert.match(row, new RegExp(escapeHtml(evil)))
})

test('existing sort/filter helpers still serve the nested views', () => {
  const central = sortGazetteer(entriesInRegion(entries, 'Central Erisdar'), 'name')
  assert.ok(central.length > 0 && central.every(entry => entry.region === 'Central Erisdar'))
  assert.equal(filterGazetteer(central, { q: 'aar' }).length >= 1, true)
  assert.equal(filterGazetteer(entries, { region: 'Central' }).length, 0, 'region match stays exact')
})

test('gazetteer shell mounts crumbs, region index, and entry detail without touching the gate', () => {
  const html = readFileSync(new URL('../public/gazetteer.html', import.meta.url), 'utf8')
  assert.match(html, /id="gazetteerCrumbs"/)
  assert.match(html, /id="regionIndex"/)
  assert.match(html, /id="entryDetail"/)
  assert.match(html, /id="gazetteerSections"/)
  assert.match(html, /id="regionFilter"/)
  const script = readFileSync(new URL('../public/gazetteer.js', import.meta.url), 'utf8')
  assert.match(script, /regionCounts/)
  assert.match(script, /renderBreadcrumbs/)
  assert.match(script, /renderEntryDetail/)
  assert.match(script, /renderRegionIndex/)
  assert.match(script, /entriesInRegion/)
  assert.match(script, /findGazetteerEntry/)
})
