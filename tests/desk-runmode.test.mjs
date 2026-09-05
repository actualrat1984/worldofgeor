// Wave H15: DM run-mode — fullscreen toggle, keyboard map, and the three new
// desk panels (secrets, pins, oracle). No new endpoints: secrets reuses the
// /api/primer shape, pins reuses the atlas-chain.js gated pin-count pattern
// over /wiki/secrets-index.json, oracle is a deep link to exactly /oracle.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  DESK_PANEL_ORDER,
  exitRunMode,
  fullscreenSupported,
  isRunMode,
  renderDesk,
  renderOraclePanel,
  renderPinsPanel,
  renderSecretsPanel,
  requestRunMode,
  routeDeskKey,
  runModeButtonLabel,
  summarizePins,
  summarizeSecrets,
} from '../public/desk.js'

const deskSource = readFileSync(path.join(import.meta.dirname, '..', 'public', 'desk.js'), 'utf8')
const deskHtml = readFileSync(path.join(import.meta.dirname, '..', 'public', 'desk.html'), 'utf8')

test('run-mode: fullscreen support is detected honestly, never throws', () => {
  assert.equal(fullscreenSupported(null), false)
  assert.equal(fullscreenSupported(undefined), false)
  assert.equal(fullscreenSupported({}), false)
  assert.equal(fullscreenSupported({ documentElement: {} }), false)
  assert.equal(fullscreenSupported({ documentElement: {}, fullscreenEnabled: false }), false)
  assert.equal(fullscreenSupported({ documentElement: { requestFullscreen() {} } }), true)
  assert.equal(fullscreenSupported({ documentElement: { requestFullscreen() {} }, fullscreenEnabled: false }), false)
  assert.equal(runModeButtonLabel(true), 'Enter run mode (F)')
  assert.equal(runModeButtonLabel(false), 'Run mode unavailable on this device')
})

test('run-mode: request/exit fullscreen degrades gracefully off-device', () => {
  let requested = 0
  let exited = 0
  const good = {
    documentElement: { requestFullscreen() { requested += 1 } },
    fullscreenElement: null,
    exitFullscreen() { exited += 1 },
  }
  assert.equal(requestRunMode(good), true)
  assert.equal(requested, 1)
  assert.equal(isRunMode(good), false)
  assert.equal(exitRunMode(good), false)
  good.fullscreenElement = {}
  assert.equal(isRunMode(good), true)
  assert.equal(exitRunMode(good), true)
  assert.equal(exited, 1)
  assert.equal(requestRunMode(null), false)
  assert.equal(requestRunMode({}), false)
  assert.equal(exitRunMode(null), false)
  assert.equal(exitRunMode({ fullscreenElement: {} }), false)
  assert.equal(requestRunMode({ documentElement: { requestFullscreen() { throw new Error('no screen') } } }), false)
  assert.equal(exitRunMode({ fullscreenElement: {}, exitFullscreen() { throw new Error('stuck') } }), false)
})

test('run-mode: keyboard map jumps panels, toggles help, never traps input', () => {
  assert.deepEqual(DESK_PANEL_ORDER, ['deskNotes', 'deskArcs', 'deskTimeline', 'deskPrimer', 'deskSecrets', 'deskPins', 'deskOracle'])
  const jumps = ['1', '2', '3', '4', '5', '6', '7']
  jumps.forEach((key, index) => {
    assert.deepEqual(routeDeskKey(key), { action: 'jump', target: DESK_PANEL_ORDER[index] }, `key ${key}`)
  })
  assert.deepEqual(routeDeskKey('f'), { action: 'runmode' })
  assert.deepEqual(routeDeskKey('F'), { action: 'runmode' })
  assert.deepEqual(routeDeskKey('?'), { action: 'help' })
  assert.deepEqual(routeDeskKey('Escape'), { action: 'exit' })
  for (const key of ['0', '8', 'x', '', 'Enter', ' ', null, undefined, 49]) {
    assert.equal(routeDeskKey(key), null, `key ${String(key)} is unbound`)
  }
})

test('run-mode: secrets panel counts seals, never reveals ids', () => {
  assert.deepEqual(summarizeSecrets({ revealed: ['a', 'b'], count: 2 }), { revealed: 2 })
  assert.deepEqual(summarizeSecrets({ revealed: ['a'] }), { revealed: 1 })
  assert.deepEqual(summarizeSecrets(null), { revealed: 0 })
  const hostile = renderSecretsPanel({ revealed: ['<script>alert(1)</script>', 'aelis-true-name'], count: 2 }, null)
  assert.equal(hostile.includes('<script>'), false)
  assert.equal(hostile.includes('alert(1)'), false)
  assert.equal(hostile.includes('aelis-true-name'), false)
  assert.match(hostile, /2 seals opened/)
  assert.match(hostile, /href="\/primer"/)
  assert.match(renderSecretsPanel({ revealed: [], count: 0 }, null), /open the primer/)
  assert.match(renderSecretsPanel(null, 'unauthorized'), /Sign in to open your sealed lore/)
  assert.equal(renderSecretsPanel(null, '<b>x</b>').includes('<b>'), false)
})

