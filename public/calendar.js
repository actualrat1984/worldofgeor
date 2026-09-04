// Ge'orian Calendar (Wave G1) — month grid, festival list, and the
// BGD/AGD converter. Pure helpers are exported so node --test can verify
// era math, validation, and the ^/wiki/ link gate without a browser.
// Browser rendering only runs when `document` exists.
// Vault truth (World/Dates/Ge'orian Calendar.md): 12 unnamed months of
// 40 days (480-day year), BGD/AGD divided at Year 0, present 597 AGD,
// Ge'orian x 1.42 = Earth years, Earth / 1.42 = Ge'orian years.
import { buildTitleLookup, escapeHtml, isWikiUrl, resolveWikiUrl } from './timeline.js'

export const EARTH_YEAR_FACTOR = 1.42
export const PRESENT_YEAR = '597 AGD'

// Strict whole-year input: digits with optional thousands commas only.
// Anything else — blanks, decimals, signs, trailing letters — is garbage.
export function parseYearNumber(raw) {
  if (typeof raw !== 'string') return null
  const text = raw.trim().replace(/,/g, '')
  if (!/^\d+$/.test(text)) return null
  const year = Number(text)
  if (!Number.isSafeInteger(year) || year < 1) return null
  return year
}

// Strict decimal input for the Earth-years direction.
export function parseDecimalNumber(raw) {
  if (typeof raw !== 'string') return null
  const text = raw.trim().replace(/,/g, '')
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const value = Number(text)
  if (!Number.isFinite(value) || value <= 0) return null
  return value
}

// Signed years from the Great Divergence: BGD counts negative,
// AGD positive. Returns null for unknown eras or bad years.
export function toSignedYear(year, era) {
  if (!Number.isSafeInteger(year) || year < 1) return null
  if (era === 'AGD') return year
  if (era === 'BGD') return -year
  return null
}

// Era notation for a signed scalar. Year 0 is the Divergence itself.
export function formatNotation(scalar) {
  if (scalar === 0) return 'Year 0'
  if (!Number.isSafeInteger(scalar)) return null
  const abs = Math.abs(scalar).toLocaleString('en-US')
  return scalar > 0 ? `${abs} AGD` : `${abs} BGD`
}

// Read an era date written loosely: "597 AGD", "~15,000 BGD", "Year 0".
// Returns { year, era } or null when nothing date-like survives.
export function parseEraYear(text) {
  const raw = String(text ?? '').trim()
  if (/^year\s*0$/i.test(raw)) return { year: 0, era: 'Year 0' }
  const match = raw.replace(/,/g, '').match(/(\d+)/)
  if (!match) return null
  const year = Number(match[1])
  if (!Number.isSafeInteger(year) || year < 1) return null
  if (/AGD/.test(raw)) return { year, era: 'AGD' }
  if (/BGD/.test(raw)) return { year, era: 'BGD' }
  return null
}

// Vault conversion: Ge'orian x 1.42 = Earth, Earth / 1.42 = Ge'orian.
// Ge'orian-side math stays in integer hundredths (x142 / 100) so the
// vault factor never wobbles on binary floating point.
export function georianToEarth(years) {
  if (typeof years !== 'number' || !Number.isFinite(years) || years < 0) return null
  return Math.round(years * (EARTH_YEAR_FACTOR * 100)) / 100
}

export function earthToGeorian(years) {
  if (typeof years !== 'number' || !Number.isFinite(years) || years < 0) return null
  return Math.round((years / EARTH_YEAR_FACTOR) * 10) / 10
}

// Era converter: year input + era select -> notation, signed scalar,
// and Earth-year equivalent. Garbage in -> { ok: false, error }.
export function convertEraInput(rawYear, rawEra) {
  const year = parseYearNumber(rawYear)
  if (year === null) return { ok: false, error: 'Name a whole year of 1 or more — letters and blank reckonings cannot be converted.' }
  if (rawEra !== 'AGD' && rawEra !== 'BGD') return { ok: false, error: 'Choose an era — BGD or AGD.' }
  const scalar = toSignedYear(year, rawEra)
  const notation = formatNotation(scalar)
  return { ok: true, scalar, notation, earthYears: georianToEarth(year) }
}

