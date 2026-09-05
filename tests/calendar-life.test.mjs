import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { escapeHtml, isWikiUrl } from '../public/timeline.js'
import {
  birthdaysForMonth,
  CALENDAR_MEMORY_KEY,
  characterAge,
  characterFolioUrl,
  characterMonthOf,
  clampMonth,
  eventMonthOf,
  eventsForMonth,
  MONTH_MEMORY_NOTE,
  MOONS,
  MOON_RHYTHM_NOTE,
  monthOfDateText,
  recallMonth,
  rememberMonth,
  renderBirthdays,
  renderMonthGrid,
  renderMoonMarker,
  renderTimelineLayer,
  TIMELINE_URL,
} from '../public/calendar.js'

const calendarIndex = JSON.parse(readFileSync(new URL('../dist/wiki/calendar-index.json', import.meta.url), 'utf8'))
const timelineIndex = JSON.parse(readFileSync(new URL('../dist/wiki/timeline-index.json', import.meta.url), 'utf8'))
const galleryIndex = JSON.parse(readFileSync(new URL('../dist/wiki/gallery-index.json', import.meta.url), 'utf8'))

const hrefsOf = html => [...html.matchAll(/href="([^"]*)"/g)].map(match => match[1])

test('timeline layer: Month-dated events land on the right month cells', () => {
  const events = [
    { date: 'Day 20, Month 4', event: 'The [[Bloom]] opened.' },
    { date: 'Day 1, Month 4', event: 'A second wonder.' },
    { date: 'Day 40, Month 12', event: 'The Hunt rode out.' },
  ]
  assert.equal(eventsForMonth(events, 4).length, 2)
  assert.equal(eventsForMonth(events, 12).length, 1)
  assert.deepEqual(eventsForMonth(events, 3), [])
  assert.equal(eventMonthOf(events[0]), 4)
  assert.equal(eventMonthOf({ date: '~15,000 BGD' }), null)
  assert.equal(eventMonthOf(null), null)
  assert.equal(monthOfDateText('Day 20, Month 4'), 4)
  assert.equal(monthOfDateText('~15,000 BGD'), null)
  assert.equal(monthOfDateText('Day 1, Month 13'), null)
  assert.equal(monthOfDateText('Day 1, Month 0'), null)
  const html = renderTimelineLayer(events, 4)
  assert.match(html, /2 happenings/)
  assert.match(html, /The Hunt|Bloom/)
  assert.doesNotMatch(html, /The Hunt rode out/)
  for (const href of hrefsOf(html)) assert.equal(href, TIMELINE_URL)
})

