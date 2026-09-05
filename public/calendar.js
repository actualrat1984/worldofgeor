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

// --- Living calendar (H12a): timeline, birthday, and moons layers -------------
// Timeline events and gallery entries carry year-era dates, not Day/Month
// ones — so month placement only ever matches an explicit "Month N" in a
// date-like field. Anything undated never renders; nothing is invented.
export const TIMELINE_URL = '/timeline'
export const CALENDAR_MEMORY_KEY = 'geor-calendar-month'
export const MONTH_MEMORY_NOTE = 'Your focused month is kept on this device only — never leaves your browser.'

export function clampMonth(value, months = 12) {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 1) return 1
  if (Number.isSafeInteger(months) && months > 0 && n > months) return months
  return n
}

// Month number carried in free text ("Day 20, Month 4") — null when the
// text names no in-range month. Out-of-range months never render.
export function monthOfDateText(text, months = 12) {
  const match = String(text ?? '').match(/Month\s+(\d+)/i)
  if (!match) return null
  const n = Number(match[1])
  if (!Number.isSafeInteger(n) || n < 1) return null
  if (Number.isSafeInteger(months) && months > 0 && n > months) return null
  return n
}

export function eventMonthOf(event, months = 12) {
  if (!event || typeof event !== 'object') return null
  return monthOfDateText(event.date, months)
}

export function eventsForMonth(events, n, months = 12) {
  if (!Array.isArray(events)) return []
  return events.filter(event => eventMonthOf(event, months) === n)
}

// Birthday-like fields first; the gallery index carries none today, so
// real entries resolve to null and render the honest empty state.
export function characterMonthOf(entry, months = 12) {
  if (!entry || typeof entry !== 'object') return null
  for (const key of ['birthday', 'birth', 'born', 'date']) {
    const found = monthOfDateText(entry[key], months)
    if (found !== null) return found
  }
  return null
}

export function birthdaysForMonth(characters, n, months = 12) {
  const list = Array.isArray(characters) ? characters : characters?.entries
  if (!Array.isArray(list)) return []
  return list.filter(entry => characterMonthOf(entry, months) === n)
}

function eraScalarOf(parsed) {
  if (!parsed || typeof parsed !== 'object') return null
  if (parsed.era === 'Year 0' || parsed.year === 0) return 0
  return toSignedYear(parsed.year, parsed.era)
}

// Whole-year age at the present year from a "born" era date.
// Null when no birth year survives (the gallery norm) or it postdates now.
export function characterAge(entry, present = PRESENT_YEAR) {
  if (!entry || typeof entry !== 'object') return null
  const raw = entry.born ?? entry.birth ?? null
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const bornAt = eraScalarOf(parseEraYear(raw))
  const nowAt = eraScalarOf(parseEraYear(present))
  if (bornAt === null || nowAt === null) return null
  const age = nowAt - bornAt
  return Number.isSafeInteger(age) && age >= 0 ? age : null
}

// Character name -> folio URL. Prefers the archive lookup, falls back to
// the gallery path. Only ^/wiki/ survives; hostile entries resolve null.
export function characterFolioUrl(entry, lookup) {
  const name = String(entry?.name ?? '').trim()
  const viaLookup = name && lookup instanceof Map ? resolveWikiUrl(name, lookup) : null
  if (viaLookup && isWikiUrl(viaLookup)) return viaLookup
  const path = String(entry?.path ?? '').trim()
  return isWikiUrl(path) ? path : null
}

// Moons strip: canon names only, never a rhythm. The Bride-Tide index
// names the Silver Bride ring as the destroyed sister-moon of Maenar and
// Amelia, and the wiki index carries Maenar and Amelia (Moon) folios — so
// two surviving moons resolve and the fallen third is the Bride. No lunar
// rhythm is recorded in canon, so no phases, day numbers, or illumination
// percentages are ever computed or shown.
export const MOONS = [{ name: 'Maenar' }, { name: 'Amelia' }]
export const MOON_RHYTHM_NOTE = 'rhythm unrecorded — no phases shown'

// Month memory: localStorage on this device only. Null when storage is
// missing, blocked, or holds no sane month — every failure is silent.
export function recallMonth(months = 12) {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(CALENDAR_MEMORY_KEY)
    if (raw === null || raw === '') return null
    const n = Number(raw)
    return Number.isSafeInteger(n) && n >= 1 && n <= months ? n : null
  } catch {
    return null
  }
}

export function rememberMonth(n, months = 12) {
  const clamped = clampMonth(n, months)
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(CALENDAR_MEMORY_KEY, String(clamped))
  } catch {
    // Device said no — the focused month still applies for this visit.
  }
  return clamped
}

