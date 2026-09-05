import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Wave H H1 — the only pages migrated to the named type scale so far.
// Other pages migrate in H2; keep this list in sync as they do.
const migratedPages = ['index.html', path.join('public', 'dashboard.html')]
const pageSources = migratedPages.map((file) => ({
  file,
  src: readFileSync(path.join(root, file), 'utf8'),
}))

// Single source of truth mirrored from tailwind.config.js.
// Approved scale (12/14/16/20/28/38/52) plus Wave H H1 zero-drift steps
// restoring exact pre-migration px (9/10/11/13/15/18/22/24/26/30/32/36/42/64).
const typeScale = {
  xs: '12px',
  sm: '14px',
  base: '16px',
  lg: '20px',
  xl: '28px',
  '2xl': '38px',
  '3xl': '52px',
  micro: '9px',
  tiny: '10px',
  kicker: '11px',
  13: '13px',
  15: '15px',
  18: '18px',
  22: '22px',
  24: '24px',
  26: '26px',
  30: '30px',
  32: '32px',
  display: '42px',
  'display-xl': '64px',
  '4xl': '36px',
}

test('migrated pages use no arbitrary text-[NNpx] sizes (type-scale ratchet)', () => {
  for (const { file, src } of pageSources) {
    const hits = [...src.matchAll(/text-\[[^\]]*\]/g)]
      .map((match) => match[0])
      .filter((cls) => /\d+(?:\.\d+)?px/.test(cls))
    assert.deepEqual(hits, [], `${file} must use the named type scale, found: ${hits.join(', ')}`)
  }
})

test('zero-drift spot checks: prime elements use their exact original sizes', () => {
  const index = pageSources.find((page) => page.file === 'index.html').src
  const dashboard = pageSources.find((page) => page.file.endsWith('dashboard.html')).src
  assert.ok(index.includes('text-display md:text-display-xl'), 'hero H1 is exactly 42px / 64px')
  assert.ok(dashboard.includes('font-display text-24'), 'dashboard welcome is exactly 24px')
  assert.ok(index.includes('text-micro'), '9px kickers use the micro step')
  assert.ok(index.includes('text-22'), 'age drawer title is exactly 22px')
  assert.ok(index.includes('text-15'), 'feature headings are exactly 15px')
  assert.ok(index.includes('text-30'), '30px elements use the 30 step')
})

test('tailwind config defines the named type scale', () => {
  const config = readFileSync(path.join(root, 'tailwind.config.js'), 'utf8')
  assert.ok(config.includes('fontSize'), 'tailwind.config.js defines a fontSize scale')
  for (const [step, size] of Object.entries(typeScale)) {
    assert.ok(config.includes(size), `type scale step ${step} is ${size} in tailwind.config.js`)
  }
})

test('JetBrains Mono is downloaded and used for dates/stats/coordinates', () => {
  const config = readFileSync(path.join(root, 'tailwind.config.js'), 'utf8')
  assert.ok(config.includes('JetBrains Mono'), 'mono family stays in the tailwind config')
  for (const { file, src } of pageSources) {
    assert.ok(src.includes('JetBrains+Mono'), `${file} downloads JetBrains Mono`)
    assert.ok(src.includes('font-mono'), `${file} uses font-mono for dates/stats/coordinates`)
  }
})
