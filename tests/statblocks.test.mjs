import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import worker, { __test } from '../worker.js'
import { escapeHtml, isWikiUrl } from '../public/timeline.js'
import {
  activeTemplate,
  filterStatblocks,
  renderStatblockCard,
  renderStatblocks,
  statblocksSummary,
  templateEntries,
} from '../public/statblocks.js'

const SECRET = 'test-only-secret-that-is-longer-than-32-characters'
const data = JSON.parse(readFileSync(new URL('../dist/wiki/statblocks-index.json', import.meta.url), 'utf8'))
const entries = data.entries

test('statblocks index shape: 3 templates, 84 entries, every path gated or empty', () => {
  assert.deepEqual(data.templates.map(template => template.id), ['magic-ranks', 'species-traits', 'currencies'])
  assert.deepEqual(data.templates.map(template => template.entries), [7, 52, 25])
  assert.equal(entries.length, 84)
  assert.ok(entries.every(entry => typeof entry.name === 'string' && entry.name.length > 0))
  assert.ok(entries.every(entry => typeof entry.path === 'string'))
  assert.ok(entries.every(entry => !entry.path || isWikiUrl(entry.path)))
  assert.ok(entries.every(entry => Array.isArray(entry.traits)))
  assert.ok(entries.every(entry => entry.traits.every(trait => typeof trait.label === 'string' && typeof trait.value === 'string' && trait.label.length > 0 && trait.value.length > 0)))
  assert.equal(data.files_scanned, 54)
})

test('magic ranks keep tier order with vault doctrine rows', () => {
  const ranks = templateEntries(entries, 'magic-ranks')
  assert.deepEqual(ranks.map(rank => rank.name),
    ['Elementary', 'Intermediate', 'Advanced', 'Saint', 'King', 'Emperor', 'God'])
  assert.deepEqual(ranks[0].traits[0], { label: 'Tier', value: '1 of 7' })
  assert.deepEqual(ranks[6].traits[0], { label: 'Tier', value: '7 of 7' })
  assert.deepEqual(ranks[0].traits[1], { label: 'Standing', value: 'Lowest tier' })
  assert.deepEqual(ranks[6].traits[1], { label: 'Standing', value: 'Highest tier' })
  for (const rank of ranks) {
    const ceiling = rank.traits.find(trait => trait.label === 'Ceiling')
    assert.equal(ceiling?.value, "The ceiling of a mage's power is determined by bloodline purity and training.")
    const melded = rank.traits.find(trait => trait.label === 'Melded magic')
    assert.equal(melded?.value, "Melded magic — the combining of elements — is a known practice among Ge'or's mages.")
    assert.equal(rank.path, '/wiki/World/Systems/Magic Ranks/')
  }
})

test('species traits match vault biology rows', () => {
  const species = templateEntries(entries, 'species-traits')
  assert.equal(species.length, 52)
  const elves = species.find(entry => entry.name === 'Elves')
  assert.equal(elves.traits.find(trait => trait.label === 'Lifespan')?.value, 'Up to 400 years — the longest of the main races')
  assert.match(elves.traits.find(trait => trait.label === 'Magic')?.value ?? '', /^High\./)
  const catmen = species.find(entry => entry.name === 'Catmen')
  assert.equal(catmen.traits.find(trait => trait.label === 'Lifespan')?.value, '65–90 years depending on subrace')
  assert.match(catmen.traits.find(trait => trait.label === 'Magic')?.value ?? '', /^Low\./)
  assert.match(catmen.traits.find(trait => trait.label === 'Traits')?.value ?? '', /Exceptional agility/)
  const snakes = species.find(entry => entry.name === 'Snake People')
  assert.equal(snakes.traits.find(trait => trait.label === 'Lifespan')?.value, '120–150 years')
  assert.match(snakes.traits.find(trait => trait.label === 'Rule')?.value ?? '', /matriarchal monarchy/)
  const dwarves = species.find(entry => entry.name === 'Dwarves')
  assert.match(dwarves.traits.find(trait => trait.label === 'Lifespan')?.value ?? '', /^Up to 200 years/)
  // Sorted by name; files without stat rows (relation essays, hazard notes)
  // keep thin name-only cards that still link out — never invented rows.
  assert.deepEqual(species.map(entry => entry.name), [...species.map(entry => entry.name)].sort((a, b) => a.localeCompare(b)))
  assert.equal(species.filter(entry => entry.traits.some(trait => trait.label === 'Lifespan' || trait.label === 'Magic')).length, 45)
  const zombies = species.find(entry => entry.name === 'Zombies')
  assert.deepEqual(zombies.traits, [])
  assert.doesNotMatch(renderStatblockCard(zombies), /<dl/)
})

