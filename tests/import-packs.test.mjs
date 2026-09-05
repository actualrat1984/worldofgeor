import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const packsDir = path.join(root, 'scripts', 'packs')
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')

// Count semantics mirror scripts/import-packs.py extract_counts: a top-level
// list counts as 'items'; a dict key counts its list/dict length; a missing
// key counts 0; any other scalar counts as-is.
function extractCounts(data, keys) {
  const counts = {}
  for (const key of keys) {
    if (Array.isArray(data)) {
      counts[key] = key === 'items' ? data.length : 0
      continue
    }
    const value = data?.[key]
    if (Array.isArray(value) || (value && typeof value === 'object')) {
      counts[key] = Array.isArray(value) ? value.length : Object.keys(value).length
    } else if (value === undefined || value === null) {
      counts[key] = 0
    } else {
      counts[key] = value
    }
  }
  return counts
}

const packFiles = readdirSync(packsDir).filter(file => file.endsWith('.pack.json')).sort()
const packs = packFiles.map(file => JSON.parse(readFileSync(path.join(packsDir, file), 'utf8')))

// NOTE: this test only ever runs the runner with --check, which regenerates
// into a temp dir and diffs. It NEVER overwrites dist/ from a test.
const result = spawnSync(python, [path.join(root, 'scripts', 'import-packs.py'), '--check'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 300000,
})
const stdout = result.stdout ?? ''

test('import packs --check exits 0: every pack re-imports clean (temp only, dist untouched)', () => {
  assert.equal(result.error, undefined, `runner could not start: ${result.error}`)
  assert.equal(result.status, 0, `--check failed:\n${stdout}\n${result.stderr ?? ''}`)
})

test('all 10 canon packs report ok with matching re-imported counts', () => {
  assert.equal(packs.length, 10, `expected 10 packs, found ${packFiles.join(', ')}`)
  for (const pack of packs) {
    assert.match(stdout, new RegExp(`ok ${pack.name}: counts `), `${pack.name} missing ok line`)
    const committed = JSON.parse(readFileSync(path.join(root, pack.output), 'utf8'))
    assert.deepEqual(
      extractCounts(committed, Object.keys(pack.counts)),
      pack.counts,
      `${pack.name}: committed ${pack.output} counts drifted from manifest`,
    )
  }
})

test('gazetteer pack: 486 entries re-imported, matching the committed index', () => {
  const pack = packs.find(entry => entry.name === 'gazetteer')
  assert.ok(pack, 'gazetteer pack manifest missing')
  assert.deepEqual(pack.counts, { entries: 486 })
  const committed = JSON.parse(readFileSync(path.join(root, pack.output), 'utf8'))
  assert.equal(committed.entries.length, 486)
  assert.match(stdout, /ok gazetteer: counts \{"entries": 486\}/)
})
