// H19 Phase 1 — offline snapshot reader + search fallback. Node --test only,
// Map-backed memory adapter (no fake-indexeddb dep).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DB_NAME,
  SNAPSHOT_INDEXES,
  asIndexArray,
  clearSnapshot,
  createIdbAdapter,
  createMemoryAdapter,
  fetchSnapshot,
  getManifest,
  getOutboxCount,
  isQuotaError,
  loadSnapshot,
  offlineBannerText,
  rememberSearchIndexes,
  saveSnapshot,
  snapshotUrl,
  tryOfflineSearchLoad,
} from '../public/offline-sync.js'

const MANIFEST = { builtAt: '2026-09-05T12:00:00.000Z', wikiSha: 'abc123' }
const sampleEntries = name => [{ title: `${name} entry`, url: `/wiki/${name}/` }]

test('snapshot covers exactly the ten allowlisted indexes with mirrored URLs', () => {
  assert.equal(SNAPSHOT_INDEXES.length, 10)
  const byName = Object.fromEntries(SNAPSHOT_INDEXES.map(e => [e.name, e.url]))
  assert.equal(byName.search, '/wiki-index.json')
  assert.equal(byName['search-extra'], '/wiki/search-extra-index.json')
  for (const name of ['tags', 'gazetteer', 'statblocks', 'timeline', 'webs', 'gallery', 'calendar', 'trees']) {
    assert.equal(byName[name], `/wiki/${name}-index.json`, name)
  }
  assert.equal(DB_NAME, 'geor-offline')
})

test('save/load round-trip per store', async () => {
  const adapter = createMemoryAdapter()
  for (const { name } of SNAPSHOT_INDEXES) {
    const result = await saveSnapshot(adapter, { [name]: sampleEntries(name) }, MANIFEST)
    assert.equal(result.ok, true, name)
    assert.deepEqual(await loadSnapshot(adapter, name), sampleEntries(name), name)
  }
})

test('manifest round-trip keeps { builtAt, wikiSha } shape', async () => {
  const adapter = createMemoryAdapter()
  await saveSnapshot(adapter, { search: [] }, MANIFEST)
  assert.deepEqual(await getManifest(adapter), MANIFEST)
})

test('quota error clears once, retries, and reports honestly', async () => {
  const inner = createMemoryAdapter()
  let puts = 0
  let clears = 0
  const flaky = {
    ...inner,
    put: async (...args) => { puts++; if (puts === 1) { const e = new Error('storage full'); e.name = 'QuotaExceededError'; throw e } return inner.put(...args) },
    clear: async (...args) => { clears++; return inner.clear(...args) },
  }
  const retry = await saveSnapshot(flaky, { search: sampleEntries('search') }, MANIFEST)
  assert.equal(retry.ok, true)
  assert.equal(retry.retriedAfterQuota, true)
  assert.equal(clears, 1)
  assert.deepEqual(await loadSnapshot(inner, 'search'), sampleEntries('search'))

  assert.equal(isQuotaError(Object.assign(new Error('x'), { name: 'QuotaExceededError' })), true)
  assert.equal(isQuotaError(new Error('persistent quota exceeded')), true)
  assert.equal(isQuotaError(new Error('network down')), false)

  const alwaysFull = {
    ...inner,
    put: async () => { const e = new Error('still full'); e.name = 'QuotaExceededError'; throw e },
  }
  const failed = await saveSnapshot(alwaysFull, { search: [] }, MANIFEST)
  assert.equal(failed.ok, false)
  assert.match(failed.error, /storage is full/i)
})

test('outbox store exists and starts empty (Phase 2, unused)', async () => {
  const adapter = createMemoryAdapter()
  assert.ok(adapter.storeNames().includes('outbox'))
  assert.ok(adapter.storeNames().includes('snapshot'))
  assert.equal(await getOutboxCount(adapter), 0)
})

test('search fallback uses snapshot when offline, never when online', async () => {
  const adapter = createMemoryAdapter()
  await saveSnapshot(adapter, {
    search: [...sampleEntries('search'), { title: 42, url: null }],
    'search-extra': sampleEntries('extra'),
  }, MANIFEST)
  const offline = await tryOfflineSearchLoad({ adapter, isOnline: false })
  assert.ok(offline)
  assert.deepEqual(offline.index, sampleEntries('search'))
  assert.deepEqual(offline.extraIndex, sampleEntries('extra'))
  assert.deepEqual(offline.manifest, MANIFEST)
  assert.equal(await tryOfflineSearchLoad({ adapter, isOnline: true }), null)
  assert.equal(await tryOfflineSearchLoad({ adapter: createMemoryAdapter(), isOnline: false }), null)
})

test('offline fallback survives a throwing fetch (device really is offline)', async () => {
  const adapter = createMemoryAdapter()
  await saveSnapshot(adapter, { search: sampleEntries('search') }, MANIFEST)
  const throwingFetch = async () => { throw new Error('Failed to fetch') }
  const result = await fetchSnapshot({ adapter, fetchImpl: throwingFetch, manifest: MANIFEST })
  assert.equal(result.ok, false)
  assert.equal(result.failed.length, 10)
  // The earlier snapshot is untouched by the failed download.
  const offline = await tryOfflineSearchLoad({ adapter, isOnline: false })
  assert.deepEqual(offline.index, sampleEntries('search'))
})

