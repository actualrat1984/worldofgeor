import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dashboardHtml = readFileSync(path.join(root, 'public', 'dashboard.html'), 'utf8')
const checkSiteSrc = readFileSync(path.join(root, 'scripts', 'check-site.mjs'), 'utf8')

// Alias map parsed from the same source check-site.mjs uses to resolve routes.
const aliasEntries = [...checkSiteSrc.matchAll(/\[\s*'([^']+)'\s*,\s*'([^']+)'\s*\]/g)]
const aliasMap = new Map(aliasEntries.map(match => [match[1], match[2]]))

const expectedRooms = [
  { href: '/timeline', title: 'Timeline of the Ages' },
  { href: '/chronicles', title: 'Chronicles' },
  { href: '/atlas', title: 'World Atlas' },
  { href: '/gazetteer', title: 'Gazetteer of Nations' },
  { href: '/trees', title: 'Family Trees' },
  { href: '/webs', title: 'Diplomacy Webs' },
  { href: '/graph', title: 'Relation Graph' },
  { href: '/gallery', title: 'Character Gallery' },
  { href: '/oracle', title: 'Prompt Oracle' },
  { href: '/notebook', title: 'Notebook' },
  { href: '/boards', title: 'Whiteboards' },
  { href: '/manuscripts', title: 'Manuscripts' },
  { href: '/calendar', title: "Ge'orian Calendar" },
  { href: '/audio', title: 'Audio Library' },
  { href: '/arcs', title: 'Story Arcs' },
  { href: '/quests', title: 'Quest Board' },
  { href: '/primer', title: "Reader's Primer" },
  { href: '/desk', title: "Author's Desk" },
  { href: '/statblocks', title: 'System Statblocks' },
  { href: '/entry', title: 'Guided Entry' },
  { href: '/recaps', title: 'Session Recaps' },
  { href: '/review', title: 'Review Queue' },
]

function roomsSection() {
  const marker = 'aria-labelledby="roomsTitle"'
  const markerAt = dashboardHtml.indexOf(marker)
  assert.ok(markerAt >= 0, 'dashboard rooms section is present')
  const sectionStart = dashboardHtml.lastIndexOf('<section', markerAt)
  const sectionEnd = dashboardHtml.indexOf('</section>', markerAt)
  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart, 'rooms section is well-formed')
  return dashboardHtml.slice(sectionStart, sectionEnd)
}

test('dashboard rooms grid links all 22 wave rooms, each resolving via the alias map', () => {
  const section = roomsSection()
  const hrefs = [...section.matchAll(/href="([^"]+)"/g)].map(match => match[1])
  assert.equal(hrefs.length, expectedRooms.length, `rooms grid has ${expectedRooms.length} links`)
  assert.deepEqual([...new Set(hrefs)].sort(), expectedRooms.map(room => room.href).sort())
  for (const room of expectedRooms) {
    assert.ok(aliasMap.has(room.href), `${room.href} exists in the check-site alias map (no invented routes)`)
    const target = aliasMap.get(room.href).replace(/^\/+/, '')
    assert.ok(
      existsSync(path.join(root, 'public', target)),
      `${room.href} resolves to public/${target}`,
    )
  }
})

test('no room href invents a route outside the alias map', () => {
  const section = roomsSection()
  const hrefs = [...section.matchAll(/href="([^"]+)"/g)].map(match => match[1])
  for (const href of hrefs) {
    assert.ok(aliasMap.has(href), `${href} must be a known alias route`)
  }
})

test('every room card carries non-empty accessible text (title, subtitle, link)', () => {
  const section = roomsSection()
  const cards = section.split('<h3').slice(1)
  assert.equal(cards.length, expectedRooms.length, `rooms grid has ${expectedRooms.length} cards`)
  for (const room of expectedRooms) {
    const card = cards.find(block => block.toLowerCase().includes(room.title.toLowerCase()))
    assert.ok(card, `card titled "${room.title}" exists`)
    const heading = (card.match(/>([^<>]+)<\/h3>/) || [])[1] || ''
    assert.ok(heading.trim().length > 0, `"${room.title}" card heading is non-empty`)
    const subtitle = (card.match(/<p[^>]*>([^<>]+)<\/p>/) || [])[1] || ''
    assert.ok(subtitle.trim().length > 0, `"${room.title}" card subtitle is non-empty`)
    const link = card.match(/<a[^>]*href="([^"]+)"[^>]*>([^<>]*)<\/a>/) || []
    assert.equal(link[1], room.href, `"${room.title}" card links ${room.href}`)
    const accessible = `${link[2] || ''} ${(link[0].match(/aria-label="([^"]+)"/) || [])[1] || ''}`.trim()
    assert.ok(accessible.length > 0, `"${room.title}" card link has accessible text`)
  }
})
