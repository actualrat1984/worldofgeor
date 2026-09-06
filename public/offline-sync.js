// H19 Phase 1 — offline index snapshot reader (IndexedDB `geor-offline`).
//
// Snapshot scope (plan docs/plans/2026-09-05-h19-offline-sync.md §1):
// the ten search/data index JSONs live in one `snapshot` store with a
// manifest { builtAt, wikiSha }. The `outbox` store is created here but
// stays UNUSED until Phase 2. SW behavior is untouched: /api/ is never
// cached and no precache list changes.
//
// Node-safe: no top-level window/document/IndexedDB access. Browser code
// uses createIdbAdapter(); node tests inject createMemoryAdapter().

export const DB_NAME = 'geor-offline'
export const STORE_SNAPSHOT = 'snapshot'
export const STORE_OUTBOX = 'outbox'
export const STORE_META = 'meta'
export const MANIFEST_KEY = 'manifest'

// Allowlist of snapshot indexes. URLs MIRROR the exact URLs the site's
// consumers fetch today — never invented:
//   search       <- /wiki-index.json              (search.js, archive-compass.js, calendar.js, ...)
//   search-extra <- /wiki/search-extra-index.json (search.js)
//   tags         <- /wiki/tags-index.json         (oracle.js)
//   gazetteer    <- /wiki/gazetteer-index.json    (gazetteer.js)
//   statblocks   <- /wiki/statblocks-index.json   (statblocks.js)
//   timeline     <- /wiki/timeline-index.json     (timeline.js, chronicles.js, calendar.js)
//   webs         <- /wiki/webs-index.json         (webs.js, graph.js)
//   gallery      <- /wiki/gallery-index.json      (gallery.js, calendar.js)
//   calendar     <- /wiki/calendar-index.json     (calendar.js)
//   trees        <- /wiki/trees-index.json        (trees.js)
export const SNAPSHOT_INDEXES = [
  { name: 'search', url: '/wiki-index.json' },
  { name: 'search-extra', url: '/wiki/search-extra-index.json' },
  { name: 'tags', url: '/wiki/tags-index.json' },
  { name: 'gazetteer', url: '/wiki/gazetteer-index.json' },
  { name: 'statblocks', url: '/wiki/statblocks-index.json' },
  { name: 'timeline', url: '/wiki/timeline-index.json' },
  { name: 'webs', url: '/wiki/webs-index.json' },
  { name: 'gallery', url: '/wiki/gallery-index.json' },
  { name: 'calendar', url: '/wiki/calendar-index.json' },
  { name: 'trees', url: '/wiki/trees-index.json' },
]

export function isAllowedIndexName(name) {
  return typeof name === 'string' && SNAPSHOT_INDEXES.some(entry => entry.name === name)
}

// Hostile index names (path smuggling like '../x', '/api/me') are rejected
// with a throw — snapshot names are keys, never paths or URLs.
export function assertAllowedName(name) {
  if (!isAllowedIndexName(name)) throw new Error(`Unknown snapshot index: ${String(name)}`)
}

export function snapshotUrl(name) {
  assertAllowedName(name)
  return SNAPSHOT_INDEXES.find(entry => entry.name === name).url
}

export function isQuotaError(error) {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) return false
  if (error.name === 'QuotaExceededError') return true
  if (error.code === 22 || error.code === 1014) return true
  return /quota/i.test(String(error.message ?? error))
}

// ---- Store adapters -------------------------------------------------------
// Minimal injectable interface so every function below is unit-testable in
// node with a Map-backed fake: { kind, storeNames(), get, put, clear, count }.