function stripWikilinks(text) {
  return String(text ?? '').replace(/\[\[/g, '').replace(/\]\]/g, '')
}

// The only link a timeline item ever emits is the timeline page itself:
// events carry no article URLs and none are invented.
export function renderTimelineLayer(events, month, months = 12) {
  const placed = eventsForMonth(events, month, months)
  const countWord = placed.length === 1 ? 'happening' : 'happenings'
  const head = `<h3 class="font-display text-sm tracking-[.15em] text-cream/85">MONTH ${escapeHtml(month)} · ${placed.length} ${countWord}</h3>`
  if (placed.length === 0) {
    return head
      + '<p class="text-xs text-cream/40 mt-2">No dated happenings survive for this month — the timeline reckons in years, not days.</p>'
      + `<p class="mt-2"><a href="${TIMELINE_URL}" class="text-gold underline decoration-gold/30 underline-offset-4 text-xs tracking-widest">READ THE FULL TIMELINE</a></p>`
  }
  const items = placed.map(entry => {
    const prose = stripWikilinks(entry?.event ?? entry?.name ?? 'Unnamed happening')
    return `<li class="text-cream/60">◈ ${escapeHtml(entry?.date ?? 'undated')} — ${escapeHtml(prose)}</li>`
  }).join('')
  return head
    + `<ul class="mt-2 space-y-1 text-xs">${items}</ul>`
    + `<p class="mt-2"><a href="${TIMELINE_URL}" class="text-gold underline decoration-gold/30 underline-offset-4 text-xs tracking-widest">READ THE FULL TIMELINE</a></p>`
}

export function renderBirthdays(characters, month, lookup, present = PRESENT_YEAR, months = 12) {
  const placed = birthdaysForMonth(characters, month, months)
  const countWord = placed.length === 1 ? 'birthday' : 'birthdays'
  const head = `<h3 class="font-display text-sm tracking-[.15em] text-cream/85">MONTH ${escapeHtml(month)} · ${placed.length} ${countWord}</h3>`
  if (placed.length === 0) {
    return head + '<p class="text-xs text-cream/40 mt-2">No birthdays are reckoned for this month yet.</p>'
  }
  const items = placed.map(entry => {
    const name = String(entry?.name ?? 'Unnamed')
    const age = characterAge(entry, present)
    const tail = age === null ? '' : ` · age ${age.toLocaleString('en-US')}`
    const url = characterFolioUrl(entry, lookup)
    const headHtml = url
      ? `<a href="${escapeHtml(url)}" class="text-gold underline decoration-gold/30 underline-offset-4">${escapeHtml(name)}</a>`
      : escapeHtml(name)
    return `<li class="text-cream/60" data-birthday="${escapeHtml(name)}">${headHtml}<span class="text-cream/40">${escapeHtml(tail)}</span></li>`
  }).join('')
  return head + `<ul class="mt-2 space-y-1 text-xs">${items}</ul>`
}

export function renderMoonMarker() {
  const names = MOONS.map(moon => escapeHtml(moon.name)).join(' · ')
  return `<p>Two moons survive — ${names} — and the fallen third keeps the sky as the Silver Bride ring. <span class="text-cream/40">${escapeHtml(MOON_RHYTHM_NOTE)}</span></p>`
}