test('timeline layer: all 71 real events are year-dated, so none render and no links are invented', () => {
  assert.equal(timelineIndex.events.length, 71)
  let placed = 0
  for (let month = 1; month <= 12; month++) placed += eventsForMonth(timelineIndex.events, month).length
  assert.equal(placed, 0)
  for (let month = 1; month <= 12; month++) {
    const html = renderTimelineLayer(timelineIndex.events, month)
    assert.match(html, /No dated happenings survive/)
    for (const href of hrefsOf(html)) assert.equal(href, TIMELINE_URL)
    assert.doesNotMatch(html, /\[\[/)
  }
})

test('character-age layer: birthdays land by month and ages match gallery math on samples', () => {
  const characters = [
    { name: 'Sample Keeper', born: '500 AGD', birthday: 'Day 10, Month 4', path: '/wiki/World/History/Characters/Sample Keeper/' },
    { name: 'Old Soul', born: '100 BGD', birth: 'Day 1, Month 4' },
    { name: 'Ageless One', birthday: 'Day 40, Month 12' },
  ]
  assert.equal(characterMonthOf(characters[0]), 4)
  assert.equal(characterMonthOf(characters[2]), 12)
  assert.equal(birthdaysForMonth(characters, 4).length, 2)
  assert.equal(birthdaysForMonth({ entries: characters }, 12).length, 1)
  assert.deepEqual(birthdaysForMonth(characters, 3), [])
  assert.equal(characterAge(characters[0], '597 AGD'), 97)
  assert.equal(characterAge(characters[1], '597 AGD'), 697)
  assert.equal(characterAge(characters[2], '597 AGD'), null)
  assert.equal(characterAge({ name: 'Future Child', born: '600 AGD' }, '597 AGD'), null)
  assert.equal(characterAge(null), null)
  const lookup = new Map([['sample keeper', '/wiki/World/History/Characters/Sample Keeper/']])
  assert.equal(characterFolioUrl(characters[0], lookup), '/wiki/World/History/Characters/Sample Keeper/')
  assert.equal(characterFolioUrl({ name: 'Path Walker', path: '/wiki/World/History/Characters/Aelis/' }, new Map()), '/wiki/World/History/Characters/Aelis/')
  assert.equal(characterFolioUrl({ name: 'Evil', path: 'https://evil.example/x' }, new Map()), null)
  assert.equal(characterFolioUrl({ name: 'Nowhere' }, new Map()), null)
  const html = renderBirthdays(characters, 4, lookup, '597 AGD')
  assert.match(html, /2 birthdays/)
  assert.match(html, /age 97/)
  assert.match(html, /age 697/)
  for (const href of hrefsOf(html)) assert.match(href, /^\/wiki\//)
  const hostile = renderBirthdays([{ name: '<img src=x onerror=alert(1)>', birthday: 'Day 1, Month 4', born: '500 AGD', path: 'https://evil.example/x' }], 4, new Map())
  assert.doesNotMatch(hostile, /<img src=x/)
  assert.doesNotMatch(hostile, /href="/)
  assert.match(hostile, /&lt;img/)
  assert.ok(hostile.includes(escapeHtml('<img src=x onerror=alert(1)>')))
})

test('character-age layer: all 78 real gallery entries are undated, so the honest empty state renders', () => {
  assert.equal(galleryIndex.entries.length, 78)
  let placed = 0
  for (let month = 1; month <= 12; month++) placed += birthdaysForMonth(galleryIndex, month).length
  assert.equal(placed, 0)
  const html = renderBirthdays(galleryIndex, 4, new Map())
  assert.match(html, /No birthdays are reckoned/)
  assert.deepEqual(hrefsOf(html), [])
})

test('moons strip: canon names only, rhythm unrecorded, no phases ever render', () => {
  assert.deepEqual(MOONS.map(moon => moon.name), ['Maenar', 'Amelia'])
  assert.equal(MOON_RHYTHM_NOTE, 'rhythm unrecorded — no phases shown')
  const html = renderMoonMarker()
  assert.match(html, /Maenar/)
  assert.match(html, /Amelia/)
  assert.match(html, /Silver Bride/)
  assert.match(html, /rhythm unrecorded — no phases shown/)
  const banned = [/New Moon/, /Full Moon/, /Waxing/, /Waning/, /Quarter/, /Crescent/, /Gibbous/, /% light/, /full on day/i]
  for (const pattern of banned) assert.doesNotMatch(html, pattern)
  const grid = renderMonthGrid(calendarIndex.structure, calendarIndex.festivals, { events: timelineIndex.events, characters: galleryIndex })
  assert.match(grid, /data-month="4"/)
  assert.match(grid, /DAY LIST/)
  assert.match(grid, /Alegoria Bloom/)
  for (const pattern of banned) assert.doesNotMatch(grid, pattern)
  assert.doesNotMatch(grid, /☾/)
})

test('month memory: clamps, never throws without storage, note is device-honest', () => {
  assert.equal(clampMonth(4), 4)
  assert.equal(clampMonth('7'), 7)
  assert.equal(clampMonth(0), 1)
  assert.equal(clampMonth(99), 12)
  assert.equal(clampMonth('nonsense'), 1)
  assert.equal(recallMonth(), null)
  assert.equal(rememberMonth(5), 5)
  assert.equal(recallMonth(), null)
  assert.equal(CALENDAR_MEMORY_KEY, 'geor-calendar-month')
  assert.match(MONTH_MEMORY_NOTE, /this device only/)
  assert.ok(!/server|sync|account|shared/i.test(MONTH_MEMORY_NOTE))
})

test('living shell: month nav, moon, and life layers mount while the gate stays put', () => {
  const html = readFileSync(new URL('../public/calendar.html', import.meta.url), 'utf8')
  for (const id of ['monthNav', 'monthSelect', 'monthPrev', 'monthNext', 'monthMemoryNote', 'moonMarker', 'timelineLayer', 'birthdayLayer']) {
    assert.match(html, new RegExp(`id="${id}"`), id)
  }
  assert.match(html, /THE LIVING MONTH/)
  const script = readFileSync(new URL('../public/calendar.js', import.meta.url), 'utf8')
  for (const token of ['eventsForMonth', 'birthdaysForMonth', 'characterAge', 'characterFolioUrl', 'MOONS', 'MOON_RHYTHM_NOTE', 'rememberMonth', 'recallMonth', 'renderTimelineLayer', 'renderBirthdays', 'renderMoonMarker', 'localStorage', '/timeline']) {
    assert.ok(script.includes(token), token)
  }
  assert.ok(script.includes('/wiki/timeline-index.json'))
  assert.ok(script.includes('/wiki/gallery-index.json'))
  assert.ok(isWikiUrl('/wiki/World/History/Characters/Aelis/'))
})