export function createMemoryAdapter() {
  const snapshot = new Map()
  const meta = new Map()
  const outbox = new Map()
  let outboxSeq = 0
  const pick = store => {
    if (store === STORE_SNAPSHOT) return snapshot
    if (store === STORE_META) return meta
    if (store === STORE_OUTBOX) return outbox
    throw new Error(`Unknown store: ${String(store)}`)
  }
  return {
    kind: 'memory',
    storeNames: () => [STORE_SNAPSHOT, STORE_OUTBOX, STORE_META],
    get: async (store, key) => pick(store).get(key),
    put: async (store, value, key) => {
      const map = pick(store)
      // Mirror IndexedDB keyPaths: snapshot uses value.name, outbox autoincrements.
      if (key === undefined && store === STORE_SNAPSHOT) key = value?.name
      if (store === STORE_OUTBOX && key === undefined) map.set(++outboxSeq, value)
      else map.set(key, value)
    },
    clear: async store => { pick(store).clear() },
    count: async store => pick(store).size,
  }
}

export function createIdbAdapter({ dbName = DB_NAME, indexedDBImpl } = {}) {
  const idb = indexedDBImpl ?? globalThis.indexedDB
  if (!idb) throw new Error('IndexedDB unavailable on this device')
  let dbPromise = null
  const open = () => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = idb.open(dbName, 1)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(STORE_SNAPSHOT)) db.createObjectStore(STORE_SNAPSHOT, { keyPath: 'name' })
          // Phase 2 outbox: created now so the schema is stable, unused until then.
          if (!db.objectStoreNames.contains(STORE_OUTBOX)) db.createObjectStore(STORE_OUTBOX, { autoIncrement: true })
          if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META)
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
      })
    }
    return dbPromise
  }
  const run = (store, mode, makeRequest) => open().then(db => new Promise((resolve, reject) => {
    let request
    try {
      request = makeRequest(db.transaction(store, mode).objectStore(store))
    } catch (error) { reject(error); return }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  }))
  return {
    kind: 'idb',
    storeNames: () => [STORE_SNAPSHOT, STORE_OUTBOX, STORE_META],
    get: (store, key) => run(store, 'readonly', s => s.get(key)),
    put: (store, value, key) => run(store, 'readwrite', s => (key === undefined ? s.put(value) : s.put(value, key))),
    clear: store => run(store, 'readwrite', s => s.clear()),
    count: store => run(store, 'readonly', s => s.count()),
  }
}

// ---- Snapshot core ----------------------------------------------------------

function normalizeManifest(manifest) {
  const base = manifest && typeof manifest === 'object' ? manifest : {}
  const builtAt = base.builtAt ?? new Date().toISOString()
  if (typeof builtAt !== 'string' || Number.isNaN(Date.parse(builtAt))) {
    throw new Error('Snapshot manifest needs builtAt as an ISO date string')
  }
  return { builtAt, wikiSha: typeof base.wikiSha === 'string' ? base.wikiSha : '' }
}

async function writeAll(adapter, indexes, manifest) {
  const savedAt = new Date().toISOString()
  for (const [name, data] of Object.entries(indexes)) {
    assertAllowedName(name)
    await adapter.put(STORE_SNAPSHOT, { name, data, savedAt })
  }
  await adapter.put(STORE_META, manifest, MANIFEST_KEY)
  return Object.keys(indexes)
}

// Quota-safe: on QuotaExceededError clear the snapshot once and retry once;
// if storage is still exhausted return an honest failure instead of throwing.
export async function saveSnapshot(adapter, indexes, manifest) {
  if (!indexes || typeof indexes !== 'object') throw new Error('saveSnapshot needs { name -> data }')
  const clean = normalizeManifest(manifest)
  try {
    const saved = await writeAll(adapter, indexes, clean)
    return { ok: true, saved }
  } catch (error) {
    if (!isQuotaError(error)) throw error
    try {
      await adapter.clear(STORE_SNAPSHOT)
      const saved = await writeAll(adapter, indexes, clean)
      return { ok: true, saved, retriedAfterQuota: true }
    } catch (retryError) {
      return { ok: false, error: `Snapshot not saved: device storage is full (${String(retryError?.message ?? retryError)})` }
    }
  }
}

