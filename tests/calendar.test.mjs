import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import worker, { __test } from '../worker.js'
import { escapeHtml, isWikiUrl } from '../public/timeline.js'
import {
  calendarSummary,
  convertEarthInput,
  convertEraInput,
  earthToGeorian,
  festivalsForMonth,
  festivalWikiUrl,
  formatNotation,
  georianToEarth,
  monthsOfYear,
  parseEraYear,
  renderFestivals,
  renderMonthGrid,
  toSignedYear,
} from '../public/calendar.js'

const SECRET = 'test-only-secret-that-is-longer-than-32-characters'
const data = JSON.parse(readFileSync(new URL('../dist/wiki/calendar-index.json', import.meta.url), 'utf8'))

test('calendar index shape: 12 unnamed months of 40 days, 12 festivals, BGD/AGD eras', () => {
  assert.equal(data.structure.months_per_year, 12)
  assert.equal(data.structure.month_days, 40)
  assert.equal(data.structure.months_named, false)
  assert.equal(data.structure.year_days, 480)
  assert.equal(data.structure.earth_year_factor, 1.42)
  assert.deepEqual(data.structure.eras, ['BGD', 'AGD'])
  assert.equal(data.structure.present_year, '597 AGD')
  assert.equal(data.festivals.length, 12)
  assert.ok(data.festivals.every(festival => typeof festival.name === 'string' && festival.name.length > 0))
  assert.ok(data.festivals.every(festival => typeof festival.file === 'string' && festival.file.endsWith('.md')))
  assert.ok(data.festivals.every(festival => /Day \d+, Month \d+/.test(festival.date)), 'every festival carries a Day/Month date')
  const months = monthsOfYear(data.structure)
  assert.equal(months.length, 12)
  assert.ok(months.every(month => month.days === 40))
  assert.deepEqual(months[0], { month: 1, days: 40 })
  assert.deepEqual(months[11], { month: 12, days: 40 })
  assert.deepEqual(monthsOfYear(null), [])
  assert.deepEqual(monthsOfYear({}), [])
  assert.equal(calendarSummary(data.structure, data.festivals), '12 months · 12 festivals')
})

test('every festival lands in exactly one month; each month keeps its feasts', () => {
  const seen = new Map()
  for (const festival of data.festivals) {
    const match = festival.date.match(/Month (\d+)/)
    assert.ok(match, `${festival.name} has a month`)
    const month = Number(match[1])
    assert.ok(month >= 1 && month <= 12, `${festival.name} month in range`)
    seen.set(festival.name, month)
  }
  assert.equal(seen.size, 12)
  assert.equal(festivalsForMonth(data.festivals, 4).map(festival => festival.name).join(), 'Alegoria Bloom')
  assert.equal(festivalsForMonth(data.festivals, 12).map(festival => festival.name).sort().join('|'), 'Featherfall|Hunt Night (Moonfang)')
  assert.deepEqual(festivalsForMonth(data.festivals, 3), [])
  assert.deepEqual(festivalsForMonth([], 4), [])
  const grid = renderMonthGrid(data.structure, data.festivals)
  assert.match(grid, /data-month="1"/)
  assert.match(grid, /data-month="12"/)
  assert.match(grid, /MONTH 4/)
  assert.match(grid, /Alegoria Bloom/)
  assert.match(renderMonthGrid(null, []), /not been reckoned/)
  assert.match(renderFestivals([], new Map()), /No festivals survive/)
})

