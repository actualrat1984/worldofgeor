import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  closestTitle,
  escapeHtml,
  fuzzyWordScore,
  mergeExtra,
  scoreEntry,
  trigramSimilarity,
  trigrams,
} from '../public/search-sources.js'

const wikiIndex = JSON.parse(readFileSync(new URL('../dist/wiki-index.json', import.meta.url), 'utf8'))
const extra = JSON.parse(readFileSync(new URL('../dist/wiki/search-extra-index.json', import.meta.url), 'utf8'))
const searchJs = readFileSync(new URL('../public/search.js', import.meta.url), 'utf8')
const searchHtml = readFileSync(new URL('../public/search.html', import.meta.url), 'utf8')
const sourcesJs = readFileSync(new URL('../public/search-sources.js', import.meta.url), 'utf8')

const GRIMMEL = { title: 'Grimmel Peninsula', url: '/wiki/World/Nations/South Erisdar/Grimmel Peninsula/' }

test('fuzzy match survives transpositions', () => {
  // 'grimmle' is 'grimmel' with the last two letters swapped.
  assert.ok(trigramSimilarity('grimmel', 'grimmle') >= 0.3, 'transposed pair stays similar')
  const hits = wikiIndex.filter(entry => scoreEntry(entry, 'grimmle') >= 0)
  assert.ok(hits.some(entry => entry.title === 'Grimmel Peninsula'), 'transposed query still surfaces the right folio')
  const exact = scoreEntry(GRIMMEL, 'grimmel')
  const typo = scoreEntry(GRIMMEL, 'grimmle')
  assert.ok(exact > typo && typo >= 0, `exact (${exact}) outranks typo (${typo}), typo still matches`)
})

test('fuzzy match survives missing letters', () => {
  const hits = wikiIndex.filter(entry => scoreEntry(entry, 'grimel peninsla') >= 0)
  assert.ok(hits.some(entry => entry.title === 'Grimmel Peninsula'), 'dropped letters still surface the right folio')
  assert.ok(scoreEntry(GRIMMEL, 'grim') >= 0, 'prefix crumbs match')
})

test('exact queries rank exactly as before (fuzzy only fills gaps)', () => {
  assert.ok(scoreEntry(GRIMMEL, 'grimmel peninsula') >= 1000, 'exact title keeps the 1000-point anchor')
  assert.deepEqual(wikiIndex.filter(entry => scoreEntry(entry, 'zzzqqq') >= 0), [], 'pure gibberish still matches nothing')
  assert.deepEqual(mergeExtra([], extra, 'zzzqqq'), [], 'extra index still drops pure gibberish')
})

test('did-you-mean suggests the closest title for a mangled query', () => {
  const suggestion = closestTitle('Grimmle Peninsulla', wikiIndex)
  assert.ok(suggestion, 'mangled query yields a suggestion')
  assert.equal(suggestion.title, 'Grimmel Peninsula')
  // The suggestion is working: re-running it returns results.
  const rerun = wikiIndex.filter(entry => scoreEntry(entry, suggestion.title) >= 0)
  assert.ok(rerun.length > 0, 're-running the suggestion returns results')
  assert.equal(closestTitle('zzzqqq', wikiIndex), null, 'unrelated gibberish suggests nothing')
  assert.equal(closestTitle('x', wikiIndex), null, 'too-short queries suggest nothing')
})

test('did-you-mean is wired into the page (slot, button, re-run)', () => {
  assert.ok(searchHtml.includes('id="didYouMean"'), 'search.html has the suggestion slot')
  assert.ok(searchJs.includes('didYouMean'), 'search.js drives the slot')
  assert.ok(searchJs.includes('Did you mean'), 'zero-result state offers a suggestion')
  assert.ok(searchJs.includes('closestTitle'), 'suggestion uses the local closest-title ranker')
  assert.ok(searchJs.includes('input.value = suggestion.title'), 'suggestion button re-runs the search')
  assert.ok(searchJs.includes('escapeHtml(suggestion.title)'), 'suggestion text is escaped at render')
})

test('full keyboard flow is bound with visible hints', () => {
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) {
    assert.ok(searchJs.includes(key), `search.js handles ${key}`)
  }
  assert.ok(searchJs.includes("event.key === '/'"), "'/' focuses the input from anywhere")
  assert.ok(searchJs.includes('setSelected'), 'arrow keys move the aria-selected row')
  assert.ok(searchJs.includes('aria-selected'), 'selection is exposed to assistive tech')
  assert.ok(searchHtml.includes('to focus') && searchHtml.includes('Enter') && searchHtml.includes('Esc'), 'shortcut hints are visible in the page')
  assert.ok(searchHtml.includes('<kbd'), 'the / key hint is rendered as a kbd')
  assert.ok(searchJs.includes('results capped') || searchJs.includes('slice(0,60)'), 'results stay capped at 60')
})

test('fully local: no fetch added, no remote calls, no new dependencies', () => {
  assert.ok(!sourcesJs.includes('fetch('), 'search-sources.js stays fetch-free')
  const fetches = [...searchJs.matchAll(/fetch\(\s*['"`]([^'"`]+)['"`]/g)].map(match => match[1])
  assert.ok(fetches.length > 0, 'expected the pre-existing local index loads')
  assert.ok(fetches.every(url => url.startsWith('/')), `every fetch stays same-origin: ${fetches.join(', ')}`)
  assert.ok(!searchJs.includes('http://') && !searchJs.includes('https://'), 'no remote URLs in search.js')
  assert.ok(!sourcesJs.includes('http://') && !sourcesJs.includes('https://'), 'no remote URLs in search-sources.js')
})

test('escaping intact on suggestions and hostile titles', () => {
  assert.equal(escapeHtml('<script>alert("pwn")</script>'), '&lt;script&gt;alert(&quot;pwn&quot;)&lt;/script&gt;')
  assert.equal(escapeHtml('Grimmel "Peninsula" <bay>'), 'Grimmel &quot;Peninsula&quot; &lt;bay&gt;')
  const hostile = [
    { title: '<img src=x onerror=alert(1)>', url: '/wiki/World/X/' },
    { title: 'Grimmel Peninsula', url: '/wiki/World/Nations/South Erisdar/Grimmel Peninsula/' },
  ]
  const suggestion = closestTitle('grimmel peninsula', hostile)
  assert.ok(suggestion, 'ranker tolerates hostile rows')
  assert.equal(escapeHtml(suggestion.title), 'Grimmel Peninsula', 'winning suggestion escapes cleanly')
  assert.ok(scoreEntry({ title: '<script>alert(1)</script>', url: '/wiki/World/X/' }, 'script') >= 0, 'hostile rows still score')
  assert.equal(scoreEntry(null, 'grimmel'), -1, 'null entries are rejected')
})