export async function loadSnapshot(adapter, name) {
  assertAllowedName(name)
  const record = await adapter.get(STORE_SNAPSHOT, name)
  return record?.data ?? null
}

export async function getManifest(adapter) {
  return (await adapter.get(STORE_META, MANIFEST_KEY)) ?? null
}

export async function clearSnapshot(adapter) {
  await adapter.clear(STORE_SNAPSHOT)
  await adapter.clear(STORE_META)
}

// Phase 2 placeholder read: the outbox store exists and starts empty.
export async function getOutboxCount(adapter) {
  return adapter.count(STORE_OUTBOX)
}

// ---- Snapshot download ------------------------------------------------------
// Fetches the ten allowlisted index URLs (same URLs the site uses today) and
// stores each plus the manifest. `manifestUrl` is reserved for a future
// server manifest endpoint — today the caller passes { builtAt, wikiSha }.

export async function fetchSnapshot({ adapter, fetchImpl, manifest, manifestUrl } = {}) {
  if (!adapter) throw new Error('fetchSnapshot needs a store adapter')
  void manifestUrl
  const runFetch = fetchImpl ?? globalThis.fetch
  if (typeof runFetch !== 'function') throw new Error('fetchSnapshot needs a fetch implementation')
  const clean = normalizeManifest(manifest)
  const entries = {}
  const failed = []
  for (const { name, url } of SNAPSHOT_INDEXES) {
    if (url.includes('/api/')) { failed.push({ name, error: 'refused: snapshots never cover /api/' }); continue }
    try {
      const response = await runFetch(url, { credentials: 'same-origin' })
      if (!response.ok) { failed.push({ name, error: `HTTP ${response.status}` }); continue }
      entries[name] = await response.json()
    } catch (error) {
      failed.push({ name, error: String(error?.message ?? error) })
    }
  }
  const saved = await saveSnapshot(adapter, entries, clean)
  return { ok: failed.length === 0 && saved.ok, saved: saved.ok ? saved.saved : [], failed, manifest: clean }
}

// ---- Offline search fallback (ONE consumer: search) ---------------------------

// Same entry filter search.js applies to network-fetched indexes.
export function asIndexArray(data) {
  return Array.isArray(data) ? data.filter(item => item && typeof item.title === 'string' && typeof item.url === 'string') : []
}

// Returns { index, extraIndex, manifest } from the snapshot when the device
// reports offline, or null when online / nothing snapshotted. Never fetches.
export async function tryOfflineSearchLoad({ adapter, isOnline }) {
  if (isOnline !== false) return null
  const [searchData, extraData, manifest] = await Promise.all([
    loadSnapshot(adapter, 'search').catch(() => null),
    loadSnapshot(adapter, 'search-extra').catch(() => null),
    getManifest(adapter).catch(() => null),
  ])
  if (!searchData && !extraData) return null
  return { index: asIndexArray(searchData), extraIndex: asIndexArray(extraData), manifest }
}

// Device-honest banner: manifest date when known, `local copy` otherwise.
export function offlineBannerText(manifest) {
  const builtAt = manifest?.builtAt
  const day = typeof builtAt === 'string' && !Number.isNaN(Date.parse(builtAt)) ? builtAt.slice(0, 10) : ''
  return day ? `Offline · indexes from ${day}` : 'Offline · local copy'
}

// Opportunistic refresh: after an online search load, remember what the
// network gave us so the next offline visit has something to read. Keeps the
// existing manifest (its builtAt still describes the snapshot); mints one
// only when none exists yet.
export async function rememberSearchIndexes(adapter, index, extraIndex) {
  const manifest = (await getManifest(adapter).catch(() => null))
    ?? { builtAt: new Date().toISOString(), wikiSha: '' }
  return saveSnapshot(adapter, { search: index, 'search-extra': extraIndex }, manifest)
}
