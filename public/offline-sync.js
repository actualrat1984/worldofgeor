// H19 Phase 1 — offline index snapshot reader (IndexedDB `geor-offline`).
//
// Snapshot scope (plan docs/plans/2026-09-05-h19-offline-sync.md §1):
// the ten search/data index JSONs live in one `snapshot` store with a
// manifest { builtAt, wikiSha }. The `outbox` store holds Phase 2 queued
// additions.save writes (enqueueSave + FIFO flushOutbox below). SW behavior
// is untouched: /api/ is never cached and no precache list changes.
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
      if (store === STORE_OUTBOX && key === undefined) key = ++outboxSeq
      else if (key === undefined) key = value?.name
      map.set(key, value)
      return key
    },
    clear: async store => { pick(store).clear() },
    count: async store => pick(store).size,
    entries: async store => [...pick(store).entries()]
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => (a.key > b.key ? 1 : a.key < b.key ? -1 : 0)),
    remove: async (store, key) => { pick(store).delete(key) },
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
    entries: store => open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly')
      const objectStore = tx.objectStore(store)
      const keysRequest = objectStore.getAllKeys()
      const valuesRequest = objectStore.getAll()
      tx.oncomplete = () => {
        const keys = keysRequest.result ?? []
        const values = valuesRequest.result ?? []
        resolve(keys.map((key, index) => ({ key, value: values[index] }))
          .sort((a, b) => (a.key > b.key ? 1 : a.key < b.key ? -1 : 0)))
      }
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB request failed'))
    })),
    remove: (store, key) => run(store, 'readwrite', s => s.delete(key)),
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

// ---- Phase 2: offline outbox --------------------------------------------------
// Queued `additions.save` writes. Payloads mirror POST /api/additions/save
// {path, content, oldPath?, message?} exactly — client-side checks enforce
// the same 900k char limit and the same path sanitize rules as worker.js
// sanitizeAdditionsPath before anything reaches the queue. FIFO flush POSTs
// each entry to OUTBOX_SAVE_URL (the one and only /api/ fetch in this
// module, always POST — queued saves are never cached and the SW is
// untouched). 409/sha-mismatch entries are flagged conflicted for Phase 3,
// which owns the diff UI; this phase stores the flag only.
//
// Node-safe: adapter + fetch + clock are all injected. Browser code passes
// createIdbAdapter(); node tests pass createMemoryAdapter().

// The single server endpoint the outbox ever talks to. No other /api/ URL
// appears in this module outside comments.
export const OUTBOX_OP_SAVE = 'additions.save'
export const OUTBOX_SAVE_URL = '/api/additions/save'
export const OUTBOX_CONTENT_MAX = 900000
export const OUTBOX_MESSAGE_MAX = 200
export const OUTBOX_BACKOFF_FIRST_MS = 5000
export const OUTBOX_BACKOFF_MAX_MS = 60000
export const OUTBOX_MAX_ATTEMPTS = 10
// Mirror of worker.js ALLOWED_ADDITION_EXTENSIONS.
export const OUTBOX_SAVE_EXTENSIONS = ['md', 'txt', 'json', 'yaml', 'yml', 'csv']
// Exact honest-queue copy (plan §2): shown on every outbox-backed surface.
export const QUEUED_CHIP_TEXT = 'Queued offline · not yet published'
export const SYNC_FAILED_TEXT = 'Sync failed — kept locally, retrying'

// Mirror of worker.js sanitizeAdditionsPath: normalized path or null.
// Same trims, same `..`/`//`/charset/length rules, same .md default,
// same extension allow-list.
export function sanitizeOutboxPath(p) {
  if (p == null) return null
  p = String(p).trim()
  if (p.startsWith('/')) return null
  if (!p) return null
  if (p.includes('\\') || p.includes('//')) return null
  if (!/^[A-Za-z0-9._\-\\/ ]+$/.test(p)) return null
  if (p.length > 180) return null
  if (p.startsWith('.') || p.startsWith('/')) return null
  const parts = p.split('/').map(s => s.trim()).filter(Boolean)
  if (!parts.length) return null
  for (const seg of parts) {
    if (seg.length > 80) return null
    if (seg === '.' || seg === '..' || seg.startsWith('.') || seg.endsWith('.')) return null
  }
  const filename = parts.at(-1)
  if (!filename.includes('.')) parts[parts.length - 1] += '.md'
  const extension = parts.at(-1).split('.').pop().toLowerCase()
  if (!OUTBOX_SAVE_EXTENSIONS.includes(extension)) return null
  return parts.join('/')
}