// Earth-years direction: Earth input -> Ge'orian years.
export function convertEarthInput(raw) {
  const value = parseDecimalNumber(raw)
  if (value === null) return { ok: false, error: 'Name a number of Earth years above zero — letters and blank reckonings cannot be converted.' }
  return { ok: true, georianYears: earthToGeorian(value) }
}

// Twelve unnamed months from the index structure ({ months_per_year: 12,
// month_days: 40 }). Empty when the index carries no month shape.
export function monthsOfYear(structure) {
  const count = structure?.months_per_year
  const days = structure?.month_days
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(days) || days < 1) return []
  return Array.from({ length: count }, (_, i) => ({ month: i + 1, days }))
}

// Festivals dated "Day D, Month M" that fall in month n.
export function festivalsForMonth(festivals, n) {
  return (festivals ?? []).filter(festival => {
    const match = String(festival?.date ?? '').match(/Month\s+(\d+)/i)
    return match !== null && Number(match[1]) === n
  })
}

// Festival name -> ^/wiki/ article URL. Prefers the archive lookup,
// falls back to the index file path ("World/.../Name.md"). Never
// returns a non-/wiki/ URL; hostile entries resolve to null.
export function festivalWikiUrl(festival, lookup) {
  const name = String(festival?.name ?? '').trim()
  const viaLookup = name && lookup instanceof Map ? resolveWikiUrl(name, lookup) : null
  if (viaLookup && isWikiUrl(viaLookup)) return viaLookup
  const file = String(festival?.file ?? '').trim()
  if (!file.endsWith('.md')) return null
  const stem = file.replace(/\.md$/, '')
  // Vault-relative paths only: letters, digits, and plain name
  // punctuation. Colons, slashes-doubled, and parent climbs are hostile.
  if (!/^[A-Za-z0-9 _\-'()./]+$/.test(stem)) return null
  if (stem.includes('..') || stem.includes('//')) return null
  const viaFile = `/wiki/${stem}/`
  return isWikiUrl(viaFile) ? viaFile : null
}

export function renderMonthGrid(structure, festivals) {
  const months = monthsOfYear(structure)
  if (months.length === 0) return '<p class="text-cream/40">The months have not been reckoned yet.</p>'
  return months.map(({ month, days }) => {
    const feasts = festivalsForMonth(festivals, month)
    const feastLine = feasts.length
      ? `<ul class="mt-2 space-y-1">${feasts.map(feast => `<li class="text-gold/90">✦ ${escapeHtml(feast.name)} · ${escapeHtml(feast.date)}</li>`).join('')}</ul>`
      : '<p class="mt-2 text-cream/30">No feast-day kept.</p>'
    return `<article class="rounded-xl border border-gold/10 bg-ink/60 p-4" data-month="${month}">`
      + `<h3 class="font-display text-sm tracking-[.2em] text-cream/80">MONTH ${month}</h3>`
      + `<p class="text-xs text-cream/40 mt-1">${days} days</p>${feastLine}</article>`
  }).join('')
}

export function renderFestivals(festivals, lookup) {
  if (!Array.isArray(festivals) || festivals.length === 0) {
    return '<p class="text-cream/40">No festivals survive in the index.</p>'
  }
  return festivals.map(festival => {
    const name = String(festival?.name ?? 'Unnamed feast')
    const url = festivalWikiUrl(festival, lookup)
    const head = url
      ? `<a href="${escapeHtml(url)}" class="text-gold underline decoration-gold/30 underline-offset-4">${escapeHtml(name)}</a>`
      : escapeHtml(name)
    return `<article class="rounded-xl border border-gold/10 bg-ink/60 p-4" data-festival="${escapeHtml(name)}">`
      + `<h3 class="font-display text-sm tracking-[.15em] text-cream/85">${head}</h3>`
      + `<p class="text-xs text-cream/40 mt-1">${escapeHtml(festival?.date ?? 'undated')}</p></article>`
  }).join('')
}

export function calendarSummary(structure, festivals) {
  const months = monthsOfYear(structure)
  const monthWord = months.length === 1 ? 'month' : 'months'
  const feastCount = Array.isArray(festivals) ? festivals.length : 0
  const feastWord = feastCount === 1 ? 'festival' : 'festivals'
  return `${months.length} ${monthWord} · ${feastCount} ${feastWord}`
}

// --- Browser rendering (never runs under node --test) -----------------------
async function initCalendar() {
  const grid = document.getElementById('monthGrid')
  const list = document.getElementById('festivalList')
  const count = document.getElementById('calendarCount')
  const present = document.getElementById('presentYear')
  const structure = document.getElementById('calendarStructure')
  const status = document.getElementById('converterStatus')
  if (!grid || !list) return
  wireConverters(status)
  try {
    const [calendarResponse, wikiResponse] = await Promise.all([
      fetch('/wiki/calendar-index.json', { credentials: 'same-origin' }),
      fetch('/wiki-index.json', { credentials: 'same-origin' }),
    ])
    if (calendarResponse.status === 401 || wikiResponse.status === 401) {
      location.href = '/?next=' + encodeURIComponent('/calendar')
      return
    }
    if (!calendarResponse.ok) throw new Error('The calendar index could not be opened')
    if (!wikiResponse.ok) throw new Error('The archive index could not be opened')
    const data = await calendarResponse.json()
    const wikiIndex = await wikiResponse.json()
    const lookup = buildTitleLookup(Array.isArray(wikiIndex) ? wikiIndex : [])
    const months = monthsOfYear(data.structure)
    const festivals = Array.isArray(data.festivals) ? data.festivals : []
    if (present) present.textContent = `PRESENT DAY · ${data.structure?.present_year ?? PRESENT_YEAR}`
    if (count) count.textContent = calendarSummary(data.structure, festivals)
    if (structure && months.length > 0) {
      structure.textContent = `A Ge'orian year holds ${months.length} unnamed months of ${months[0].days} days — ${months.length * months[0].days} days in all.`
    }
    grid.setAttribute('aria-busy', 'false')
    list.setAttribute('aria-busy', 'false')
    grid.innerHTML = renderMonthGrid(data.structure, festivals)
    list.innerHTML = renderFestivals(festivals, lookup)
  } catch (error) {
    if (count) count.textContent = 'The almanac could not be opened'
    grid.innerHTML = '<p class="text-cream/40">The months could not be raised — try again.</p>'
    list.innerHTML = '<p class="text-cream/40">The feast-fires could not be kindled — try again.</p>'
  }
}

function wireConverters(status) {
  const eraForm = document.getElementById('eraConverter')
  const eraYear = document.getElementById('eraYear')
  const eraSelect = document.getElementById('eraSelect')
  const earthForm = document.getElementById('earthConverter')
  const earthYears = document.getElementById('earthYears')
  const say = message => { if (status) status.textContent = message }
  eraForm?.addEventListener('submit', event => {
    event.preventDefault()
    const result = convertEraInput(eraYear?.value, eraSelect?.value)
    if (!result.ok) { say(result.error); return }
    const direction = result.scalar < 0
      ? `${Math.abs(result.scalar).toLocaleString('en-US')} years before the Great Divergence`
      : `${result.scalar.toLocaleString('en-US')} years after the Great Divergence`
    say(`${result.notation} — ${direction}, some ${result.earthYears.toLocaleString('en-US')} Earth years.`)
  })
  earthForm?.addEventListener('submit', event => {
    event.preventDefault()
    const result = convertEarthInput(earthYears?.value)
    if (!result.ok) { say(result.error); return }
    say(`${Number(earthYears.value.trim().replace(/,/g, '')).toLocaleString('en-US')} Earth years weigh some ${result.georianYears.toLocaleString('en-US')} Ge'orian years.`)
  })
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCalendar)
  else initCalendar()
}