test('festival links always carry ^/wiki/ hrefs; hostile targets never render', () => {
  const lookup = new Map([['alegoria bloom', '/wiki/World/Culture/Festivals/Alegoria Bloom/']])
  assert.equal(festivalWikiUrl(data.festivals[0], lookup), '/wiki/World/Culture/Festivals/Alegoria Bloom/')
  for (const festival of data.festivals) {
    const url = festivalWikiUrl(festival, new Map())
    assert.ok(url && isWikiUrl(url), `${festival.name} -> ${url}`)
  }
  const html = renderFestivals(data.festivals, new Map())
  for (const match of html.matchAll(/href="([^"]*)"/g)) {
    assert.match(match[1], /^\/wiki\//)
  }
  assert.match(html, /data-festival="Bride-Tide"/)
  for (const bad of [
    { name: 'Evil', file: 'javascript:alert(1)', date: 'Day 1, Month 1' },
    { name: 'Offsite', file: 'https://evil.example/wiki/x', date: 'Day 1, Month 1' },
    { name: 'Sneaky', file: '/evil', date: 'Day 1, Month 1' },
    { name: '', file: '', date: '' },
    null,
  ]) {
    assert.equal(festivalWikiUrl(bad, new Map()), null, String(bad?.name))
  }
  const hostile = renderFestivals([{ name: '<img src=x onerror=alert(1)>', file: 'https://evil.example/x', date: '<script>evil()</script>' }], new Map())
  assert.doesNotMatch(hostile, /<img src=x/)
  assert.doesNotMatch(hostile, /<script>evil/)
  assert.doesNotMatch(hostile, /href="/)
  assert.match(hostile, /&lt;img/)
  assert.ok(hostile.includes(escapeHtml('<script>evil()</script>')))
})

test('era math: BGD negative, AGD positive, Year 0 is zero, notation round-trips', () => {
  assert.equal(toSignedYear(597, 'AGD'), 597)
  assert.equal(toSignedYear(15000, 'BGD'), -15000)
  assert.equal(toSignedYear(0, 'AGD'), null)
  assert.equal(toSignedYear(-5, 'BGD'), null)
  assert.equal(toSignedYear(597, 'XYZ'), null)
  assert.equal(formatNotation(597), '597 AGD')
  assert.equal(formatNotation(-15000), '15,000 BGD')
  assert.equal(formatNotation(0), 'Year 0')
  assert.equal(formatNotation(1.5), null)
  assert.deepEqual(parseEraYear('597 AGD'), { year: 597, era: 'AGD' })
  assert.deepEqual(parseEraYear('~15,000 BGD'), { year: 15000, era: 'BGD' })
  assert.deepEqual(parseEraYear('Year 0'), { year: 0, era: 'Year 0' })
  assert.equal(parseEraYear('nonsense'), null)
  assert.equal(parseEraYear(''), null)
  assert.equal(parseEraYear(null), null)
  for (const scalar of [597, -15000, 1, -1]) {
    const parsed = parseEraYear(formatNotation(scalar))
    assert.equal(toSignedYear(parsed.year, parsed.era), scalar, formatNotation(scalar))
  }
})

test('vault conversion factor 1.42 both directions; garbage rejected everywhere', () => {
  assert.equal(georianToEarth(1), 1.42)
  assert.equal(georianToEarth(3000000), 4260000)
  assert.equal(georianToEarth(40000), 56800)
  assert.equal(earthToGeorian(1.42), 1)
  assert.equal(earthToGeorian(848), 597.2)
  assert.equal(georianToEarth(-1), null)
  assert.equal(earthToGeorian(NaN), null)
  const good = convertEraInput('597', 'AGD')
  assert.deepEqual(good, { ok: true, scalar: 597, notation: '597 AGD', earthYears: 847.74 })
  assert.deepEqual(convertEraInput('15,000', 'BGD'), { ok: true, scalar: -15000, notation: '15,000 BGD', earthYears: 21300 })
  for (const garbage of ['', '   ', 'seven', '597 AGD', '12abc', '5.5', '-3', '0', 'NaN', null, undefined, 597]) {
    const result = convertEraInput(garbage, 'AGD')
    assert.equal(result.ok, false, String(garbage))
    assert.match(result.error, /whole year/)
  }
  assert.equal(convertEraInput('597', 'XYZ').ok, false)
  const earth = convertEarthInput('848')
  assert.equal(earth.ok, true)
  assert.equal(earth.georianYears, 597.2)
  for (const garbage of ['', 'abc', 'eight', '-5', '0', null, undefined]) {
    const result = convertEarthInput(garbage)
    assert.equal(result.ok, false, String(garbage))
    assert.match(result.error, /Earth years/)
  }
})

test('calendar gate: worker treats page and script as private', () => {
  assert.equal(__test.isPrivatePath('/calendar'), true)
  assert.equal(__test.isPrivatePath('/calendar/'), true)
  assert.equal(__test.isPrivatePath('/calendar.html'), true)
  assert.equal(__test.isPrivatePath('/calendar.js'), true)
  assert.equal(__test.isPrivatePath('/wiki/calendar-index.json'), true)
})

test('calendar gating: anon 302, script 401, authed 200', async () => {
  const html = readFileSync(new URL('../public/calendar.html', import.meta.url), 'utf8')
  const env = {
    JWT_SECRET: SECRET,
    ASSETS: { fetch: async request => {
      const pathname = new URL(request.url).pathname
      const body = pathname === '/calendar.html' ? html : pathname
      return new Response(body, { headers: { 'Content-Type': pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/json' } })
    } },
  }
  for (const path of ['/calendar', '/calendar/']) {
    const response = await worker.fetch(new Request(`https://worldofgeor.com${path}`, { headers: { Accept: 'text/html' } }), env, {})
    assert.equal(response.status, 302, path)
    assert.match(response.headers.get('location'), /next=%2Fcalendar/, path)
    assert.equal(response.headers.get('cache-control'), 'no-store', path)
  }
  const gatedScript = await worker.fetch(new Request('https://worldofgeor.com/calendar.js', { headers: { 'Sec-Fetch-Dest': 'script' } }), env, {})
  assert.equal(gatedScript.status, 401)
  const now = Math.floor(Date.now() / 1000)
  const token = await __test.signJwt({ email: 'keeper@example.com', iss: 'worldofgeor', iat: now, exp: now + 60 }, SECRET)
  const authed = await worker.fetch(new Request('https://worldofgeor.com/calendar', { headers: { Cookie: `geor_token=${token}`, Accept: 'text/html' } }), env, {})
  assert.equal(authed.status, 200)
  assert.equal(authed.headers.get('cache-control'), 'private, no-store')
  const body = await authed.text()
  assert.match(body, /GE'ORIAN CALENDAR/)
  assert.match(body, /monthGrid/)
  assert.match(body, /calendar\.js/)
})

test('calendar shell mounts the month grid, festival list, and converter while staying noindex', () => {
  const html = readFileSync(new URL('../public/calendar.html', import.meta.url), 'utf8')
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive" \/>/)
  assert.match(html, /id="monthGrid"/)
  assert.match(html, /id="festivalList"/)
  assert.match(html, /id="eraConverter"/)
  assert.match(html, /id="earthConverter"/)
  assert.match(html, /id="converterStatus"/)
  assert.match(html, /id="calendarCount"/)
  assert.match(html, /src="\/calendar\.js"/)
  assert.match(html, /src="\/archive-compass\.js"/)
  const script = readFileSync(new URL('../public/calendar.js', import.meta.url), 'utf8')
  assert.match(script, /from '\.\/timeline\.js'/)
  assert.match(script, /isWikiUrl/)
  assert.match(script, /escapeHtml/)
  assert.match(script, /\/wiki\/calendar-index\.json/)
  const workerSource = readFileSync(new URL('../worker.js', import.meta.url), 'utf8')
  assert.match(workerSource, /\['\/calendar', '\/calendar\.html'\]/)
  assert.match(workerSource, /'\/calendar\.js'/)
  const compass = readFileSync(new URL('../public/archive-compass.js', import.meta.url), 'utf8')
  assert.match(compass, /url: '\/calendar'/)
  const checkSite = readFileSync(new URL('../scripts/check-site.mjs', import.meta.url), 'utf8')
  assert.match(checkSite, /\['\/calendar', '\/calendar\.html'\]/)
})