test('run-mode: pins panel counts through the atlas gate, drops hostile keys', () => {
  const index = {
    '/wiki/aelis': 2,
    '/wiki/grimmel': 1,
    '<img src=x onerror=alert(1)>': 9,
    '/evil': 9,
    '/wiki-secrets': 4,
    '/wiki/empty': 0,
    '/wiki/nope': 'many',
  }
  assert.deepEqual(summarizePins(index), { articles: 2, passages: 3 })
  assert.deepEqual(summarizePins(null), { articles: 0, passages: 0 })
  assert.deepEqual(summarizePins([]), { articles: 0, passages: 0 })
  const html = renderPinsPanel(index, null)
  assert.equal(html.includes('<img'), false)
  assert.equal(html.includes('alert(1)'), false)
  assert.equal(html.includes('/evil'), false)
  assert.match(html, /3 hidden passages/)
  assert.match(html, /ACROSS 2 ARTICLES/)
  assert.match(html, /href="\/map-editor"/)
  assert.match(renderPinsPanel({}, null), /open Atlas Studio/)
  assert.match(renderPinsPanel(null, 'unauthorized'), /Sign in to open the atlas/)
  assert.equal(renderPinsPanel(null, '<b>x</b>').includes('<b>'), false)
})

test('run-mode: oracle panel links exactly /oracle, fetches nothing', () => {
  const html = renderOraclePanel()
  assert.ok(html.includes('href="/oracle"'), 'deep link is exactly /oracle')
  assert.equal(html.includes('/oracle/'), false)
  assert.equal(html.includes('/oracle?'), false)
  assert.equal(html.includes('fetch'), false)
})

test('run-mode: desk.js adds no fetch URL beyond the existing gated set', () => {
  const allowed = new Set(['/api/notes', '/api/arcs', '/api/primer', '/wiki/timeline-index.json', '/wiki/secrets-index.json'])
  const found = [...deskSource.matchAll(/["']((?:\/api\/|\/wiki\/)[^"']*)["']/g)].map(match => match[1])
  assert.ok(found.includes('/wiki/secrets-index.json'), 'pins reuse the atlas secrets-index fetch')
  for (const url of found) {
    const ok = allowed.has(url) || url.startsWith('/api/threads?arc=')
    assert.ok(ok, `unexpected fetch URL ${url}`)
  }
  assert.ok(deskSource.includes("from './atlas-chain.js'"), 'pins reuse atlas-chain.js, nothing invented')
  assert.equal(/fetch\(\s*["']https?:/.test(deskSource), false, 'no off-origin fetches')
})

test('run-mode: shell carries run-mode controls, help, and the three panels', () => {
  for (const id of ['deskSecrets', 'deskPins', 'deskOracle', 'deskRunMode', 'deskHelpBtn', 'deskHelp']) {
    assert.match(deskHtml, new RegExp(`id="${id}"`), `${id} present`)
  }
  for (const id of DESK_PANEL_ORDER) {
    assert.match(deskHtml, new RegExp(`id="${id}"[^>]*tabindex="-1"|tabindex="-1"[^>]*id="${id}"|id="${id}" tabindex`), `${id} keyboard-focusable`)
  }
  assert.match(deskHtml, /<button[^>]*id="deskRunMode"[^>]*aria-pressed/)
  assert.match(deskHtml, /<div[^>]*id="deskHelp"[^>]*hidden[^>]*role="dialog"/)
  assert.match(deskHtml, /href="\/oracle"/)
  assert.match(deskHtml, /href="\/map-editor"/)
})

test('run-mode: renderDesk renders all seven panels, degrades alone', () => {
  const panels = renderDesk({
    notes: null, notesError: 'unauthorized',
    arcs: [], arcsError: null, threadCounts: {},
    timeline: null, timelineError: 'x',
    primer: { revealed: ['s1'], count: 1 }, primerError: null,
    secretsIndex: { '/wiki/aelis': 2 }, secretsIndexError: null,
  })
  assert.deepEqual(Object.keys(panels).sort(), ['arcs', 'notes', 'oracle', 'pins', 'primer', 'secrets', 'timeline'])
  assert.match(panels.secrets, /1 seal opened/)
  assert.match(panels.pins, /2 hidden passages/)
  assert.ok(panels.oracle.includes('href="/oracle"'))
  const gated = renderDesk({
    notes: [], notesError: null,
    arcs: [], arcsError: null, threadCounts: {},
    timeline: null, timelineError: null,
    primer: null, primerError: 'unauthorized',
    secretsIndex: null, secretsIndexError: 'unauthorized',
  })
  assert.match(gated.secrets, /Sign in to open your sealed lore/)
  assert.match(gated.pins, /Sign in to open the atlas/)
  assert.ok(gated.oracle.includes('href="/oracle"'))
})
