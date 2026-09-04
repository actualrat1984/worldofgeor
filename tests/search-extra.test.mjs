import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { escapeHtml, isExtraUrl, kindBadge, mergeExtra, scoreExtra } from '../public/search-sources.js'

const extra = JSON.parse(readFileSync(new URL('../dist/wiki/search-extra-index.json', import.meta.url), 'utf8'))
const atlasHtml = readFileSync(new URL('../public/atlas.html', import.meta.url), 'utf8')

test('generator output shape: pins>25, events=71, exact row shape', () => {
  assert.ok(Array.isArray(extra))
  const pins = extra.filter(row => row.kind === 'pin')
  const events = extra.filter(row => row.kind === 'event')
  assert.ok(pins.length > 25, `expected >25 pins, got ${pins.length}`)
  assert.equal(events.length, 71)
  for (const row of extra) {
    assert.deepEqual(Object.keys(row).sort(), row.kind === 'event' ? ['date', 'detail', 'kind', 'title', 'url'] : ['detail', 'kind', 'title', 'url'])
    assert.ok(row.title.length > 0 && row.detail.length > 0)
  }
})

test('no invented urls: every pin url exists in atlas.html, every event url is /timeline', () => {
  for (const row of extra.filter(row => row.kind === 'pin')) {
    assert.ok(row.url.startsWith('/wiki/'))
    assert.ok(atlasHtml.includes(`url:'${row.url}'`), `pin url not in atlas.html: ${row.url}`)
  }
  for (const row of extra.filter(row => row.kind === 'event')) {
    assert.equal(row.url, '/timeline')
    assert.ok(!row.title.includes('[[') && !row.title.includes(']]'), 'wikilink markup stripped')
  }
  assert.ok(!extra.some(row => row.title.includes('[[')))
})

test('merge scoring: matching rows score high and sort first, misses drop out', () => {
  const rows = mergeExtra([], extra, 'grimmel')
  assert.ok(rows.length > 0)
  assert.ok(rows.every(row => row.score >= 0))
  assert.ok(rows.slice(1).every((row, i) => rows[i].score >= row.score), 'sorted desc')
  assert.ok(rows.some(row => row.kind === 'pin' && row.title === 'Grimmel Peninsula'))
  assert.deepEqual(mergeExtra([], extra, 'zzzqqq'), [])
  assert.deepEqual(mergeExtra([], extra, 'x'), [])
  assert.deepEqual(mergeExtra([], [], 'grimmel'), [])
  // Pins duplicating a wiki index URL are dropped so merged results never repeat.
  const dupes = mergeExtra([{ title: 'Grimmel Peninsula', url: '/wiki/World/Nations/South Erisdar/Grimmel Peninsula/' }], extra, 'grimmel')
  assert.ok(!dupes.some(row => row.url === '/wiki/World/Nations/South Erisdar/Grimmel Peninsula/'))
})

test('hostile input: urls gated, titles escaped', () => {
  const hostile = [
    { kind: 'pin', title: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)', detail: 'x' },
    { kind: 'event', title: 'Nice', url: 'https://evil.example/', detail: 'x', date: '1 AGD' },
    { kind: 'pin', title: '<script>alert("pwn")</script>', url: '/wiki/World/X/', detail: '<b>bold</b>' },
  ]
  const rows = mergeExtra([], hostile, 'alert')
  assert.ok(rows.every(row => isExtraUrl(row.url, row.kind)), 'non-wiki/non-timeline urls dropped')
  assert.equal(escapeHtml(hostile[2].title), '&lt;script&gt;alert(&quot;pwn&quot;)&lt;/script&gt;')
  assert.equal(escapeHtml(hostile[2].detail), '&lt;b&gt;bold&lt;/b&gt;')
  assert.equal(scoreExtra(null, 'x'), -1)
})

test('kind badges', () => {
  assert.equal(kindBadge('pin'), 'PIN')
  assert.equal(kindBadge('event'), 'EVENT')
  assert.equal(kindBadge('wiki'), '')
  assert.equal(kindBadge(undefined), '')
})
