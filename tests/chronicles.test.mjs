import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import worker, { __test } from '../worker.js'
import {
  eventWikiUrls,
  featureLatLng,
  flattenMapFeatures,
  matchEventToFeature,
  normalizeWikiUrl,
} from '../public/chronicles.js'
import { buildTitleLookup, resolveWikiUrl } from '../public/timeline.js'

const SECRET = 'test-only-secret-that-is-longer-than-32-characters'
const data = JSON.parse(readFileSync(new URL('../dist/wiki/timeline-index.json', import.meta.url), 'utf8'))
const wikiIndex = JSON.parse(readFileSync(new URL('../public/wiki-index.json', import.meta.url), 'utf8'))
const lookup = buildTitleLookup(wikiIndex)

test('normalizeWikiUrl canonicalizes before compare and rejects hostile values', () => {
  assert.equal(normalizeWikiUrl('/wiki/World/Nations/Dissenbarg/'), '/wiki/world/nations/dissenbarg')
  assert.equal(normalizeWikiUrl('/wiki/World/Nations/Dissenbarg'), '/wiki/world/nations/dissenbarg')
  assert.equal(normalizeWikiUrl('/wiki/World/My%20Place/'), '/wiki/world/my place')
  assert.equal(normalizeWikiUrl('/wiki/World//Double///Slash/'), '/wiki/world/double/slash')
  for (const bad of [
    'javascript:alert(1)',
    'https://evil.example/wiki/World/Nations/Dissenbarg/',
    '/evil',
    '/wiki',
    '/wiki/',
    '/wiki/../secret',
    '/wiki/World\\Nations',
    '',
    null,
    undefined,
    42,
    { url: '/wiki/World/Nations/Dissenbarg/' },
  ]) {
    assert.equal(normalizeWikiUrl(bad), null, String(bad))
  }
})

test('matchEventToFeature matches, normalizes, takes the first win, else null', () => {
  const features = [
    { id: 'marker_aaaaaa', type: 'marker', name: 'Dissenbarg', wikiUrl: '/wiki/World/Nations/Dissenbarg/Dissenbarg/', point: { lat: 420, lng: 840 } },
    { id: 'marker_bbbbbb', type: 'marker', name: 'Dissenbarg copy', wikiUrl: '/wiki/World/Nations/Dissenbarg/Dissenbarg/', point: { lat: 100, lng: 100 } },
    { id: 'marker_cccccc', type: 'marker', name: 'Kobre', wikiUrl: '/wiki/World/Nations/Kobre/Kobre/', point: { lat: 200, lng: 300 } },
  ]
  // Exact match, first wins.
  assert.equal(matchEventToFeature({ wikiUrl: '/wiki/World/Nations/Dissenbarg/Dissenbarg/' }, features), features[0])
  // Trailing slash / case / %20 normalized before compare.
  assert.equal(
    matchEventToFeature({ wikiUrls: ['/wiki/World/Nations/Kobre/Kobre'] }, features),
    features[2],
  )
  assert.equal(
    matchEventToFeature({ url: '/wiki/WORLD/Nations/Kobre/Kobre/' }, features),
    features[2],
  )
  // No candidates, unknown article, empty overlay: honest null, never invented.
  assert.equal(matchEventToFeature({ wikiUrl: '/wiki/World/Nations/Nowhere/' }, features), null)
  assert.equal(matchEventToFeature({ date: '597 AGD', event: 'Nothing mappable happened.' }, features), null)
  assert.equal(matchEventToFeature({ wikiUrl: '/wiki/World/Nations/Dissenbarg/Dissenbarg/' }, []), null)
  assert.equal(matchEventToFeature(null, features), null)
  assert.equal(matchEventToFeature({ wikiUrl: '/wiki/World/Nations/Dissenbarg/Dissenbarg/' }, null), null)
})

