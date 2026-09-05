import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')

// Wave H H5 — landing CTA hierarchy (one solid-gold primary: Request Access),
// rooms-first hero, and locked members-only teasers. No new network calls.
const index = read('index.html')
const hero = (index.match(/<section id="top"[\s\S]*?<\/section>/) || [])[0]
assert.ok(hero, 'landing keeps its #top hero section')
const teasers = (index.match(/<section id="teasers"[\s\S]*?<\/section>/) || [])[0]
assert.ok(teasers, 'landing keeps its #teasers section')

// Solid gold = bare `bg-gold` or `from-gold` on a link/button class
// (excludes gold/10 washes, gold/[...] gradients, border-gold, text-gold).
const SOLID_GOLD = /<(?:a|button)\b[^>]*class="[^"]*(?:bg-gold[ "']|from-gold[ "'])[^"]*"/g
const solidsIn = (markup) => [...markup.matchAll(SOLID_GOLD)].map((m) => m[0])

test('hero has exactly one solid-gold primary: Request Access', () => {
  const solids = solidsIn(hero)
  assert.equal(solids.length, 1, `hero has exactly one solid-gold primary, found: ${solids.join(' | ')}`)
  assert.ok(hero.includes('Request Access'), 'the hero primary is Request Access')
  assert.ok(/<button[^>]*id="heroRequestBtn"/.test(hero), 'the hero primary is a real button wired to the request modal')
  assert.ok(index.includes("getElementById('heroRequestBtn')"), 'heroRequestBtn opens the existing request modal')
})

test('Member Sign In is quiet (text link, no solid or outline button)', () => {
  const match = hero.match(/<(?:a|button)\b[^>]*id="openExplore"[^>]*>/)
  assert.ok(match, 'hero keeps the #openExplore sign-in control')
  assert.ok(!/(bg-gold|from-gold)[ "']/.test(match[0]), 'sign-in carries no solid-gold fill')
  assert.ok(!/border[ "']/.test(match[0]) && !match[0].includes('border-'), 'sign-in carries no outline-button border')
})

test('tour anchor to #start survives in the hero (tertiary)', () => {
  assert.ok(hero.includes('href="/#start"'), 'hero keeps a tour anchor to #start')
  assert.ok(hero.includes('Begin with Ge'), 'hero keeps the Begin with Ge\u2019or tour label')
})

test('rooms strip leads with quiet Atlas/Timeline/Gallery/Audio links', () => {
  const nav = (hero.match(/<nav[^>]*aria-label="Archive rooms"[\s\S]*?<\/nav>/) || [])[0]
  assert.ok(nav, 'hero has an Archive rooms strip')
  for (const href of ['href="/#atlas"', 'href="/#history"', 'href="/#gallery"', 'href="/audio"']) {
    assert.ok(nav.includes(href), `rooms strip links ${href}`)
  }
  assert.equal(solidsIn(nav).length, 0, 'rooms strip links are quiet (no solid-gold)')
})

test('three locked teasers reuse the public panel images with lock overlay', () => {
  const cards = [...teasers.matchAll(/<div[^>]*data-locked-teaser="([^"]+)"[\s\S]*?(?=<div[^>]*data-locked-teaser|<\/div>\s*<\/section>)/g)]
  assert.equal(cards.length, 3, `three locked teasers, found: ${cards.length}`)
  for (const panel of ['erisia', 'kobre', 'lumina']) {
    assert.ok(teasers.includes(`data-locked-teaser="${panel}"`), `teaser covers ${panel}`)
    assert.ok(teasers.includes(`src="/panel-${panel}.jpg"`), `teaser reuses the public /panel-${panel}.jpg image`)
  }
  const locks = [...teasers.matchAll(/class="teaser-lock[^"]*"/g)]
  assert.equal(locks.length, 3, 'every teaser carries a lock overlay')
  assert.equal((teasers.match(/members only/gi) || []).length >= 3, true, 'every teaser says Members only')
  const signins = [...teasers.matchAll(/data-open-auth="login"/g)]
  assert.equal(signins.length, 3, 'every teaser links to sign-in via the existing auth modal')
  assert.ok(teasers.includes('blur-sm'), 'teaser images sit behind a blur')
})

test('zero new fetch/XHR on landing (static img tags only)', () => {
  assert.ok(!teasers.includes('fetch('), 'teasers add no fetch calls')
  assert.ok(!teasers.includes('XMLHttpRequest'), 'teasers add no XHR')
  assert.ok(!hero.includes('fetch('), 'hero adds no fetch calls')
  const endpoints = [...index.matchAll(/fetch\(\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1])
  const allowed = ['/api/me', '/api/login', '/api/register', '/api/request-access', '/api/logout']
  const strays = endpoints.filter((url) => !allowed.includes(url))
  assert.deepEqual(strays, [], `no new fetch endpoints on landing, found: ${strays.join(', ') || 'none'}`)
  assert.ok(!index.includes('XMLHttpRequest'), 'no XHR anywhere on landing')
})
