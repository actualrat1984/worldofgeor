// Ge'orian world clock (Wave H23) — live in-world time, pure math first.
// Canon (World/Dates/Ge'orian Calendar.md): 1 Ge'or day = 26 hours,
// 1 month = 40 NUMBERED days (months are never named), 1 year =
// 12 months = 480 days, present = 597 AGD.
// Pure helpers are exported so node --test can verify the math without
// a browser. Browser rendering only runs when `document` exists.
//
// TICK-RATE MATH (documented, not assumed): the canon 26 hours ARE Earth
// hours — one Ge'or day lasts 26 Earth hours = 1.0833… Earth days. So:
//   GEOR_HOUR_MS   = 3,600,000 (one Ge'or hour IS one Earth hour)
//   GEOR_DAY_MS    = 26 * 3,600,000 = 93,600,000
//   GEOR_MONTH_MS  = 40 * GEOR_DAY_MS = 3,744,000,000
//   GEOR_YEAR_MS   = 480 * GEOR_DAY_MS = 44,928,000,000
//   GEOR_MINUTE_MS = 60,000 (one Ge'or minute IS one Earth minute)
// The clock therefore ticks 1:1 with Earth time; only the date frame
// (26h days, 40-day numbered months, 480-day years) differs.
//
// ANCHOR (SITE CONVENTION, NOT CANON): the vault names no epoch moment,
// so the site pins 597 AGD · Month 1 · Day 1 · 00:00 to 2026-01-01T00:00Z
// purely as a display convention. Mikhail can re-anchor at any time; the
// UI labels this every render. Never present the anchor as canon.
import { formatNotation } from './calendar.js'

export const GEOR_HOURS_PER_DAY = 26
export const GEOR_DAYS_PER_MONTH = 40
export const GEOR_MONTHS_PER_YEAR = 12
export const GEOR_DAYS_PER_YEAR = 480

export const GEOR_MINUTE_MS = 60 * 1000
export const GEOR_HOUR_MS = 60 * GEOR_MINUTE_MS
export const GEOR_DAY_MS = GEOR_HOURS_PER_DAY * GEOR_HOUR_MS
export const GEOR_MONTH_MS = GEOR_DAYS_PER_MONTH * GEOR_DAY_MS
export const GEOR_YEAR_MS = GEOR_DAYS_PER_YEAR * GEOR_DAY_MS

// Minutes per structural unit (integers — no float drift at boundaries).
export const GEOR_MINUTES_PER_HOUR = 60
export const GEOR_MINUTES_PER_DAY = GEOR_HOURS_PER_DAY * GEOR_MINUTES_PER_HOUR
export const GEOR_MINUTES_PER_MONTH = GEOR_DAYS_PER_MONTH * GEOR_MINUTES_PER_DAY
export const GEOR_MINUTES_PER_YEAR = GEOR_DAYS_PER_YEAR * GEOR_MINUTES_PER_DAY

// SITE CONVENTION — re-anchorable, NOT canon (see note above).
export const ANCHOR = {
  earthMs: Date.UTC(2026, 0, 1),
  geor: { year: 597, month: 1, day: 1, hour: 0, minute: 0 },
}

// Absolute Ge'or minutes from the start of 1 AGD to the anchor: the anchor
// is year 597 month 1 day 1 hour 0, so (597 - 1) whole 480-day years elapse
// before it. Pre-1-AGD math goes negative into Year 0 (a full 480-day year
// at scalar 0) and then BGD scalars, reusing calendar.js era converters.
const ANCHOR_ABS_MINUTES = (ANCHOR.geor.year - 1) * GEOR_MINUTES_PER_YEAR

// Earth moment -> Ge'or date. Takes the Earth ms as a parameter (defaulting
// to now) so tests pass explicit moments instead of mocking Date.
export function georNow(earthMs = Date.now()) {
  const elapsedMinutes = Math.floor((Number(earthMs) - ANCHOR.earthMs) / GEOR_MINUTE_MS)
  const total = ANCHOR_ABS_MINUTES + elapsedMinutes
  const scalarYear = Math.floor(total / GEOR_MINUTES_PER_YEAR) + 1
  let rest = total - (scalarYear - 1) * GEOR_MINUTES_PER_YEAR
  const month = Math.floor(rest / GEOR_MINUTES_PER_MONTH) + 1
  rest -= (month - 1) * GEOR_MINUTES_PER_MONTH
  const day = Math.floor(rest / GEOR_MINUTES_PER_DAY) + 1
  rest -= (day - 1) * GEOR_MINUTES_PER_DAY
  const hour = Math.floor(rest / GEOR_MINUTES_PER_HOUR)
  const minute = rest - hour * GEOR_MINUTES_PER_HOUR
  return { year: scalarYear, month, day, hour, minute }
}

// State -> `597 AGD · Month 3 · Day 12 · 14:05`. Months are NUMBERED, never
// named. BGD/Year 0 labels come from the shared calendar.js converter.
export function formatClock(state) {
  const era = formatNotation(state.year)
  const clock = `${state.hour}:${String(state.minute).padStart(2, '0')}`
  return `${era} · Month ${state.month} · Day ${state.day} · ${clock}`
}

export const ANCHOR_TOOLTIP = 'Site convention — Mikhail can re-anchor this clock; the anchor is not canon.'

// --- Browser widget (never runs under node --test) -------------------------
// Passive one-line readout: 1s tick, paused while the tab is hidden, zero
// interaction, never blocks. Only paints when #worldClock exists.
function paintClock(node) {
  try {
    node.textContent = formatClock(georNow())
  } catch {
    node.textContent = 'The world clock could not be reckoned'
  }
}

function initWorldClock() {
  const node = document.getElementById('worldClock')
  if (!node) return
  node.setAttribute('title', ANCHOR_TOOLTIP)
  let timer = null
  const start = () => {
    if (timer !== null) return
    paintClock(node)
    timer = setInterval(() => paintClock(node), 1000)
  }
  const stop = () => {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop()
    else start()
  })
  start()
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initWorldClock)
  else initWorldClock()
}
