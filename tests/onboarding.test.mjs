import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ONBOARDING_STEPS,
  escapeHtml,
  isLastStep,
  isTourComplete,
  markTourComplete,
  memberId,
  renderTourCard,
  shouldShowTour,
  startTour,
  storageLabel,
  storageSupported,
  tourBack,
  tourComplete,
  tourNext,
  tourSkip,
  tourStep,
  tourStorageKey,
} from '../public/onboarding.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'public/onboarding.js'), 'utf8')

function fakeStore() {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
  }
}

test('tour has five ordered steps: compass, rooms, reveals, primer, first action', () => {
  assert.equal(ONBOARDING_STEPS.length, 5)
  assert.deepEqual(ONBOARDING_STEPS.map(step => step.id), ['compass', 'rooms', 'reveals', 'primer', 'first-action'])
  for (const step of ONBOARDING_STEPS) {
    for (const field of ['id', 'title', 'body', 'target']) {
      assert.equal(typeof step[field], 'string', `${step.id} needs a ${field} string`)
      assert.ok(step[field].length > 0, `${step.id} needs a non-empty ${field}`)
    }
  }
})

test('machine completes all five steps in order', () => {
  let state = startTour()
  assert.equal(state.index, 0)
  const visited = [tourStep(state).id]
  while (!state.done) {
    state = tourNext(state)
    if (!state.done) visited.push(tourStep(state).id)
  }
  assert.deepEqual(visited, ['compass', 'rooms', 'reveals', 'primer', 'first-action'])
  assert.equal(state.done, true)
  assert.equal(isLastStep({ index: 4 }), true)
  assert.equal(isLastStep({ index: 0 }), false)
})

test('back never leaves the first step, skip dismisses without completing', () => {
  assert.equal(tourBack(startTour()).index, 0)
  let state = startTour()
  state = tourNext(state)
  state = tourNext(state)
  assert.equal(tourStep(state).id, 'reveals')
  assert.equal(tourStep(tourBack(state)).id, 'rooms')
  const skipped = tourSkip(state)
  assert.equal(skipped.dismissed, true)
  assert.equal(skipped.done, false)
  const finished = tourComplete(startTour())
  assert.equal(finished.done, true)
  assert.equal(finished.dismissed, false)
})

test('completion round-trips per member and stays invisible across members', () => {
  const store = fakeStore()
  assert.equal(isTourComplete(store, 'arcady@example.com'), false)
  assert.equal(markTourComplete(store, 'arcady@example.com'), true)
  assert.equal(isTourComplete(store, 'arcady@example.com'), true)
  assert.equal(isTourComplete(store, 'mikhail@example.com'), false)
  assert.notEqual(tourStorageKey('arcady@example.com'), tourStorageKey('mikhail@example.com'))
  assert.ok(tourStorageKey('arcady@example.com').startsWith('geor.tour.'))
  assert.equal(memberId({ email: '  Arcady@Example.com ' }), 'arcady@example.com')
})

test('shouldShowTour greets first logins only', () => {
  assert.equal(shouldShowTour('', { store: fakeStore() }), false)
  assert.equal(shouldShowTour(null, { store: fakeStore() }), false)
  assert.equal(shouldShowTour('arcady@example.com', { store: fakeStore() }), true)
  assert.equal(shouldShowTour('arcady@example.com', { store: fakeStore(), seen: true }), false)
  assert.equal(shouldShowTour('arcady@example.com', { store: fakeStore(), dismissed: true }), false)
  const store = fakeStore()
  markTourComplete(store, 'arcady@example.com')
  assert.equal(shouldShowTour('arcady@example.com', { store }), false)
  assert.equal(shouldShowTour('mikhail@example.com', { store }), true)
})

test('storage labels stay device-honest', () => {
  assert.equal(storageSupported(fakeStore()), true)
  assert.equal(storageSupported(null), false)
  assert.equal(storageSupported({}), false)
  assert.equal(storageLabel(true), 'Remember on this device')
  assert.ok(storageLabel(false).includes('cannot remember'))
})

test('every step target route exists in the check-site alias map', () => {
  const checker = fs.readFileSync(path.join(root, 'scripts/check-site.mjs'), 'utf8')
  const keys = new Set([...checker.matchAll(/\['([^']+)',\s*'[^']*'\]/g)].map(match => match[1]))
  assert.ok(keys.size > 0, 'alias map should parse')
  for (const step of ONBOARDING_STEPS) {
    assert.ok(keys.has(step.target), `${step.id} target ${step.target} is not in the alias map`)
  }
})

test('hostile copy is escaped, never raw', () => {
  const html = renderTourCard({
    id: 'x"><script>alert(1)</script>',
    title: '<img src=x onerror=alert(1)>',
    body: '</div><script>alert(2)</script>',
    target: '/search',
  }, 0, 5)
  assert.ok(!html.includes('<img'), 'raw img tag leaked')
  assert.ok(!html.includes('<script'), 'raw script tag leaked')
  assert.ok(html.includes('&lt;img'), 'title not escaped')
  assert.ok(html.includes('&lt;script'), 'body not escaped')
  assert.ok(html.includes('STEP 1 OF 5'), 'progress counter missing')
  assert.ok(html.includes('href="/search"'), 'room link missing')
  assert.equal(escapeHtml('<b>bold</b> & "quoted"'), '&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;')
})

test('no fetch calls and no new endpoints', () => {
  assert.ok(!source.includes('fetch('), 'tour must not fetch')
  assert.ok(!source.includes('/api/'), 'tour must not call API routes')
  for (const token of ['XMLHttpRequest', 'WebSocket', 'EventSource']) {
    assert.ok(!source.includes(token), `tour must not use ${token}`)
  }
})
