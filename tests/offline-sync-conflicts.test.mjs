// H19 Phase 3 — conflict stash + user resolution (keep-mine / keep-server /
// merge-manually). Node --test only: Map-backed memory adapter, stub
// fetchImpl (never hits network). The store keeps hostile text verbatim;
// escaping happens at render (manuscripts renderConflict* helpers).
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  CONFLICT_BADGE_TEXT,
  CONFLICT_STATUS_TEXT,
  OUTBOX_SAVE_URL,
  clearPathConflicts,
  conflictLabel,
  createMemoryAdapter,
  enqueueSave,
  flushOutbox,
  getConflictOutboxCount,
  getPendingOutboxCount,
  listConflicts,
  listOutbox,
  resolveKeepMine,
  resolveKeepServer,
  stashConflict,
} from '../public/offline-sync.js'
import {
  renderConflictDiff,
  renderConflictItem,
  renderManuscriptItem,
} from '../public/manuscripts.js'

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const readRepo = rel => readFileSync(path.join(repoRoot, rel), 'utf8')
const save = (path, content = 'hello', extra = {}) => ({ path, content, ...extra })
const enqueue = (adapter, payload, i = 0) =>
  enqueueSave(adapter, payload, { now: 1700000000000 + i * 1000, deviceId: 'test-device' })
const conflictFetch = (status = 409, body = {}) => async () => ({
  ok: false, status, json: async () => body,
})
const HOSTILE = '</pre><script>alert(1)</script><img src=x onerror=alert(2)>'

async function conflictedAdapter(content = '# Mine\n\nlocal text') {
  const adapter = createMemoryAdapter()
  await enqueue(adapter, save('Books/Ember/Arrival.md', content), 1)
  const summary = await flushOutbox(adapter, { fetchImpl: conflictFetch(), now: 1700000009000 })
  assert.equal(summary.conflicts, 1)
  return adapter
}

test('409 mismatch stashes local text verbatim and never overwrites it', async () => {
  const adapter = await conflictedAdapter()
  const stashes = await listConflicts(adapter)
  assert.equal(stashes.length, 1)
  assert.equal(stashes[0].content, '# Mine\n\nlocal text')
  assert.equal(stashes[0].kind, 'conflict')
  assert.equal(stashes[0].conflicted, true)
  // The conflicted source is flagged, kept, and still carries local text.
  const saves = await listOutbox(adapter)
  assert.equal(saves.length, 1)
  assert.equal(saves[0].conflicted, true)
  assert.equal(saves[0].content, '# Mine\n\nlocal text')
  // No server text anywhere: every stored record is the user's own text.
  for (const item of [...stashes, ...saves]) {
    assert.equal(item.content, '# Mine\n\nlocal text')
  }
  // A re-flush never retries or duplicates the stash — the user decides.
  const again = await flushOutbox(adapter, { fetchImpl: conflictFetch(), now: 1700000019000 })
  assert.equal(again.conflicts, 0)
  assert.equal((await listConflicts(adapter)).length, 1)
})

test('explicit sha-mismatch error body also conflicts (never silently overwritten)', async () => {
  const adapter = createMemoryAdapter()
  await enqueue(adapter, save('notes/idea.md', 'v1'), 1)
  const summary = await flushOutbox(adapter, {
    fetchImpl: conflictFetch(500, { error: 'sha mismatch on save' }),
    now: 1700000009000,
  })
  assert.equal(summary.conflicts, 1)
  assert.equal(summary.failed, 0)
  const stashes = await listConflicts(adapter)
  assert.equal(stashes.length, 1)
  assert.equal(stashes[0].content, 'v1')
})

test('stash is idempotent per source entry and verbatim for hostile text', async () => {
  const adapter = createMemoryAdapter()
  const queued = await enqueue(adapter, save('notes/evil.md', HOSTILE), 1)
  const first = await stashConflict(adapter, { id: queued.id, ...queued }, { now: 1700000009000 })
  const second = await stashConflict(adapter, { id: queued.id, ...queued }, { now: 1700000009999 })
  assert.equal(first.id, second.id)
  assert.equal(first.content, HOSTILE)
  assert.equal((await listConflicts(adapter)).length, 1)
})

test('keep-mine re-enqueues stashed text with a fresh base, drops stash + source', async () => {
  const adapter = await conflictedAdapter()
  const [stash] = await listConflicts(adapter)
  const record = await resolveKeepMine(adapter, stash.id, { freshBaseSha: 'deadbeef01' })
  assert.equal(record.content, '# Mine\n\nlocal text')
  assert.equal(record.baseSha, 'deadbeef01')
  assert.equal(record.conflicted, false)
  assert.equal((await listConflicts(adapter)).length, 0)
  const saves = await listOutbox(adapter)
  assert.equal(saves.length, 1)
  assert.equal(saves[0].content, '# Mine\n\nlocal text')
  assert.equal(saves[0].baseSha, 'deadbeef01')
  assert.equal(await getPendingOutboxCount(adapter), 1)
  assert.equal(await getConflictOutboxCount(adapter), 0)
})

test('keep-server drops stash and source — the server copy stands', async () => {
  const adapter = await conflictedAdapter()
  const [stash] = await listConflicts(adapter)
  const result = await resolveKeepServer(adapter, stash.id)
  assert.deepEqual(result, { dropped: true, path: 'Books/Ember/Arrival.md', label: stash.label })
  assert.equal((await listConflicts(adapter)).length, 0)
  assert.equal((await listOutbox(adapter)).length, 0)
  assert.equal(await getPendingOutboxCount(adapter), 0)
  assert.equal(await getConflictOutboxCount(adapter), 0)
})