// Mirror of the worker save handler's message default: trimmed, capped,
// falling back to `edit <rawPath> via /app`.
export function normalizeOutboxMessage(message, rawPath) {
  const clean = (typeof message === 'string' ? message : '').trim().slice(0, OUTBOX_MESSAGE_MAX)
  return clean || `edit ${rawPath} via /app`
}

// Validate a save payload with the worker's exact limits and error copy.
// Returns the normalized { path, content, oldPath, message } or throws.
export function validateSavePayload(payload) {
  const body = payload && typeof payload === 'object' ? payload : {}
  const rawPath = typeof body.path === 'string' ? body.path.trim() : ''
  const rawOld = typeof body.oldPath === 'string' ? body.oldPath.trim() : ''
  const content = body.content
  if (typeof content !== 'string') throw new Error('content required (string)')
  if (content.length > OUTBOX_CONTENT_MAX) throw new Error('File too large (900k char limit)')
  const path = sanitizeOutboxPath(rawPath)
  if (!path) throw new Error('Invalid path — use A-Z 0-9 . _ - / — e.g. my-idea.md')
  const oldPath = rawOld && rawOld !== path ? sanitizeOutboxPath(rawOld) : null
  if (rawOld && rawOld !== path && !oldPath) throw new Error('Invalid previous path')
  return { path, content, oldPath, message: normalizeOutboxMessage(body.message, rawPath) }
}