test('hostile wikiUrl values never match and never render as links', () => {
  const hostileFeatures = [
    { id: 'marker_xxxxxx', type: 'marker', name: 'Evil', wikiUrl: 'javascript:alert(1)', point: { lat: 1, lng: 1 } },
    { id: 'marker_yyyyyy', type: 'marker', name: 'Offsite', wikiUrl: 'https://evil.example/wiki/x', point: { lat: 2, lng: 2 } },
    { id: 'marker_zzzzzz', type: 'marker', name: 'Traversal', wikiUrl: '/wiki/../secret', point: { lat: 3, lng: 3 } },
  ]
  const legit = { id: 'marker_okokok', type: 'marker', name: 'Dissenbarg', wikiUrl: '/wiki/World/Nations/Dissenbarg/Dissenbarg/', point: { lat: 420, lng: 840 } }
  const features = [...hostileFeatures, legit]
  // Hostile event-side URLs are dropped by the ^/wiki/ gate: no match.
  assert.equal(matchEventToFeature({ wikiUrl: 'javascript:alert(1)' }, features), null)
  assert.equal(matchEventToFeature({ wikiUrls: ['https://evil.example/wiki/x', '/evil'] }, features), null)
  // Hostile feature-side URLs normalize to null: never the first win.
  assert.equal(matchEventToFeature({ wikiUrl: '/wiki/World/Nations/Dissenbarg/Dissenbarg/' }, features), legit)
  // Hostile lookup values never surface as event URLs.
  const hostileLookup = new Map([['evil', 'javascript:alert(1)'], ['offsite', 'https://evil.example/']])
  assert.deepEqual(eventWikiUrls({ event: 'See [[evil]] and [[offsite]] now' }, hostileLookup), [])
  assert.equal(resolveWikiUrl('anything', hostileLookup), null)
})