test('resolving an unknown conflict throws honestly', async () => {
  const adapter = createMemoryAdapter()
  await assert.rejects(() => resolveKeepMine(adapter, 999, {}), /Conflict not found/)
  await assert.rejects(() => resolveKeepServer(adapter, 999), /Conflict not found/)
})

test('merge-manually surfaces both texts, hostile content escaped', () => {
  const html = renderConflictDiff(HOSTILE, HOSTILE)
  assert.ok(!html.includes('<script>'), 'raw script tag must not survive')
  assert.ok(!html.includes('<img '), 'raw img tag must not survive')
  assert.ok(html.includes('&lt;script&gt;'), 'mine side is escaped')
  assert.ok(html.includes('YOUR QUEUED TEXT'), 'mine side labeled honestly')
  assert.ok(html.includes('SERVER VERSION'), 'server side labeled honestly')
  assert.ok(html.includes('NEVER AUTO-SAVED'), 'no-overwrite promise is visible')
})

test('badge copy exact, conflicted rows honest, hostile labels escaped', () => {
  assert.equal(CONFLICT_BADGE_TEXT, 'Needs your call — server changed since you edited')
  assert.match(CONFLICT_STATUS_TEXT, /Nothing was overwritten/)
  const row = renderManuscriptItem({ path: 'Books/Ember/Arrival.md' }, false, false, true)
  assert.ok(row.includes('Needs your call — server changed since you edited'))
  assert.ok(row.includes('data-conflicted="true"'))
  assert.ok(!row.includes('Queued offline'), 'conflicted rows never wear the queued chip')
  const item = renderConflictItem({
    id: 7, path: 'Books/Ember/Arrival.md', label: `Books/Ember/Arrival.md.conflict-1${HOSTILE}`,
  })
  assert.ok(item.includes('data-conflict-action="keep-mine"'))
  assert.ok(item.includes('data-conflict-action="keep-server"'))
  assert.ok(item.includes('data-conflict-action="merge-manually"'))
  assert.ok(item.includes('nothing was overwritten'))
  assert.ok(!item.includes('<script>'), 'hostile label must not survive')
})

test('conflict labels name the stash, never pass as saved', async () => {
  assert.equal(conflictLabel('Books/Ember/Arrival.md', 1700000009000), 'Books/Ember/Arrival.md.conflict-1700000009000')
  const adapter = await conflictedAdapter()
  const [stash] = await listConflicts(adapter)
  assert.equal(stash.label, conflictLabel(stash.path, Date.parse(stash.createdAt)))
  assert.match(stash.label, /\.conflict-\d+$/)
})

test('badge counts: pending excludes conflicted, one conflict counts once', async () => {
  const adapter = await conflictedAdapter()
  assert.equal(await getPendingOutboxCount(adapter), 0)
  assert.equal(await getConflictOutboxCount(adapter), 1)
  // A fresh edit on the same path queues normally alongside the conflict.
  await enqueue(adapter, save('Books/Ember/Arrival.md', 'v2'), 2)
  assert.equal(await getPendingOutboxCount(adapter), 1)
  assert.equal(await getConflictOutboxCount(adapter), 1)
  // Saving merged content spends the whole conflict state for the path.
  await clearPathConflicts(adapter, 'Books/Ember/Arrival.md')
  assert.equal(await getPendingOutboxCount(adapter), 1)
  assert.equal(await getConflictOutboxCount(adapter), 0)
})

test('no new endpoints: the outbox only ever POSTs /api/additions/save', async () => {
  assert.equal(OUTBOX_SAVE_URL, '/api/additions/save')
  const adapter = createMemoryAdapter()
  await enqueue(adapter, save('a.md', 'one'), 1)
  await enqueue(adapter, save('b.md', 'two'), 2)
  const posted = []
  await flushOutbox(adapter, {
    fetchImpl: async (url, init) => {
      posted.push({ url, method: init?.method })
      return { ok: true, status: 200, json: async () => ({}) }
    },
    now: 1700000009000,
  })
  assert.ok(posted.length > 0)
  for (const call of posted) {
    assert.equal(call.url, '/api/additions/save')
    assert.equal(call.method, 'POST')
  }
  const source = readRepo('public/offline-sync.js')
  const codeOnly = source.split('\n').map(line => line.split('//')[0]).join('\n')
  const apiRefs = [...new Set(codeOnly.match(/\/api\/[A-Za-z0-9/_\-?=.&]*/g) ?? [])]
  // '/api/' bare is the fetchSnapshot guard that REFUSES /api/ snapshot
  // coverage (snapshots never cover /api/) — not a fetched endpoint.
  const extras = apiRefs.filter(ref => ref !== '/api/' && ref !== '/api/additions/save')
  assert.deepEqual(extras, [], `unexpected /api/ references: ${extras.join(', ')}`)
})

test('SW/worker untouched: Phase 3 identifiers live client-side only', () => {
  const workerSource = readRepo('worker.js')
  for (const token of ['stashConflict', 'resolveKeepMine', 'resolveKeepServer', 'listConflicts', 'CONFLICT_BADGE_TEXT', 'clearPathConflicts']) {
    assert.ok(!workerSource.includes(token), `worker.js must not contain ${token}`)
  }
  const syncSource = readRepo('public/offline-sync.js')
  assert.ok(!syncSource.includes('serviceWorker'), 'outbox never touches the service worker')
  const candidates = ['public/sw.js', 'public/service-worker.js', 'sw.js']
  for (const rel of candidates) {
    if (!existsSync(path.join(repoRoot, rel))) continue
    assert.ok(!readRepo(rel).toLowerCase().includes('conflict'), `${rel} must not contain conflict logic`)
  }
})
