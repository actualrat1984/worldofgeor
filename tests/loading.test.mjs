import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = rel => readFileSync(path.join(root, rel), 'utf8')

const styleCss = read('src/style.css')
// Wave H H4 scope: landing + the four member pages.
const scopedPages = [
  'index.html',
  path.join('public', 'dashboard.html'),
  path.join('public', 'atlas.html'),
  path.join('public', 'search.html'),
  path.join('public', 'admin.html'),
]
const scopedSrc = scopedPages.map(rel => ({ rel, src: read(rel) }))

test('one easing token: --ease-archive defined once, referenced by reveal + page-enter', () => {
  const definitions = [...styleCss.matchAll(/--ease-archive\s*:/g)]
  assert.equal(definitions.length, 1, 'exactly one --ease-archive definition in src/style.css')
  const beziers = [...styleCss.matchAll(/cubic-bezier/g)]
  assert.equal(beziers.length, 1, 'a single cubic-bezier value lives in src/style.css')
  assert.ok(styleCss.includes('.reveal-item'), 'reveal-item rule survives')
  const revealBlock = styleCss.slice(styleCss.indexOf('.reveal-item'), styleCss.indexOf('.reveal-item') + 400)
  assert.ok(revealBlock.includes('var(--ease-archive)'), 'reveal-item runs on the archive easing')
  assert.ok(styleCss.includes('.page-enter'), 'shared .page-enter transition class exists')
  const enterAt = styleCss.lastIndexOf('.page-enter {')
  assert.ok(enterAt >= 0, '.page-enter rule block exists')
  const enterBlock = styleCss.slice(enterAt, enterAt + 400)
  assert.ok(enterBlock.includes('150ms'), 'page-enter keeps the 150ms timing')
  assert.ok(enterBlock.includes('var(--ease-archive)'), 'page-enter runs on the archive easing')
  // tailwind.config.js mirrors the same token value for duration-400/ease-archive utilities.
  const config = read('tailwind.config.js')
  assert.ok(config.includes('cubic-bezier(.22,1,.36,1)'), 'tailwind config mirrors the archive easing value')
})

test('reveal retimed to the 400ms token (no 700ms left)', () => {
  assert.ok(!styleCss.includes('700ms'), 'no 700ms timing survives in src/style.css')
  assert.ok(styleCss.includes('400ms'), 'reveal-item runs at 400ms')
})

test('reduced-motion still kills the new animation utilities', () => {
  assert.ok(styleCss.includes('prefers-reduced-motion'), 'reduced-motion guard survives')
  const guardAt = styleCss.indexOf('prefers-reduced-motion')
  const guardBlock = styleCss.slice(guardAt, guardAt + 600)
  assert.ok(guardBlock.includes('.skel') && guardBlock.includes('.page-enter'), '.skel + .page-enter opt out under reduced motion')
})

test('skeleton utility exists and backs async lists in at least two rooms', () => {
  assert.ok(styleCss.includes('.skel'), '.skel utility exists in src/style.css')
  assert.ok(styleCss.includes('skel-shimmer'), '.skel shimmer keyframes exist')
  const users = []
  if (read(path.join('public', 'dashboard.html')).includes('skel')) users.push('public/dashboard.html')
  if (read(path.join('public', 'search.js')).includes('skel')) users.push('public/search.js')
  if (read(path.join('public', 'search.html')).includes('class="skel') || read(path.join('public', 'search.html')).includes(' skel')) users.push('public/search.html')
  if (read(path.join('public', 'atlas.html')).includes('class="skel') || read(path.join('public', 'atlas.html')).includes(' skel')) users.push('public/atlas.html')
  assert.ok(users.length >= 2, `.skel is used in >=2 rooms, found: ${users.join(', ') || 'none'}`)
})

test('shared page transition is applied to every scoped page', () => {
  for (const { rel, src } of scopedSrc) {
    assert.ok(src.includes('page-enter'), `${rel} uses the shared .page-enter transition`)
  }
})

// Every scoped empty state keeps its own voice and carries an action.
// Each marker must be followed (within a small window) by a link or button.
const emptyStates = [
  { rel: path.join('public', 'dashboard.html'), marker: 'Your recently opened folios will appear here.' },
  { rel: path.join('public', 'dashboard.html'), marker: 'Save a wiki folio from its reading toolbar to keep it here.' },
  { rel: path.join('public', 'dashboard.html'), marker: 'You are caught up. The archive is quiet for now.' },
  { rel: path.join('public', 'dashboard.html'), marker: 'No drafts are waiting. The editorial desk is clear.' },
  { rel: path.join('public', 'dashboard.html'), marker: 'The editorial desk is temporarily unavailable.' },
  { rel: path.join('public', 'dashboard.html'), marker: 'The archive count could not be refreshed.' },
  { rel: path.join('public', 'dashboard.html'), marker: 'The ledger is quiet.' },
  { rel: path.join('public', 'admin.html'), marker: 'No users yet' },
  { rel: path.join('public', 'admin.html'), marker: 'No invites' },
  { rel: path.join('public', 'admin.html'), marker: 'No pending requests' },
  { rel: path.join('public', 'atlas.html'), marker: 'No mapped place matches' },
  { rel: path.join('public', 'search.html'), marker: 'NO ENTRY ANSWERS THAT NAME' },
]

test('every scoped empty state contains a link or button', () => {
  const offenders = []
  for (const { rel, marker } of emptyStates) {
    const src = read(rel)
    const at = src.indexOf(marker)
    assert.ok(at >= 0, `${rel} still carries its voice: "${marker}"`)
    const window = src.slice(at, at + 900)
    if (!/<a[\s>]|<button[\s>]|createElement\('a'\)|createElement\('button'\)|createElement\("a"\)|createElement\("button"\)/.test(window)) offenders.push(`${rel}: "${marker}" has no link/button action`)
  }
  assert.equal(offenders.length, 0, `action-less empty states:\n${offenders.join('\n')}`)
})

test('landing age drawer keeps its archive action', () => {
  const index = read('index.html')
  assert.ok(index.includes('id="ageDrawerEnter"'), 'age drawer keeps its ENTER ARCHIVE control')
  assert.ok(/<button[^>]*id="ageDrawerEnter"/.test(index), 'the drawer action is a real button')
})

test('no duration-500/700 strays left in scoped pages or the shared stylesheet', () => {
  const offenders = []
  for (const { rel, src } of scopedSrc) {
    if (src.includes('duration-500')) offenders.push(`${rel}: duration-500`)
    if (src.includes('duration-700')) offenders.push(`${rel}: duration-700`)
  }
  if (styleCss.includes('duration-500') || styleCss.includes('duration-700')) offenders.push('src/style.css: stray duration utility')
  assert.equal(offenders.length, 0, `off-token timings:\n${offenders.join('\n')}`)
})
