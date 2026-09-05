import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = rel => readFileSync(path.join(root, rel), 'utf8')

function collectHtml(directory, out = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) collectHtml(absolute, out)
    else if (entry.name.endsWith('.html')) out.push(absolute)
  }
  return out
}

const pages = [path.join(root, 'index.html'), ...collectHtml(path.join(root, 'public'))]
const styleCss = read('src/style.css')

test('global gold :focus-visible ring survives in src/style.css', () => {
  assert.ok(styleCss.includes(':focus-visible'), 'style.css keeps a :focus-visible rule')
  assert.ok(styleCss.includes('ring-gold'), 'the focus ring uses the gold token')
})

test('zero outline-none on form controls: global gold ring is never defeated', () => {
  const offenders = []
  for (const file of pages) {
    const html = readFileSync(file, 'utf8')
    const lines = html.split('\n')
    lines.forEach((line, i) => {
      if (!line.includes('outline-none')) return
      const tag = (line.match(/<(input|select|textarea|button)\b/) || [])[1]
      offenders.push(`${path.relative(root, file)}:${i + 1}${tag ? ` (<${tag}>)` : ''}`)
    })
  }
  const statblocksJs = read('public/statblocks.js')
  if (statblocksJs.includes('outline-none')) offenders.push('public/statblocks.js (template button className)')
  assert.equal(offenders.length, 0, `outline-none defeats the gold ring in:\n${offenders.join('\n')}`)
})

// Contrast floor: cream/60 minimum for real text + placeholders on the
// landing page and the four member pages (dashboard/atlas/search/admin).
// Borders, fills and decorative backgrounds (border-cream/*, bg-cream/*)
// are not text and are intentionally out of scope.
const contrastScope = [
  'index.html',
  'public/dashboard.html',
  'public/atlas.html',
  'public/search.html',
  'public/admin.html',
  'public/search.js',
]
const lowCreamText = /text-cream\/(20|25|30|35|40)(?![0-9])/

test('zero text-cream/40-or-lower on real text and placeholders (cream/60 floor)', () => {
  const offenders = []
  for (const rel of contrastScope) {
    read(rel).split('\n').forEach((line, i) => {
      const hit = line.match(lowCreamText)
      if (hit) offenders.push(`${rel}:${i + 1} (${hit[0]})`)
    })
  }
  assert.equal(offenders.length, 0, `sub-floor cream text in:\n${offenders.join('\n')}`)
})

const motionFiles = ['src/main.js', 'public/chronicles.js', 'public/search.js', 'public/timeline.js']

test('reduced-motion guards present in all four motion-bearing JS files', () => {
  for (const rel of motionFiles) {
    const src = read(rel)
    assert.ok(
      src.includes("matchMedia('(prefers-reduced-motion: reduce)')"),
      `${rel} honors matchMedia('(prefers-reduced-motion: reduce)')`,
    )
  }
  assert.ok(
    styleCss.includes('prefers-reduced-motion'),
    'src/style.css keeps the reduced-motion CSS kill switch',
  )
})