test('currencies match the vault currencies table', () => {
  const coins = templateEntries(entries, 'currencies')
  assert.equal(coins.length, 25)
  const erilia = coins.find(entry => entry.name === 'Erilia')
  assert.equal(erilia.traits.find(trait => trait.label === 'Symbol')?.value, 'Ɛ')
  assert.equal(erilia.traits.find(trait => trait.label === 'Region')?.value, 'Central Erisdar')
  assert.match(erilia.traits.find(trait => trait.label === 'Status')?.value ?? '', /Cracking Coin/)
  const ducat = coins.find(entry => entry.name === 'Vennerian Ducat')
  assert.equal(ducat.traits.find(trait => trait.label === 'Symbol')?.value, 'V◊')
  assert.match(ducat.traits.find(trait => trait.label === 'Region')?.value ?? '', /Venner/)
  const jade = coins.find(entry => entry.name === 'Mian Jade')
  assert.equal(jade.traits.find(trait => trait.label === 'Symbol')?.value, 'MJ')
  assert.match(jade.traits.find(trait => trait.label === 'Region')?.value ?? '', /Mia/)
  const krona = coins.find(entry => entry.name === 'Dissenbarg Krona')
  assert.equal(krona.traits.find(trait => trait.label === 'Symbol')?.value, 'DK')
})

test('template switching falls back safely; search narrows by name', () => {
  assert.equal(activeTemplate('species-traits'), 'species-traits')
  assert.equal(activeTemplate('no-such-template'), 'magic-ranks')
  assert.equal(activeTemplate(undefined), 'magic-ranks')
  assert.equal(filterStatblocks(entries, {}).length, 7)
  assert.equal(filterStatblocks(entries, { template: 'currencies' }).length, 25)
  assert.equal(filterStatblocks(entries, { template: 'species-traits' }).length, 52)
  assert.equal(filterStatblocks(entries, { template: 'bogus' }).length, 7)
  const searched = filterStatblocks(entries, { template: 'species-traits', query: 'elve' })
  assert.ok(searched.some(entry => entry.name === 'Elves'))
  assert.ok(searched.every(entry => entry.name.toLowerCase().includes('elve')))
  assert.deepEqual(filterStatblocks(entries, { template: 'currencies', query: 'no such coin' }), [])
  assert.deepEqual(filterStatblocks([], {}), [])
  assert.deepEqual(filterStatblocks([{ name: '' }, { name: '  ' }, null], { template: 'currencies' }), [])
  assert.equal(statblocksSummary(entries, 'magic-ranks'), '7 blocks · Magic Ranks')
  assert.equal(statblocksSummary(entries, 'currencies'), '25 blocks · Currencies')
  assert.equal(statblocksSummary(entries, 'species-traits'), '52 blocks · Species Traits')
})