function makeOutboxId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  } catch {}
  return `dev-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
}

function defaultDeviceId() {
  try {
    const storage = globalThis.localStorage
    if (storage) {
      const existing = storage.getItem('geor-device-id')
      if (existing) return existing
      const fresh = makeOutboxId()
      try { storage.setItem('geor-device-id', fresh) } catch {}
      return fresh
    }
  } catch {}
  return makeOutboxId()
}

export async function getOutboxCount(adapter) {
  return adapter.count(STORE_OUTBOX)
}

// Enqueue an additions.save while offline. Superseded drafts collapse:
// the latest pending save per path wins, earlier ones are dropped.
// Returns the stored record with its store key as `id`.
export async function enqueueSave(adapter, payload, { now, deviceId } = {}) {
  if (!adapter) throw new Error('enqueueSave needs a store adapter')
  const clean = validateSavePayload(payload)
  const createdAt = new Date(typeof now === 'number' ? now : Date.now()).toISOString()
  const existing = await adapter.entries(STORE_OUTBOX)
  for (const { key, value } of existing) {
    if (value && value.op === OUTBOX_OP_SAVE && value.path === clean.path && !value.conflicted) {
      await adapter.remove(STORE_OUTBOX, key)
    }
  }
  const record = {
    op: OUTBOX_OP_SAVE,
    path: clean.path,
    content: clean.content,
    oldPath: clean.oldPath,
    message: clean.message,
    createdAt,
    deviceId: typeof deviceId === 'string' && deviceId ? deviceId : defaultDeviceId(),
    attempts: 0,
    nextAttemptAt: 0,
    exhausted: false,
    conflicted: false,
    lastError: '',
  }
  const id = await adapter.put(STORE_OUTBOX, record)
  return { id, ...record }
}

// FIFO list: createdAt order, store-key tiebreak. Includes conflicted and
// exhausted entries (Phase 3 owns conflicts; failures stay visible).
export async function listOutbox(adapter) {
  const entries = await adapter.entries(STORE_OUTBOX)
  return entries
    .map(({ key, value }) => ({ id: key, ...(value ?? {}) }))
    .filter(item => item && item.op === OUTBOX_OP_SAVE)
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
      || (a.id > b.id ? 1 : a.id < b.id ? -1 : 0))
}

// Pending count for header badges: queued but not yet published.
// Conflicted entries belong to Phase 3 and are excluded.
export async function getPendingOutboxCount(adapter) {
  const items = await listOutbox(adapter)
  return items.filter(item => !item.conflicted).length
}

export async function removeOutboxEntry(adapter, id) {
  await adapter.remove(STORE_OUTBOX, id)
}

// Manual retry after exhaustion: clear failure state, keep the payload.
export async function resetOutboxEntry(adapter, id) {
  const record = await adapter.get(STORE_OUTBOX, id)
  if (!record) throw new Error('Queued save not found')
  const { id: _drop, ...rest } = record
  void _drop
  await adapter.put(STORE_OUTBOX, {
    ...rest, attempts: 0, nextAttemptAt: 0, exhausted: false, lastError: '',
  }, id)
}

// Exponential backoff 5s → 1m. `failures` counts delivery attempts so far.
export function outboxBackoffMs(failures) {
  const n = Math.max(0, Math.floor(Number(failures) || 0))
  return Math.min(OUTBOX_BACKOFF_MAX_MS, OUTBOX_BACKOFF_FIRST_MS * 2 ** n)
}

// Any entry that tried and is still waiting (and isn't a Phase 3 conflict).
export function hasOutboxFailures(items) {
  return (items ?? []).some(item => item && !item.conflicted
    && (item.exhausted || (item.attempts ?? 0) > 0))
}

// fetch() rejects with TypeError when the network itself is unreachable —
// the signal the manuscripts hook uses to queue instead of POST.
export function isNetworkFailure(error) {
  return error instanceof TypeError
}

function deviceOnline() {
  try {
    return globalThis.navigator?.onLine !== false
  } catch { return true }
}

async function markOutboxConflict(adapter, item, detail) {
  const { id, ...rest } = item
  await adapter.put(STORE_OUTBOX, { ...rest, conflicted: true, lastError: detail }, id)
}

async function markOutboxFailure(adapter, item, clock, detail) {
  const { id, ...rest } = item
  const attempts = (item.attempts ?? 0) + 1
  const exhausted = attempts >= OUTBOX_MAX_ATTEMPTS
  await adapter.put(STORE_OUTBOX, {
    ...rest,
    attempts,
    exhausted,
    nextAttemptAt: exhausted ? 0 : clock + outboxBackoffMs(attempts),
    lastError: detail,
  }, id)
  return exhausted
}

// A 409, an explicit conflict flag, or a sha-mismatch message means the
// server copy moved under us — flag it for Phase 3, never auto-overwrite.
async function isConflictResponse(response) {
  if (response?.status === 409) return true
  try {
    const source = typeof response.clone === 'function' ? response.clone() : response
    const data = await source.json()
    if (data && typeof data === 'object') {
      if (data.conflict === true) return true
      if (typeof data.error === 'string' && /sha[- ]?mismatch|conflict/i.test(data.error)) return true
    }
  } catch {}
  return false
}

function outboxSaveBody(item) {
  const payload = { path: item.path, content: item.content, message: item.message }
  if (item.oldPath) payload.oldPath = item.oldPath
  return payload
}

let flushRunning = false
export function isOutboxFlushRunning() {
  return flushRunning
}

// FIFO flush with one in-flight at a time. Per-item backoff (5s→1m, ~10
// tries); one path's failure never blocks later paths. 401 stops the whole
// flush so the UI can force re-login; conflicts are flagged, not retried.
export async function flushOutbox(adapter, { fetchImpl, now } = {}) {
  if (flushRunning) return { ok: false, sent: 0, failed: 0, conflicts: 0, stopped: 'busy' }
  if (!adapter) throw new Error('flushOutbox needs a store adapter')
  if (!deviceOnline()) return { ok: false, sent: 0, failed: 0, conflicts: 0, stopped: 'offline' }
  const runFetch = fetchImpl ?? globalThis.fetch
  if (typeof runFetch !== 'function') throw new Error('flushOutbox needs a fetch implementation')
  flushRunning = true
  const summary = { ok: true, sent: 0, failed: 0, conflicts: 0, stopped: null }
  try {
    const clock = typeof now === 'number' ? now : Date.now()
    const items = await listOutbox(adapter)
    for (const item of items) {
      if (item.conflicted || item.exhausted) continue
      if ((item.nextAttemptAt ?? 0) > clock) continue
      let response
      try {
        response = await runFetch(OUTBOX_SAVE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(outboxSaveBody(item)),
        })
      } catch {
        // Connectivity dropped mid-flush: keep everything queued, stop here.
        await markOutboxFailure(adapter, item, clock, 'network unreachable')
        summary.ok = false
        summary.stopped = 'network'
        break
      }
      if (response.ok) {
        await adapter.remove(STORE_OUTBOX, item.id)
        summary.sent += 1
        continue
      }
      if (response.status === 401) {
        summary.ok = false
        summary.stopped = 'unauthorized'
        break
      }
      if (await isConflictResponse(response)) {
        await markOutboxConflict(adapter, item, `HTTP ${response.status}`)
        summary.conflicts += 1
        continue
      }
      await markOutboxFailure(adapter, item, clock, `HTTP ${response.status}`)
      summary.failed += 1
    }
  } finally {
    flushRunning = false
  }
  return summary
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
