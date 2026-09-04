// Wave G3 — sw.js offline page cache: pure predicate + privacy gate.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import '../public/sw.js'
import { __test } from '../worker.js'

const { shouldCachePage } = globalThis
const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

test('sw.js shell version bumped and runtime cache capped', () => {
  assert.match(source, /geor-shell-v2/)
  assert.match(source, /geor-pages-v1/)
  assert.match(source, /120/)
  assert.doesNotMatch(source, /^export\s/m)
})

test('shouldCachePage caches wiki paths', () => {
  for (const path of ['/wiki', '/wiki/', '/wiki/World/Nations/', '/wiki/World/Nations/Dissenbarg/Dissenbarg/']) {
    assert.equal(shouldCachePage(path), true, path)
  }
})

test('shouldCachePage caches every reader root', () => {
  for (const root of ['/timeline', '/chronicles', '/atlas', '/gazetteer', '/trees', '/webs', '/gallery', '/oracle', '/notebook', '/boards', '/manuscripts', '/arcs', '/quests', '/primer', '/desk', '/statblocks', '/calendar', '/audio', '/search']) {
    assert.equal(shouldCachePage(root), true, root)
    assert.equal(shouldCachePage(`${root}/`), true, `${root}/`)
    assert.equal(shouldCachePage(`${root}/some-folio`), true, `${root}/some-folio`)
  }
})

test('shouldCachePage never caches /api/ or non-GET', () => {
  for (const path of ['/api/me', '/api/login', '/api/additions', '/api/']) {
    assert.equal(shouldCachePage(path), false, path)
  }
  assert.equal(shouldCachePage('/wiki/World/', 'POST'), false)
  assert.equal(shouldCachePage('/timeline', 'POST'), false)
  assert.equal(shouldCachePage('/wiki/World/', 'DELETE'), false)
})

test('shouldCachePage strips query/hash and rejects non-pages', () => {
  assert.equal(shouldCachePage('/wiki/World/?view=wide'), true)
  assert.equal(shouldCachePage('/timeline#today'), true)
  for (const bad of ['/', '/login', '/sw.js', '/site.css', '/wik', '/wiki-evidence', '/timelines', '', null, undefined, 42, 'https://evil.example/wiki/World/']) {
    assert.equal(shouldCachePage(bad), false, String(bad))
  }
})

test('service worker itself stays public', () => {
  assert.equal(__test.isPrivatePath('/sw.js'), false)
})