export function renderMonthGrid(structure, festivals, layers = {}) {
  const months = monthsOfYear(structure)
  if (months.length === 0) return '<p class="text-cream/40">The months have not been reckoned yet.</p>'
  const days = months[0].days
  return months.map(({ month }) => {
    const feasts = festivalsForMonth(festivals, month)
    const feastLine = feasts.length
      ? `<ul class="mt-2 space-y-1">${feasts.map(feast => `<li class="text-gold/90">✦ ${escapeHtml(feast.name)} · ${escapeHtml(feast.date)}</li>`).join('')}</ul>`
      : '<p class="mt-2 text-cream/30">No feast-day kept.</p>'
    const happenings = eventsForMonth(layers.events, month, months.length)
    const birthdays = birthdaysForMonth(layers.characters, month, months.length)
    const dots = `<p class="mt-2 text-[11px] tracking-widest text-cream/40">◈ ${happenings.length} · ✦ ${feasts.length} · ♥ ${birthdays.length}</p>`
    const dayItems = [
      ...feasts.map(feast => `<li>✦ ${escapeHtml(feast.date)} — ${escapeHtml(feast.name)}</li>`),
      ...happenings.map(entry => `<li>◈ ${escapeHtml(entry?.date ?? 'undated')} — ${escapeHtml(stripWikilinks(entry?.event ?? entry?.name ?? 'Unnamed happening'))}</li>`),
      ...birthdays.map(entry => {
        const age = characterAge(entry)
        return `<li>♥ ${escapeHtml(entry?.name ?? 'Unnamed')}${age === null ? '' : ` · age ${age.toLocaleString('en-US')}`}</li>`
      }),
    ]
    const dayList = dayItems.length
      ? `<details class="mt-2"><summary class="cursor-pointer text-[11px] tracking-widest text-gold/80">DAY LIST · ${dayItems.length}</summary><ul class="mt-1 space-y-1 text-xs text-cream/60">${dayItems.join('')}</ul></details>`
      : ''
    return `<article class="rounded-xl border border-gold/10 bg-ink/60 p-4" data-month="${month}">`
      + `<h3 class="font-display text-sm tracking-[.2em] text-cream/80">MONTH ${month}</h3>`
      + `<p class="text-xs text-cream/40 mt-1">${days} days</p>${feastLine}${dots}${dayList}</article>`
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
  const nav = document.getElementById('monthNav')
  const select = document.getElementById('monthSelect')
  const memoryNote = document.getElementById('monthMemoryNote')
  const moon = document.getElementById('moonMarker')
  const layer = document.getElementById('timelineLayer')
  const birthdays = document.getElementById('birthdayLayer')
  if (!grid || !list) return
  wireConverters(status)
  if (memoryNote) memoryNote.textContent = MONTH_MEMORY_NOTE
  try {
    const [calendarResponse, wikiResponse, timelineResponse, galleryResponse] = await Promise.all([
      fetch('/wiki/calendar-index.json', { credentials: 'same-origin' }),
      fetch('/wiki-index.json', { credentials: 'same-origin' }),
      fetch('/wiki/timeline-index.json', { credentials: 'same-origin' }),
      fetch('/wiki/gallery-index.json', { credentials: 'same-origin' }),
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
    let timelineEvents = []
    let characters = []
    try {
      if (timelineResponse.ok) {
        const timeline = await timelineResponse.json()
        if (Array.isArray(timeline?.events)) timelineEvents = timeline.events
      }
    } catch { timelineEvents = [] }
    try {
      if (galleryResponse.ok) {
        const gallery = await galleryResponse.json()
        const entries = Array.isArray(gallery) ? gallery : gallery?.entries
        if (Array.isArray(entries)) characters = entries
      }
    } catch { characters = [] }
    const months = monthsOfYear(data.structure)
    const festivals = Array.isArray(data.festivals) ? data.festivals : []
    const presentYear = data.structure?.present_year ?? PRESENT_YEAR
    if (present) present.textContent = `PRESENT DAY · ${presentYear}`
    if (count) count.textContent = calendarSummary(data.structure, festivals)
    if (structure && months.length > 0) {
      structure.textContent = `A Ge'orian year holds ${months.length} unnamed months of ${months[0].days} days — ${months.length * months[0].days} days in all.`
    }
    grid.setAttribute('aria-busy', 'false')
    list.setAttribute('aria-busy', 'false')
    grid.innerHTML = renderMonthGrid(data.structure, festivals, { events: timelineEvents, characters })
    list.innerHTML = renderFestivals(festivals, lookup)
    const paintMonth = focused => {
      const month = clampMonth(focused, months.length || 12)
      if (select && select.value !== String(month)) select.value = String(month)
      if (moon) moon.innerHTML = renderMoonMarker()
      if (layer) layer.innerHTML = renderTimelineLayer(timelineEvents, month, months.length || 12)
      if (birthdays) birthdays.innerHTML = renderBirthdays(characters, month, lookup, presentYear, months.length || 12)
      grid.querySelectorAll('[data-month]').forEach(cell => {
        // Inline style: tailwind never scans public/*.js, so a toggled
        // border-gold/* class would purge away and silently do nothing.
        cell.style.borderColor = cell.getAttribute('data-month') === String(month) ? 'hsla(39,56%,66%,.55)' : ''
      })
    }
    if (nav && select && months.length > 0) {
      select.innerHTML = months.map(({ month: n }) => `<option value="${n}">Month ${n}</option>`).join('')
      let focused = recallMonth(months.length) ?? 1
      select.value = String(focused)
      paintMonth(focused)
      select.addEventListener('change', () => { focused = rememberMonth(select.value, months.length); paintMonth(focused) })
      document.getElementById('monthPrev')?.addEventListener('click', () => {
        focused = rememberMonth(focused - 1 < 1 ? months.length : focused - 1, months.length)
        paintMonth(focused)
      })
      document.getElementById('monthNext')?.addEventListener('click', () => {
        focused = rememberMonth(focused + 1 > months.length ? 1 : focused + 1, months.length)
        paintMonth(focused)
      })
    }
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
