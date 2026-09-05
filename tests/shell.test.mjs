import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')

// Wave H H2 — two canonical headers (landing + member), three card tiers,
// one button rule (solid gold = the single primary per migrated page).
// Migrated pages so far: landing (index.html) + dashboard.
const memberPages = [
  'public/dashboard.html',
  'public/atlas.html',
  'public/search.html',
  'public/admin.html',
]
const migratedPages = ['index.html', 'public/dashboard.html']

function headerClass(src, file) {
  const match = src.match(/<header class="([^"]+)"/)
  assert.ok(match, `${file} has a <header class="...">`)
  return match[1]
}

function headerInnerShellClass(src, file) {
  const header = src.match(/<header[\s\S]*?<\/header>/)
  assert.ok(header, `${file} has a well-formed <header> block`)
  const match = header[0].match(/<header[^>]*>\s*<div class="([^"]+)"/)
  assert.ok(match, `${file} header has an inner shell div`)
  return match[1]
}

test('member pages share one canonical header shell (class strings identical)', () => {
  const classes = memberPages.map((file) => [file, headerClass(read(file), file)])
  const shells = memberPages.map((file) => [file, headerInnerShellClass(read(file), file)])
  const [, canonical] = classes[0]
  const [, canonicalShell] = shells[0]
  assert.equal(canonical, 'sticky top-0 z-50 bg-ink/90 backdrop-blur border-b border-gold/10')
  assert.equal(canonicalShell, 'max-w-[1100px] mx-auto px-4 md:px-6 h-[56px] flex items-center justify-between gap-4')
  for (const [file, cls] of classes.slice(1)) {
    assert.equal(cls, canonical, `${file} header class matches the canonical member header`)
  }
  for (const [file, cls] of shells.slice(1)) {
    assert.equal(cls, canonicalShell, `${file} header shell matches the canonical member header`)
  }
})

test('member headers carry logo + compass trigger + member pill landmarks', () => {
  for (const file of memberPages) {
    const header = read(file).match(/<header[\s\S]*?<\/header>/)[0]
    assert.ok(header.includes('data-member-logo'), `${file} header has the member logo`)
    assert.ok(header.includes('data-compass-trigger'), `${file} header has the compass trigger`)
    assert.ok(header.includes('data-member-pill'), `${file} header has the member pill`)
  }
})

test('card tiers are defined once in src/style.css', () => {
  const css = read('src/style.css')
  for (const tier of ['card-quiet', 'card', 'card-hero']) {
    assert.ok(css.includes(`.${tier}`), `style.css defines .${tier}`)
  }
  assert.ok(css.includes('rounded-[20px]'), 'card tiers use the 20px canonical radius')
  assert.ok(css.includes('bg-cream/[0.03]'), 'card tiers use the cream 3% fill')
})

test('migrated pages use all three card tiers', () => {
  for (const file of migratedPages) {
    const src = read(file)
    for (const tier of ['card-quiet', 'card', 'card-hero']) {
      assert.ok(new RegExp(`\\b${tier}\\b`).test(src), `${file} uses the ${tier} tier`)
    }
  }
})

function mainMarkup(file) {
  const src = read(file)
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<header[\s\S]*?<\/header>/g, '')
    .replace(/<dialog[\s\S]*?<\/dialog>/g, '')
  const match = src.match(/<main[^>]*>([\s\S]*)<\/main>/)
  assert.ok(match, `${file} has a <main> block`)
  return match[1]
}

test('exactly one solid-gold primary per migrated page (header/modals/scripts excluded)', () => {
  const primaries = {
    'index.html': 'Begin with Ge',
    'public/dashboard.html': 'Open Wiki',
  }
  for (const file of migratedPages) {
    const main = mainMarkup(file)
    // Solid gold = bare `bg-gold` or `from-gold` on a link/button class
    // (excludes gold/10 washes, gold/[...] gradients, border-gold, text-gold,
    // and non-interactive frames such as the CTA gradient border).
    const solids = [...main.matchAll(/<(?:a|button)\b[^>]*class="[^"]*(?:bg-gold[ "']|from-gold[ "'])[^"]*"/g)].map((m) => m[0])
    assert.equal(solids.length, 1, `${file} has exactly one solid-gold primary in <main>, found: ${solids.join(' | ')}`)
    assert.ok(main.includes(primaries[file]), `${file} keeps its primary CTA (${primaries[file]})`)
  }
})
