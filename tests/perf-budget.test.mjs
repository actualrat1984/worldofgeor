// Wave H24 — first-party perf budgets + touch-native atlas + article print.
// File-based assertions only (landing.test.mjs style): real on-disk bytes,
// map-option strings, and CSS rules. No network, no invented measurements.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bytes = (file) => statSync(path.join(root, file)).size
const read = (file) => readFileSync(path.join(root, file), 'utf8')

// 4G math: slow-4G delivers ~1.6 Mbps ≈ 200 KB/s of application throughput.
// Landing critical path (index.html + site.css) is ~100 KB ≈ 0.5 s; the
// heaviest room page + css is ~85 KB ≈ 0.45 s. Budgets below cap total
// first-party critical bytes at ~170 KB so even the heaviest page lands in
// well under 2 s on slow 4G. Thresholds are LIVE bytes (measured with
// `wc -c` after `npm run build:css`: index.html 61,355; site.css 38,998;
// dashboard.html — the heaviest public/*.html page — 46,207) plus ~15–20%
// headroom for honest growth.
const BUDGETS = [
  { file: 'index.html', max: 70_000 },
  { file: 'public/site.css', max: 46_000 },
  { file: 'public/dashboard.html', max: 54_000 },
]
const NEXT_STEPS =
  'over budget: compress images to AVIF/WebP, defer non-critical JS, split ' +
  'the page, then re-measure with `wc -c` and raise the budget only with a ' +
  'comment explaining why.'

for (const { file, max } of BUDGETS) {
  test(`${file} stays within its first-party byte budget (${max})`, () => {
    const live = bytes(file)
    assert.ok(
      live <= max,
      `${file} is ${live} bytes, budget is ${max} bytes. ${NEXT_STEPS}`,
    )
  })
}

const atlas = read('public/atlas.html')

test('atlas map init asserts terrestrial touch options (tap + touchZoom)', () => {
  const init = (atlas.match(/L\.map\(mapEl,\s*\{[^}]*\}\)/) || [])[0]
  assert.ok(init, 'atlas keeps its L.map(mapEl, {...}) init')
  assert.ok(/tap:\s*true/.test(init), 'tap is explicitly on')
  assert.ok(/touchZoom:\s*true/.test(init), 'touchZoom is explicitly on')
  assert.ok(
    /bounceAtZoomLimits:\s*true/.test(init),
    'bounceAtZoomLimits is explicitly on',
  )
})

test('atlas markers, popups and controls expose 44px tap targets', () => {
  assert.ok(atlas.includes('44px'), 'a 44px minimum-target rule is present')
  assert.ok(
    atlas.includes('.atlas-marker-shell::after'),
    'pins get a 44px ::after hit pad (visual stays 18px, anchor unshifted)',
  )
  assert.ok(
    /\.leaflet-control-zoom a\{[^}]*44px/.test(atlas),
    'zoom controls are 44px targets',
  )
  assert.ok(
    /\.leaflet-popup-close-button\{[^}]*44px/.test(atlas),
    'popup close button is a 44px target',
  )
  assert.ok(
    /\.atlas-popup a,.atlas-popup button\{[^}]*min-height:44px/.test(atlas),
    'popup lore/folio links are 44px targets',
  )
})

test('atlas preserves tap highlight and keyboard focus visibility', () => {
  assert.ok(
    atlas.includes('-webkit-tap-highlight-color'),
    'tap highlight is set (a gold wash, never transparent)',
  )
  assert.ok(
    atlas.includes(':focus-visible'),
    ':focus-visible rings survive for keyboard users',
  )
})

const layouts = read('public/article-layouts.css')
const printBlock = (layouts.match(/@media print\s*\{[\s\S]*?\n\}/) || [])[0]

test('article-layouts.css carries a print block (manuscripts pattern)', () => {
  assert.ok(printBlock, '@media print block is present')
})

test('article print hides chrome and prints ink-on-white', () => {
  assert.ok(printBlock, 'print block is present')
  for (const chrome of ['header', 'nav', 'footer', '.geor-toc', 'compass']) {
    assert.ok(
      printBlock.includes(chrome),
      `print hides chrome: ${chrome}`,
    )
  }
  assert.ok(
    /display:\s*none/.test(printBlock),
    'hidden chrome uses display:none',
  )
  assert.ok(printBlock.includes('#fff'), 'page prints on white')
  assert.ok(printBlock.includes('#000') || printBlock.includes('color: black'), 'body ink prints black')
})

test('article print keeps title + body readable with page-break rules', () => {
  assert.ok(printBlock, 'print block is present')
  assert.ok(
    printBlock.includes('h1.geor-hero-title'),
    'article title stays visible in print',
  )
  assert.ok(
    /break-after:\s*avoid/.test(printBlock),
    'headings avoid breaking after',
  )
  assert.ok(
    /orphans:\s*3/.test(printBlock) && /widows:\s*3/.test(printBlock),
    'paragraphs keep orphans/widows control',
  )
})
