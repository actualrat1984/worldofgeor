import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  assignAgeIndex,
  buildTitleLookup,
  dateToScalar,
  escapeHtml,
  groupEventsByAge,
  isWikiUrl,
  rangeToBounds,
  renderEventText,
  resolveWikiUrl,
} from '../public/timeline.js'

const data = JSON.parse(readFileSync(new URL('../dist/wiki/timeline-index.json', import.meta.url), 'utf8'))
const wikiIndex = JSON.parse(readFileSync(new URL('../public/wiki-index.json', import.meta.url), 'utf8'))
const lookup = buildTitleLookup(wikiIndex)

test('timeline index shape: 13 ages, 71 events, 4 shadow phases over BGD/AGD', () => {
  assert.equal(data.ages.length, 13)
  assert.equal(data.events.length, 71)
  assert.equal(data.shadow_plan_phases.length, 4)
  assert.deepEqual(data.events[0], { era: 'BGD', date: '~15,000 BGD', event: data.events[0].event })
  assert.ok(data.events.every(event => typeof event.date === 'string' && typeof event.event === 'string'))
  assert.deepEqual(new Set(data.events.map(event => event.era)), new Set(['BGD', 'Year 0', 'AGD']))
})

test('every event lands in exactly one age; Age 12 keeps an honest empty note', () => {
  const { perAge, unassigned } = groupEventsByAge(data)
  assert.equal(perAge.length, 13)
  assert.deepEqual(unassigned, [])
  assert.equal(perAge.flat().length, 71)
  assert.equal(perAge[0].length > 0, true)
  assert.equal(perAge[11].length > 0, true)
  assert.deepEqual(perAge[12], [])
  assert.equal(assignAgeIndex({ date: '~15,000 BGD' }, data.ages), 0)
  assert.equal(assignAgeIndex({ date: '**Year 0**' }, data.ages), 11)
  assert.equal(assignAgeIndex({ date: 'Pre-Year 0' }, data.ages), 10)
  assert.equal(assignAgeIndex({ date: '597 AGD' }, data.ages), 11)
  assert.equal(assignAgeIndex({ date: 'nonsense' }, []), -1)
})

test('all [[wikilink]] names in the index resolve to ^/wiki/ article URLs', () => {
  const names = new Set()
  for (const event of data.events) {
    for (const part of String(event.event).split('[[').slice(1)) {
      const closeAt = part.indexOf(']]')
      names.add((closeAt >= 0 ? part.slice(0, closeAt) : part).replace(/^\*+/, '').trim())
    }
  }
  assert.equal(names.size, 10)
  for (const name of names) {
    const url = resolveWikiUrl(name, lookup)
    assert.ok(url && isWikiUrl(url), `${name} -> ${url}`)
  }
})

test('rendered event links always carry ^/wiki/ hrefs; hostile targets never render', () => {
  for (const event of data.events) {
    const html = renderEventText(event.event, lookup)
    for (const match of html.matchAll(/href="([^"]*)"/g)) {
      assert.match(match[1], /^\/wiki\//, event.event.slice(0, 60))
    }
    assert.doesNotMatch(html, /\[\[/)
  }
  assert.equal(isWikiUrl('/wiki/World/Dates/'), true)
  for (const bad of ['javascript:alert(1)', 'https://evil.example/wiki/x', '/evil', '', null, undefined, 42]) {
    assert.equal(isWikiUrl(bad), false, String(bad))
  }
  const hostile = new Map([['evil', 'javascript:alert(1)'], ['offsite', 'https://evil.example/']])
  assert.equal(renderEventText('See [[evil]] and [[offsite]] now', hostile), 'See evil and offsite now')
  assert.equal(resolveWikiUrl('anything', hostile), null)
  assert.equal(escapeHtml('<script>"&\'</script>'), '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;')
  assert.match(renderEventText('**Year 0** dawns', lookup), /<strong>Year 0<\/strong>/)
})

test('timeline shell fetches the gated indexes, mounts the era rail, stays noindex', () => {
  const html = readFileSync(new URL('../public/timeline.html', import.meta.url), 'utf8')
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive" \/>/)
  assert.match(html, /id="eraRail"/)
  assert.match(html, /id="timelineSections"/)
  assert.match(html, /id="shadowStrip"/)
  assert.match(html, /src="\/timeline\.js"/)
  assert.match(html, /src="\/archive-compass\.js"/)
  const script = readFileSync(new URL('../public/timeline.js', import.meta.url), 'utf8')
  assert.match(script, /\/wiki\/timeline-index\.json/)
  const compass = readFileSync(new URL('../public/archive-compass.js', import.meta.url), 'utf8')
  assert.match(compass, /url: '\/timeline'/)
})
