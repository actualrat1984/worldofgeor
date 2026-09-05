import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { __test } from '../worker.js'
import {
  barChart,
  chartDataFromStats,
  escapeHtml,
  renderAdminCharts,
  scaleMax,
} from '../public/admin-charts.js'

test('scaleMax returns the largest finite non-negative value', () => {
  assert.equal(scaleMax([3, 7, 2]), 7)
  assert.equal(scaleMax([0, 0]), 0)
  assert.equal(scaleMax([]), 0)
  assert.equal(scaleMax(null), 0)
  assert.equal(scaleMax(['4', 9, 'nope', -12, NaN]), 9)
})

test('escapeHtml neutralizes markup in chart labels', () => {
  assert.equal(escapeHtml('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;')
})

test('barChart scales every bar against the max value', () => {
  const svg = barChart([{ label: 'A', value: 10 }, { label: 'B', value: 5 }])
  assert.match(svg, /^<svg[\s>]/)
  assert.ok(svg.includes('width="100%"'), 'max bar fills the track')
  assert.ok(svg.includes('width="50%"'), 'half value renders half width')
  assert.ok(svg.includes('role="img"'), 'chart exposes an accessible role')
})

test('barChart escapes every label and never emits raw markup', () => {
  const evil = '<script>alert("x")</script>'
  const svg = barChart([{ label: evil, value: 3 }])
  assert.ok(!svg.includes('<script>'), 'no raw tag survives')
  assert.ok(svg.includes('&lt;script&gt;'), 'label is entity-escaped')
})

test('barChart stays valid on empty or zeroed data', () => {
  assert.match(barChart([]), /No data/)
  assert.match(barChart([{ label: 'Members', value: 0 }]), /width="0%"/
  )
})

test('renderAdminCharts maps the four live admin stats', () => {
  const box = { innerHTML: '' }
  const stats = { users: 7, openInvites: 2, pendingRequests: 1, additions: 9 }
  assert.deepEqual(chartDataFromStats(stats).map(row => row.label), ['Members', 'Open invites', 'Pending requests', 'Archive events'])
  const svg = renderAdminCharts(box, stats)
  assert.match(svg, /^<svg[\s>]/)
  assert.equal(box.innerHTML, svg)
  for (const label of ['Members', 'Open invites', 'Pending requests', 'Archive events']) {
    assert.ok(svg.includes(label), `chart labels ${label}`)
  }
})

test('admin page paints charts under the stat cards with a graceful error state', () => {
  const html = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8')
  assert.match(html, /id="statCharts"/)
  assert.match(html, /import\('\/admin-charts\.js'\)/)
  assert.match(html, /Charts unavailable/)
})

test('worker gates /admin-charts.js as a private asset', () => {
  assert.equal(__test.isPrivatePath('/admin-charts.js'), true)
  const workerSource = readFileSync(new URL('../worker.js', import.meta.url), 'utf8')
  assert.match(workerSource, /'\/admin-charts\.js'/)
})

test('landing counters equal the real on-disk index counts', () => {
  const timeline = JSON.parse(readFileSync(new URL('../dist/wiki/timeline-index.json', import.meta.url), 'utf8'))
  const gazetteer = JSON.parse(readFileSync(new URL('../dist/wiki/gazetteer-index.json', import.meta.url), 'utf8'))
  const gallery = JSON.parse(readFileSync(new URL('../dist/wiki/gallery-index.json', import.meta.url), 'utf8'))
  const expected = new Map([
    ['AGES', timeline.ages.length],
    ['EVENTS', timeline.events.length],
    ['NATIONS', gazetteer.entries.length],
    ['CHARACTERS', gallery.entries.length],
  ])
  assert.equal(expected.get('AGES'), 13)
  assert.equal(expected.get('EVENTS'), 71)
  assert.equal(expected.get('NATIONS'), 486)
  assert.equal(expected.get('CHARACTERS'), 78)
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(html, /id="archive-counts"/)
  for (const [label, count] of expected) {
    assert.ok(html.includes(`data-count="${count}"`), `${label} counter matches disk (${count})`)
  }
})
