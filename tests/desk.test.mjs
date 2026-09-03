// Wave F3: author's desk — composite command view over existing endpoints.
// No new API: the desk aggregates /api/notes, /api/arcs, /api/threads?arc=,
// /api/primer, and /wiki/timeline-index.json client-side. Tests verify the
// member gate, the page shell, pure renderers (escaped + degrading), and
// that one panel's 401 never sinks the other three.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import worker, { __test } from '../worker.js'
import {
  panelError,
  renderArcsPanel,
  renderDesk,
  renderNotesPanel,
  renderPrimerPanel,
  renderTimelinePanel,
  summarizeArcs,
  summarizeNotes,
  summarizePrimer,
  summarizeTimeline,
} from '../public/desk.js'

const SECRET = 'test-only-secret-that-is-longer-than-32-characters'

function deskEnv() {
  return {
    JWT_SECRET: SECRET,
    DB: { prepare: () => { throw new Error('desk gate tests never reach D1') } },
    ASSETS: { fetch: async () => new Response('desk-shell', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) },
  }
}

const anonDesk = () => new Request('https://worldofgeor.com/desk')
const anonDeskJs = () => new Request('https://worldofgeor.com/desk.js', {
  headers: { Accept: 'application/json' },
})

test('desk: page and script sit behind the member gate', async () => {
  for (const route of ['/desk', '/desk/', '/desk.html', '/desk.js']) {
    assert.equal(__test.isPrivatePath(route), true, route)
  }
  const env = deskEnv()
  assert.equal((await worker.fetch(anonDesk(), env, {})).status, 302)
  assert.equal((await worker.fetch(anonDeskJs(), env, {})).status, 401)
})

test('desk: shell carries every panel, quick links, and the archive shell', () => {
  const html = readFileSync(path.join(import.meta.dirname, '..', 'public', 'desk.html'), 'utf8')
  for (const id of ['deskNotes', 'deskArcs', 'deskTimeline', 'deskPrimer', 'deskStatus']) {
    assert.match(html, new RegExp(`id="${id}"`), `panel ${id} present`)
  }
  for (const link of ['/manuscripts', '/notebook', '/boards', '/arcs', '/oracle', '/timeline', '/primer']) {
    assert.ok(html.includes(`href="${link}"`), `quick path ${link} reachable`)
  }
  assert.match(html, /noindex, nofollow, noarchive/)
  assert.ok(html.includes('<script type="module" src="/desk.js">'))
  assert.ok(html.includes('<script type="module" src="/archive-compass.js">'))
})

test('desk: notes panel escapes and summarizes', () => {
  const notes = [
    { id: 1, title: '<script>alert(1)</script>', body: 'a & b', checklist: [{ text: 'one', done: false }, { text: 'two', done: true }] },
    { id: 2, title: 'Second', body: '', checklist: [] },
  ]
  assert.deepEqual(summarizeNotes(notes), { total: 2, open: 1 })
  const html = renderNotesPanel(notes, null)
  assert.equal(html.includes('<script>'), false)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /2 NOTES · 1 OPEN ITEM/)
  assert.match(html, /href="\/notebook"/)
  assert.match(renderNotesPanel([], null), /write the first one/)
})

test('desk: arcs panel escapes and counts open threads', () => {
  const arcs = [{ id: 'a1', title: 'War of "Thorns"', status: 'active' }]
  const counts = { a1: { total: 3, open: 2 } }
  assert.deepEqual(summarizeArcs(arcs, counts), { total: 1, open: 2 })
  const html = renderArcsPanel(arcs, counts, null)
  assert.match(html, /War of &quot;Thorns&quot;/)
  assert.match(html, /ACTIVE/)
  assert.match(html, /2 OF 3 THREADS OPEN/)
  assert.match(renderArcsPanel([], {}, null), /crown the first one/)
})

test('desk: timeline panel reads the current era without leaking events', () => {
  const timeline = { present_year: '412 AGD', ages: [{ age: 'First Dawn' }, { age: 'The Crash' }], events: [{}, {}, {}] }
  assert.deepEqual(summarizeTimeline(timeline), { ages: 2, events: 3, presentYear: '412 AGD' })
  const html = renderTimelinePanel(timeline, null)
  assert.match(html, /PRESENT DAY · 412 AGD/)
  assert.match(html, /3 dated events · 2 ages/)
})

test('desk: primer panel reports seals opened, never ids', () => {
  assert.deepEqual(summarizePrimer({ revealed: ['a', 'b'], count: 2 }), { revealed: 2, total: null })
  const html = renderPrimerPanel({ revealed: ['aelis-true-name'], count: 1 }, null)
  assert.match(html, /1 seal opened/)
  assert.equal(html.includes('aelis-true-name'), false)
  assert.match(renderPrimerPanel({ revealed: [], count: 0 }, null), /open the primer/)
})

test('desk: one panel’s 401 degrades alone — the rest still render', () => {
  const panels = renderDesk({
    notes: null, notesError: 'unauthorized',
    arcs: [{ id: 'a1', title: 'Ember Arc', status: 'active' }], arcsError: null,
    threadCounts: { a1: { total: 1, open: 1 } },
    timeline: null, timelineError: 'The chronicle could not be opened.',
    primer: { revealed: ['x'], count: 1 }, primerError: null,
  })
  assert.match(panels.notes, /Sign in to open the notebook/)
  assert.match(panels.arcs, /Ember Arc/)
  assert.match(panels.timeline, /chronicle could not be opened/)
  assert.match(panels.primer, /1 seal opened/)
  assert.equal(panelError('<b>x</b>').includes('<b>'), false)
})