test('eventWikiUrls resolves [[Name]] and bare [[Name fragments, unknowns to nothing', () => {
  assert.deepEqual(
    eventWikiUrls({ event: 'Rise of [[Dissenbarg]] remembered' }, buildTitleLookup([
      { title: 'Dissenbarg', url: '/wiki/World/Nations/Dissenbarg/Dissenbarg/' },
    ])),
    ['/wiki/World/Nations/Dissenbarg/Dissenbarg/'],
  )
  // Unclosed fragment (the shape generate_timeline.py leaves behind).
  const urls = eventWikiUrls({ event: 'Impact triggers body bags in [[The 157th Colony' }, lookup)
  assert.equal(urls.length, 1)
  assert.match(urls[0], /^\/wiki\//)
  assert.deepEqual(eventWikiUrls({ event: 'Nothing mappable happened.' }, lookup), [])
  assert.deepEqual(eventWikiUrls({ event: 'See [[No Such Place Anywhere]] today' }, lookup), [])
  assert.deepEqual(eventWikiUrls(null, lookup), [])
  assert.deepEqual(eventWikiUrls({ event: 'See [[Dissenbarg]]' }, new Map()), [])
})

test('live join: every resolvable event maps to its own pin; the rest stay honestly unmapped', () => {
  assert.equal(data.events.length, 71)
  const withLookup = data.events.map(event => ({ ...event, __lookup: lookup }))
  const resolvable = withLookup.filter(event => eventWikiUrls(event, lookup).length > 0)
  assert.equal(resolvable.length, 10)
  // Fixture overlay holding one pin per resolvable wiki URL.
  const seen = new Set()
  const features = []
  for (const event of resolvable) {
    for (const url of eventWikiUrls(event, lookup)) {
      const key = normalizeWikiUrl(url)
      if (key && !seen.has(key)) {
        seen.add(key)
        features.push({ id: `marker_${String(features.length).padStart(6, '0')}`, type: 'marker', name: url, wikiUrl: url, point: { lat: 100 + features.length, lng: 200 + features.length } })
      }
    }
  }
  let mapped = 0
  for (const event of withLookup) {
    if (matchEventToFeature(event, features)) mapped++
  }
  assert.equal(mapped, resolvable.length)
  const unmapped = data.events.length - mapped
  assert.equal(unmapped, 61)
  // Empty live overlay (fresh D1, no map_documents yet): all 71 unmapped.
  assert.equal(withLookup.filter(event => matchEventToFeature(event, [])).length, 0)
})

test('flattenMapFeatures and featureLatLng honor the /api/maps/:slug shapes', () => {
  const payload = {
    map: {
      version: 1, slug: 'world', title: 'Keeper Atlas',
      layers: [{ id: 'political', name: 'Political', features: [
        { id: 'marker_123456', type: 'marker', name: 'Dissenbarg', wikiUrl: '/wiki/World/', point: { lat: 420, lng: 840 } },
        { id: 'poly_1234567', type: 'polygon', name: 'Bay', wikiUrl: '/wiki/World/Seas/', points: [{ lat: 10, lng: 20 }, { lat: 30, lng: 40 }, { lat: 50, lng: 60 }] },
      ] }],
    },
  }
  const flat = flattenMapFeatures(payload, 'world')
  assert.equal(flat.length, 2)
  assert.equal(flat[0].__slug, 'world')
  assert.deepEqual(featureLatLng(flat[0]), [420, 840])
  assert.deepEqual(featureLatLng(flat[1]), [10, 20])
  assert.equal(featureLatLng({ type: 'marker' }), null)
  assert.equal(featureLatLng({ point: { lat: 'x', lng: 1 } }), null)
  assert.equal(featureLatLng(null), null)
  assert.deepEqual(flattenMapFeatures({ map: null }, 'world'), [])
  assert.deepEqual(flattenMapFeatures(null), [])
})

test('chronicles helpers reuse timeline.js — no duplicated core', () => {
  const script = readFileSync(new URL('../public/chronicles.js', import.meta.url), 'utf8')
  assert.match(script, /from '\.\/timeline\.js'/)
  assert.match(script, /dateToScalar/)
  assert.match(script, /isWikiUrl/)
  assert.doesNotMatch(script, /function dateToScalar/)
  assert.doesNotMatch(script, /function isWikiUrl/)
  assert.doesNotMatch(script, /function resolveWikiUrl/)
})

test('chronicles shell: scrubber, card, map, unmapped list, noindex, compass', () => {
  const html = readFileSync(new URL('../public/chronicles.html', import.meta.url), 'utf8')
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive" \/>/)
  assert.match(html, /id="chronScrub"/)
  assert.match(html, /id="chronCard"/)
  assert.match(html, /id="chronMap"/)
  assert.match(html, /id="chronUnmapped"/)
  assert.match(html, /id="chronStatus"/)
  assert.match(html, /src="\/chronicles\.js"/)
  assert.match(html, /src="\/archive-compass\.js"/)
  assert.match(html, /leaflet@1\.9\.4\/dist\/leaflet\.js/)
  assert.match(html, /CRS\.Simple|crs:L\.CRS\.Simple|chronMap/)
  const script = readFileSync(new URL('../public/chronicles.js', import.meta.url), 'utf8')
  assert.match(script, /\/wiki\/timeline-index\.json/)
  assert.match(script, /\/api\/maps\/world/)
  assert.match(script, /unmapped/)
  const compass = readFileSync(new URL('../public/archive-compass.js', import.meta.url), 'utf8')
  assert.match(compass, /url: '\/chronicles'/)
  const checkSite = readFileSync(new URL('../scripts/check-site.mjs', import.meta.url), 'utf8')
  assert.match(checkSite, /\['\/chronicles', '\/chronicles\.html'\]/)
})

test('chronicles gating mirrors timeline: anon 302, script 401, authed 200', async () => {
  assert.equal(__test.isPrivatePath('/chronicles'), true)
  assert.equal(__test.isPrivatePath('/chronicles/'), true)
  assert.equal(__test.isPrivatePath('/chronicles.html'), true)
  assert.equal(__test.isPrivatePath('/chronicles.js'), true)
  const html = readFileSync(new URL('../public/chronicles.html', import.meta.url), 'utf8')
  const env = {
    JWT_SECRET: SECRET,
    ASSETS: { fetch: async request => {
      const pathname = new URL(request.url).pathname
      const body = pathname === '/chronicles.html' ? html : pathname
      return new Response(body, { headers: { 'Content-Type': pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/json' } })
    } },
  }
  for (const path of ['/chronicles', '/chronicles/']) {
    const response = await worker.fetch(new Request(`https://worldofgeor.com${path}`, { headers: { Accept: 'text/html' } }), env, {})
    assert.equal(response.status, 302, path)
    assert.match(response.headers.get('location'), /next=%2Fchronicles/, path)
    assert.equal(response.headers.get('cache-control'), 'no-store', path)
  }
  const gatedScript = await worker.fetch(new Request('https://worldofgeor.com/chronicles.js', { headers: { 'Sec-Fetch-Dest': 'script' } }), env, {})
  assert.equal(gatedScript.status, 401)
  const now = Math.floor(Date.now() / 1000)
  const token = await __test.signJwt({ email: 'keeper@example.com', iss: 'worldofgeor', iat: now, exp: now + 60 }, SECRET)
  const authed = await worker.fetch(new Request('https://worldofgeor.com/chronicles', { headers: { Cookie: `geor_token=${token}`, Accept: 'text/html' } }), env, {})
  assert.equal(authed.status, 200)
  assert.equal(authed.headers.get('cache-control'), 'private, no-store')
  const body = await authed.text()
  assert.match(body, /CHRONICLES/)
  assert.match(body, /chronScrub/)
  assert.match(body, /chronicles\.js/)
})