test('cards link only ^/wiki/ paths; hostile or empty paths render as text', () => {
  const html = renderStatblocks(templateEntries(entries, 'currencies'))
  assert.match(html, /data-statblock="Erilia"/)
  assert.match(html, /href="\/wiki\//)
  assert.match(html, /<dt[^>]*>Symbol<\/dt>/)
  for (const entry of [
    { name: 'Nowhere', traits: [] },
    { name: 'Nowhere Too', path: '', traits: [{ label: 'Tier', value: '1 of 7' }] },
    { name: 'Evil', path: 'javascript:alert(1)', traits: [] },
    { name: 'Offsite', path: 'https://evil.example/wiki/x', traits: [] },
    { name: 'Sneaky', path: '/evil', traits: [] },
  ]) {
    const card = renderStatblockCard(entry)
    assert.doesNotMatch(card, /href="/, entry.name)
    assert.match(card, new RegExp(escapeHtml(entry.name)))
  }
  const hostile = renderStatblockCard({ name: '<img src=x onerror=alert(1)>', path: 'https://evil.example/x', traits: [{ label: '<b>Tier</b>', value: '<script>evil()</script>' }] })
  assert.doesNotMatch(hostile, /<img src=x/)
  assert.doesNotMatch(hostile, /<script>evil/)
  assert.doesNotMatch(hostile, /href="/)
  assert.match(hostile, /&lt;img/)
  assert.match(renderStatblocks([]), /No blocks match/)
})

test('statblocks gate: worker treats page and script as private', () => {
  assert.equal(__test.isPrivatePath('/statblocks'), true)
  assert.equal(__test.isPrivatePath('/statblocks/'), true)
  assert.equal(__test.isPrivatePath('/statblocks.html'), true)
  assert.equal(__test.isPrivatePath('/statblocks.js'), true)
  assert.equal(__test.isPrivatePath('/wiki/statblocks-index.json'), true)
})

test('statblocks gating: anon 302, script 401, authed 200', async () => {
  const html = readFileSync(new URL('../public/statblocks.html', import.meta.url), 'utf8')
  const env = {
    JWT_SECRET: SECRET,
    ASSETS: { fetch: async request => {
      const pathname = new URL(request.url).pathname
      const body = pathname === '/statblocks.html' ? html : pathname
      return new Response(body, { headers: { 'Content-Type': pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/json' } })
    } },
  }
  for (const path of ['/statblocks', '/statblocks/']) {
    const response = await worker.fetch(new Request(`https://worldofgeor.com${path}`, { headers: { Accept: 'text/html' } }), env, {})
    assert.equal(response.status, 302, path)
    assert.match(response.headers.get('location'), /next=%2Fstatblocks/, path)
    assert.equal(response.headers.get('cache-control'), 'no-store', path)
  }
  const gatedScript = await worker.fetch(new Request('https://worldofgeor.com/statblocks.js', { headers: { 'Sec-Fetch-Dest': 'script' } }), env, {})
  assert.equal(gatedScript.status, 401)
  const now = Math.floor(Date.now() / 1000)
  const token = await __test.signJwt({ email: 'keeper@example.com', iss: 'worldofgeor', iat: now, exp: now + 60 }, SECRET)
  const authed = await worker.fetch(new Request('https://worldofgeor.com/statblocks', { headers: { Cookie: `geor_token=${token}`, Accept: 'text/html' } }), env, {})
  assert.equal(authed.status, 200)
  assert.equal(authed.headers.get('cache-control'), 'private, no-store')
  const body = await authed.text()
  assert.match(body, /SYSTEM STATBLOCKS/)
  assert.match(body, /statblocksGrid/)
  assert.match(body, /statblocks\.js/)
})

test('statblocks shell mounts the template switcher, search, and grid while staying noindex', () => {
  const html = readFileSync(new URL('../public/statblocks.html', import.meta.url), 'utf8')
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive" \/>/)
  assert.match(html, /data-template="magic-ranks"/)
  assert.match(html, /data-template="species-traits"/)
  assert.match(html, /data-template="currencies"/)
  assert.match(html, /id="statblocksSearch"/)
  assert.match(html, /id="statblocksGrid"/)
  assert.match(html, /id="statblocksStatus"/)
  assert.match(html, /id="statblocksCount"/)
  assert.match(html, /src="\/statblocks\.js"/)
  assert.match(html, /src="\/archive-compass\.js"/)
  const script = readFileSync(new URL('../public/statblocks.js', import.meta.url), 'utf8')
  assert.match(script, /from '\.\/timeline\.js'/)
  assert.match(script, /isWikiUrl/)
  assert.match(script, /escapeHtml/)
  assert.match(script, /\/wiki\/statblocks-index\.json/)
  const workerSource = readFileSync(new URL('../worker.js', import.meta.url), 'utf8')
  assert.match(workerSource, /\['\/statblocks', '\/statblocks\.html'\]/)
  assert.match(workerSource, /'\/statblocks\.js'/)
  const compass = readFileSync(new URL('../public/archive-compass.js', import.meta.url), 'utf8')
  assert.match(compass, /url: '\/statblocks'/)
  const checkSite = readFileSync(new URL('../scripts/check-site.mjs', import.meta.url), 'utf8')
  assert.match(checkSite, /\['\/statblocks', '\/statblocks\.html'\]/)
})