test('fetchSnapshot requests exactly the ten mirrored URLs, never /api/', async () => {
  const requested = []
  const stub = async url => { requested.push(url); return { ok: true, status: 200, json: async () => [{ title: 't', url: '/wiki/t/' }] } }
  const adapter = createMemoryAdapter()
  const result = await fetchSnapshot({ adapter, fetchImpl: stub, manifest: MANIFEST })
  assert.equal(result.ok, true)
  assert.deepEqual([...requested].sort(), SNAPSHOT_INDEXES.map(e => e.url).sort())
  assert.ok(requested.every(url => !url.includes('/api/')))
  assert.deepEqual(await getManifest(adapter), MANIFEST)
  assert.deepEqual(await loadSnapshot(adapter, 'trees'), [{ title: 't', url: '/wiki/t/' }])
})

test('banner date is honest: manifest day, else local copy', () => {
  assert.equal(offlineBannerText(MANIFEST), 'Offline · indexes from 2026-09-05')
  assert.equal(offlineBannerText(null), 'Offline · local copy')
  assert.equal(offlineBannerText({}), 'Offline · local copy')
  assert.equal(offlineBannerText({ builtAt: 'not-a-date', wikiSha: '' }), 'Offline · local copy')
})

test('hostile index names are rejected, never treated as paths', async () => {
  const adapter = createMemoryAdapter()
  for (const hostile of ['../evil', '/api/me', '', null, undefined, 'Search', 'search;drop', '..', 'snapshot']) {
    await assert.rejects(() => loadSnapshot(adapter, hostile), /Unknown snapshot index/, String(hostile))
    await assert.rejects(() => saveSnapshot(adapter, { [hostile]: [] }, MANIFEST), /Unknown snapshot index/, String(hostile))
  }
  assert.throws(() => snapshotUrl('/api/me'), /Unknown snapshot index/)
  assert.equal(snapshotUrl('search'), '/wiki-index.json')
})

test('rememberSearchIndexes preserves an existing manifest, mints one otherwise', async () => {
  const adapter = createMemoryAdapter()
  await rememberSearchIndexes(adapter, sampleEntries('search'), [])
  const minted = await getManifest(adapter)
  assert.ok(!Number.isNaN(Date.parse(minted.builtAt)))
  assert.equal(minted.wikiSha, '')
  await saveSnapshot(adapter, { search: [] }, MANIFEST)
  await rememberSearchIndexes(adapter, sampleEntries('search'), sampleEntries('extra'))
  assert.deepEqual(await getManifest(adapter), MANIFEST)
  assert.deepEqual(await loadSnapshot(adapter, 'search-extra'), sampleEntries('extra'))
})

test('offline-sync.js never touches /api/; search.js wires the fallback', () => {
  const offlineSource = readFileSync(new URL('../public/offline-sync.js', import.meta.url), 'utf8')
  // No fetch of /api/ anywhere: every '/api/' mention must be a comment or
  // the refusal guard (fetchSnapshot skips api URLs defensively).
  for (const line of offlineSource.split('\n')) {
    if (line.includes('/api/')) assert.match(line, /^\s*\/\/|refused/, `suspicious /api/ use: ${line.trim()}`)
  }
  assert.doesNotMatch(offlineSource, /fetch\(\s*['"`]\/api\//)
  assert.match(offlineSource, /outbox/)
  assert.match(offlineSource, /QuotaExceededError/)
  const searchSource = readFileSync(new URL('../public/search.js', import.meta.url), 'utf8')
  assert.match(searchSource, /offline-sync\.js/)
  assert.match(searchSource, /tryOfflineSearchLoad/)
  assert.match(searchSource, /navigator\.onLine === false/)
  assert.match(searchSource, /loadSnapshot|rememberSearchIndexes/)
  assert.match(searchSource, /offlineBannerText/)
  assert.match(searchSource, /status\.textContent = offlineBanner/)
  assert.match(offlineSource, /Offline · indexes from/)
})

test('clearSnapshot empties indexes and manifest together', async () => {
  const adapter = createMemoryAdapter()
  await saveSnapshot(adapter, { search: sampleEntries('search') }, MANIFEST)
  await clearSnapshot(adapter)
  assert.equal(await loadSnapshot(adapter, 'search'), null)
  assert.equal(await getManifest(adapter), null)
})

test('createIdbAdapter reports the stable three-store schema without a browser', () => {
  const opened = []
  const fakeIdb = { open: () => { opened.push(true); throw new Error('no real IDB in node') } }
  const adapter = createIdbAdapter({ indexedDBImpl: fakeIdb })
  assert.deepEqual(adapter.storeNames(), ['snapshot', 'outbox', 'meta'])
  assert.throws(() => createIdbAdapter({ indexedDBImpl: null }), /IndexedDB unavailable/)
  assert.deepEqual(asIndexArray(null), [])
})
