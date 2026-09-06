// H23 world clock — canon math, labeled convention anchor. Explicit Earth-ms
// parameters throughout: no Date mocking, no fetch, no new endpoints.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ANCHOR,
  ANCHOR_TOOLTIP,
  GEOR_DAY_MS,
  GEOR_DAYS_PER_MONTH,
  GEOR_HOUR_MS,
  GEOR_HOURS_PER_DAY,
  GEOR_MINUTE_MS,
  GEOR_MONTH_MS,
  GEOR_MONTHS_PER_YEAR,
  GEOR_YEAR_MS,
  formatClock,
  georNow,
} from '../public/world-clock.js'

const at = ms => georNow(ms)
const after = ms => at(ANCHOR.earthMs + ms)
const before = ms => at(ANCHOR.earthMs - ms)

test('canon constants: 26-hour day, 40-day numbered months, 12-month year', () => {
  assert.equal(GEOR_HOURS_PER_DAY, 26)
  assert.equal(GEOR_DAYS_PER_MONTH, 40)
  assert.equal(GEOR_MONTHS_PER_YEAR, 12)
})

// Tick-rate math, documented: the canon 26 hours ARE Earth hours (one Ge'or
// day = 26 Earth hours = 1.0833… Earth days), so one Ge'or hour/minute IS one
// Earth hour/minute and the clock ticks 1:1 with Earth time.
test('tick-rate math: Geor hour = Earth hour, day = 26 Earth hours', () => {
  assert.equal(GEOR_MINUTE_MS, 60 * 1000)
  assert.equal(GEOR_HOUR_MS, 3_600_000)
  assert.equal(GEOR_DAY_MS, 26 * 3_600_000)
  assert.equal(GEOR_MONTH_MS, 40 * GEOR_DAY_MS)
  assert.equal(GEOR_YEAR_MS, 480 * GEOR_DAY_MS)
  assert.equal(GEOR_DAY_MS, 93_600_000)
  assert.equal(GEOR_YEAR_MS, 44_928_000_000)
  const hourLater = after(GEOR_HOUR_MS)
  assert.equal(hourLater.hour, 1)
  assert.equal(hourLater.minute, 0)
})

test('anchor is exact: 597 AGD month 1 day 1 hour 0 minute 0', () => {
  assert.deepEqual(at(ANCHOR.earthMs), { year: 597, month: 1, day: 1, hour: 0, minute: 0 })
  assert.equal(ANCHOR.earthMs, Date.UTC(2026, 0, 1))
  assert.equal(formatClock(at(ANCHOR.earthMs)), '597 AGD · Month 1 · Day 1 · 0:00')
})

test('rollover: day 40 -> month+1, never a day 41', () => {
  assert.deepEqual([after(39 * GEOR_DAY_MS).month, after(39 * GEOR_DAY_MS).day], [1, 40])
  assert.deepEqual(
    ((s) => [s.month, s.day, s.hour])(after(40 * GEOR_DAY_MS)),
    [2, 1, 0],
  )
})

test('rollover: month 12 day 40 -> year+1 month 1 day 1', () => {
  const last = after(479 * GEOR_DAY_MS)
  assert.deepEqual([last.year, last.month, last.day], [597, 12, 40])
  assert.deepEqual(
    ((s) => [s.year, s.month, s.day, s.hour])(after(480 * GEOR_DAY_MS)),
    [598, 1, 1, 0],
  )
})

test('rollover: hour 26 -> day+1, never an hour 26', () => {
  const late = after(25 * GEOR_HOUR_MS)
  assert.deepEqual([late.day, late.hour], [1, 25])
  assert.deepEqual(
    ((s) => [s.day, s.hour, s.minute])(after(26 * GEOR_HOUR_MS)),
    [2, 0, 0],
  )
})

test('BGD negative path: before the anchor the era flips via signed years', () => {
  const yearZero = before(596 * GEOR_YEAR_MS + GEOR_DAY_MS)
  assert.equal(yearZero.year, 0)
  assert.match(formatClock(yearZero), /^Year 0 · /)
  const bgd = before(597 * GEOR_YEAR_MS + GEOR_MINUTE_MS)
  assert.equal(bgd.year, -1)
  assert.deepEqual([bgd.month, bgd.day, bgd.hour, bgd.minute], [12, 40, 25, 59])
  assert.match(formatClock(bgd), /^1 BGD · Month 12 · Day 40 · 25:59$/)
})

test('format is exact copy: era, numbered month, day, zero-padded clock', () => {
  assert.equal(
    formatClock({ year: 597, month: 3, day: 12, hour: 14, minute: 5 }),
    '597 AGD · Month 3 · Day 12 · 14:05',
  )
})

test('months are never named: no month-name letters anywhere in clock output', () => {
  const names = /(january|february|march|april|may|june|july|august|september|october|november|december)/i
  for (const moment of [0, 39, 40, 479, 480].map(d => ANCHOR.earthMs + d * GEOR_DAY_MS)) {
    assert.doesNotMatch(formatClock(at(moment)), names)
  }
  const monthToken = formatClock(at(ANCHOR.earthMs + 2 * GEOR_MONTH_MS)).match(/Month (\S+)/)[1]
  assert.match(monthToken, /^\d+$/)
})

test('anchor is labeled a re-anchorable site convention, never canon', () => {
  const source = readFileSync(new URL('../public/world-clock.js', import.meta.url), 'utf8')
  assert.match(source, /SITE CONVENTION/)
  assert.match(source, /NOT canon/i)
  assert.match(source, /re-anchor/i)
  assert.match(ANCHOR_TOOLTIP, /re-anchor/i)
  assert.match(ANCHOR_TOOLTIP, /not canon/i)
  const dash = readFileSync(new URL('../public/dashboard.html', import.meta.url), 'utf8')
  assert.match(dash, /id="worldClock"/)
  assert.match(dash, /site convention/i)
  assert.match(dash, /re-anchor/i)
})

test('no fetch, no new endpoints, no routes: pure local math + one passive node', () => {
  const source = readFileSync(new URL('../public/world-clock.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /fetch\s*\(/)
  assert.doesNotMatch(source, /XMLHttpRequest/)
  assert.doesNotMatch(source, /\/api\//)
})
