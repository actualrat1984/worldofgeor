// H19 Phase 2 — offline outbox (enqueueSave + FIFO flushOutbox). Node --test
// only, Map-backed memory adapter, stub fetchImpl (never hits network).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  OUTBOX_BACKOFF_FIRST_MS,
  OUTBOX_BACKOFF_MAX_MS,
  OUTBOX_CONTENT_MAX,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_SAVE_URL,
  QUEUED_CHIP_TEXT,
  createMemoryAdapter,
  enqueueSave,
  flushOutbox,
  getPendingOutboxCount,
  hasOutboxFailures,
  listOutbox,
  outboxBackoffMs,
  removeOutboxEntry,
  resetOutboxEntry,
  sanitizeOutboxPath,
  validateSavePayload,
} from '../public/offline-sync.js'

const okResponse = () => ({ ok: true, status: 200, json: async () => ({}) })
const failResponse = (status = 500) => ({ ok: false, status, json: async () => ({}) })
const save = (path, content = 'hello', extra = {}) => ({ path, content, ...extra })
const enqueue = (adapter, payload, i = 0) =>
  enqueueSave(adapter, payload, { now: 1700000000000 + i * 1000, deviceId: 'test-device' })

test('enqueue/collapse round-trip: latest pending save per path wins', async () => {
  const adapter = createMemoryAdapter()
  const first = await enqueue(adapter, save('notes/idea.md', 'v1'), 1)
  assert.equal(first.path, 'notes/idea.md')
  assert.equal(first.deviceId, 'test-device')
  assert.equal(first.attempts, 0)
  assert.equal(first.conflicted, false)
  assert.equal(first.exhausted, false)
  await enqueue(adapter, save('notes/other.md', 'other'), 2)
  const second = await enqueue(adapter, save('notes/idea.md', 'v2'), 3)
  assert.notEqual(second.id, first.id)
  const items = await listOutbox(adapter)
  assert.equal(items.length, 2)
  const idea = items.find(item => item.path === 'notes/idea.md')
  assert.equal(idea.content, 'v2')
  assert.equal(await getPendingOutboxCount(adapter), 2)
})

test('conflicted entries survive collapse (Phase 3 owns them)', async () => {
  const adapter = createMemoryAdapter()
  await enqueue(adapter, save('notes/idea.md', 'v1'), 1)
  const calls = []
  const conflictFetch = async () => { calls.push(1); return { ok: false, status: 409, json: async () => ({}) } }
  const summary = await flushOutbox(adapter, { fetchImpl: conflictFetch, now: 1700000009000 })
  assert.equal(summary.conflicts, 1)
  await enqueue(adapter, save('notes/idea.md', 'v2'), 2)
  const items = await listOutbox(adapter)
  assert.equal(items.length, 2)
  assert.ok(items.some(item => item.conflicted && item.content === 'v1'))
  assert.ok(items.some(item => !item.conflicted && item.content === 'v2'))
  // Conflicted entries are excluded from the pending badge count.
  assert.equal(await getPendingOutboxCount(adapter), 1)
})

test('900k content limit enforced at the queue edge', () => {
  assert.equal(OUTBOX_CONTENT_MAX, 900000)
  assert.doesNotThrow(() => validateSavePayload(save('notes/big.md', 'x'.repeat(900000))))
  assert.throws(() => validateSavePayload(save('notes/big.md', 'x'.repeat(900001))), /900k char limit/)
  assert.throws(() => validateSavePayload({ path: 'notes/big.md' }), /content required/)
  assert.throws(() => validateSavePayload({ path: 'notes/big.md', content: 42 }), /content required/)
})

test('path smuggling rejected: .., //, leading /, overlong, bad charset', async () => {
  for (const hostile of ['../evil.md', 'a//b.md', '/api/me', '', '   ']) {
    assert.equal(sanitizeOutboxPath(hostile), null, hostile)
    await assert.rejects(() => enqueueSave(createMemoryAdapter(), save(hostile, 'x')), /Invalid path/, hostile)
  }
  assert.equal(sanitizeOutboxPath('..'), null)
  assert.equal(sanitizeOutboxPath('a/' + 'x'.repeat(81) + '.md'), null)
  assert.equal(sanitizeOutboxPath('x'.repeat(177) + '.md'), null)
  assert.equal(sanitizeOutboxPath('<script>alert(1)</script>.md'), null)
  await assert.rejects(
    () => enqueueSave(createMemoryAdapter(), save('x'.repeat(200) + '.md', 'x')),
    /Invalid path/,
  )
  // Sane paths pass and gain the .md default.
  assert.equal(sanitizeOutboxPath('my-idea'), 'my-idea.md')
  assert.equal(sanitizeOutboxPath('notes/my idea.txt'), 'notes/my idea.txt')
  assert.equal(sanitizeOutboxPath('notes/evil.exe'), null)
})

test('FIFO flush order with stub fetchImpl, one POST per entry', async () => {
  const adapter = createMemoryAdapter()
  await enqueue(adapter, save('a-first.md', 'one'), 1)
  await enqueue(adapter, save('b-second.md', 'two'), 2)
  await enqueue(adapter, save('c-third.md', 'three'), 3)
  const posted = []
  const stub = async (url, init) => {
    posted.push({ url, body: JSON.parse(init.body), method: init.method })
    return okResponse()
  }
  const summary = await flushOutbox(adapter, { fetchImpl: stub, now: 1700000010000 })
  assert.deepEqual(summary, { ok: true, sent: 3, failed: 0, conflicts: 0, stopped: null })
  assert.equal(posted.length, 3)
  assert.ok(posted.every(call => call.url === OUTBOX_SAVE_URL && call.method === 'POST'))
  assert.deepEqual(posted.map(call => call.body.path), ['a-first.md', 'b-second.md', 'c-third.md'])
  assert.deepEqual(posted[0].body, { path: 'a-first.md', content: 'one', message: 'edit a-first.md via /app' })
  assert.equal(await getPendingOutboxCount(adapter), 0)
})

test('backoff caps: 5s doubling to a 1m ceiling, 10 tries then exhausted', () => {
  assert.equal(OUTBOX_BACKOFF_FIRST_MS, 5000)
  assert.equal(OUTBOX_BACKOFF_MAX_MS, 60000)
  assert.equal(OUTBOX_MAX_ATTEMPTS, 10)
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 9].map(outboxBackoffMs),
    [5000, 10000, 20000, 40000, 60000, 60000, 60000],
  )
  assert.equal(outboxBackoffMs(-3), 5000)
})

test('repeated failures back off then exhaust; reset re-arms the entry', async () => {
  const adapter = createMemoryAdapter()
  await enqueue(adapter, save('notes/flaky.md', 'x'), 1)
  const always500 = async () => failResponse(500)
  let clock = 1700000020000
  for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt++) {
    const summary = await flushOutbox(adapter, { fetchImpl: always500, now: clock })
    assert.equal(summary.failed, 1)
    const [item] = await listOutbox(adapter)
    assert.equal(item.attempts, attempt)
    if (attempt < OUTBOX_MAX_ATTEMPTS) {
      assert.equal(item.exhausted, false)
      assert.equal(item.nextAttemptAt, clock + outboxBackoffMs(attempt))
      assert.equal(hasOutboxFailures([item]), true)
      clock = item.nextAttemptAt + 1
    } else {
      assert.equal(item.exhausted, true)
      assert.equal(item.nextAttemptAt, 0)
    }
  }
  // Exhausted entries are skipped, never retried implicitly.
  const skipped = await flushOutbox(adapter, { fetchImpl: always500, now: clock + 3600000 })
  assert.equal(skipped.sent, 0)
  assert.equal(skipped.failed, 0)
  // Manual retry clears the failure state but keeps the payload.
  const [entry] = await listOutbox(adapter)
  await resetOutboxEntry(adapter, entry.id)
  const [rearmed] = await listOutbox(adapter)
  assert.equal(rearmed.content, 'x')
  assert.equal(rearmed.attempts, 0)
  assert.equal(rearmed.exhausted, false)
  assert.equal(rearmed.lastError, '')
  assert.equal(hasOutboxFailures([rearmed]), false)
  await assert.rejects(() => resetOutboxEntry(adapter, 999999), /not found/)
})

test('401 stops the whole flush so the UI can force re-login', async () => {
  const adapter = createMemoryAdapter()
  await enqueue(adapter, save('a.md', 'one'), 1)
  await enqueue(adapter, save('b.md', 'two'), 2)
  let calls = 0
  const authGone = async () => { calls++; return failResponse(401) }
  const summary = await flushOutbox(adapter, { fetchImpl: authGone, now: 1700000030000 })
  assert.equal(summary.stopped, 'unauthorized')
  assert.equal(summary.ok, false)
  assert.equal(summary.sent, 0)
  assert.equal(calls, 1)
  // 401 marks nothing: both entries stay queued, attempts untouched.
  const items = await listOutbox(adapter)
  assert.equal(items.length, 2)
  assert.ok(items.every(item => item.attempts === 0 && !item.exhausted))
})

test('per-path failure isolation: one bad path never blocks later paths', async () => {
  const adapter = createMemoryAdapter()
  await enqueue(adapter, save('bad.md', 'bad'), 1)
  await enqueue(adapter, save('good-a.md', 'a'), 2)
  await enqueue(adapter, save('good-b.md', 'b'), 3)
  const stub = async (url, init) =>
    JSON.parse(init.body).path === 'bad.md' ? failResponse(500) : okResponse()
  const summary = await flushOutbox(adapter, { fetchImpl: stub, now: 1700000040000 })
  assert.equal(summary.sent, 2)
  assert.equal(summary.failed, 1)
  assert.equal(summary.stopped, null)
  const remaining = await listOutbox(adapter)
  assert.deepEqual(remaining.map(item => item.path), ['bad.md'])
  assert.equal(remaining[0].attempts, 1)
  assert.equal(remaining[0].lastError, 'HTTP 500')
})

test('conflicted flag on 409, conflict:true, and sha-mismatch bodies', async () => {
  for (const [label, response] of [
    ['status-409', { ok: false, status: 409, json: async () => ({}) }],
    ['conflict-flag', { ok: false, status: 400, json: async () => ({ conflict: true }) }],
    ['sha-mismatch', { ok: false, status: 400, json: async () => ({ error: 'sha mismatch: stale copy' }) }],
  ]) {
    const adapter = createMemoryAdapter()
    await enqueue(adapter, save('notes/hot.md', 'mine'), 1)
    const summary = await flushOutbox(adapter, { fetchImpl: async () => response, now: 1700000050000 })
    assert.equal(summary.conflicts, 1, label)
    assert.equal(summary.sent, 0, label)
    const [item] = await listOutbox(adapter)
    assert.equal(item.conflicted, true, label)
    assert.equal(hasOutboxFailures([item]), false, label)
  }
})

test('network drop mid-flush keeps everything queued and stops', async () => {
  const adapter = createMemoryAdapter()
  await enqueue(adapter, save('a.md', 'one'), 1)
  await enqueue(adapter, save('b.md', 'two'), 2)
  let calls = 0
  const flakyNet = async () => { calls++; throw new TypeError('fetch failed') }
  const summary = await flushOutbox(adapter, { fetchImpl: flakyNet, now: 1700000060000 })
  assert.equal(summary.stopped, 'network')
  assert.equal(summary.ok, false)
  assert.equal(calls, 1)
  assert.equal((await listOutbox(adapter)).length, 2)
})

test('QUEUED_CHIP_TEXT is the exact honest-queue copy', () => {
  assert.equal(QUEUED_CHIP_TEXT, 'Queued offline · not yet published')
})

test('removeOutboxEntry drops a single queued save', async () => {
  const adapter = createMemoryAdapter()
  const kept = await enqueue(adapter, save('keep.md', 'k'), 1)
  const dropped = await enqueue(adapter, save('drop.md', 'd'), 2)
  await removeOutboxEntry(adapter, dropped.id)
  assert.deepEqual((await listOutbox(adapter)).map(item => item.path), [kept.path])
})

test('service worker untouched: no outbox logic in public/sw.js', () => {
  const swSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
  assert.doesNotMatch(swSource, /outbox/i)
  assert.doesNotMatch(swSource, /OUTBOX_SAVE_URL/)
  assert.doesNotMatch(swSource, /additions\/save/)
})

test('hostile payloads are rejected or neutralized, never executed', async () => {
  const adapter = createMemoryAdapter()
  // Path injection is rejected at the queue edge.
  for (const hostile of ['"><script>alert(1)</script>', 'javascript:alert(1).md', '${7*7}.md']) {
    await assert.rejects(() => enqueueSave(adapter, save(hostile, 'x')), /Invalid path/, hostile)
  }
  // Markup in content is stored verbatim and survives a JSON round-trip
  // byte-for-byte: no eval, no HTML parsing, no path bleed.
  const nasty = '</script><img src=x onerror=alert(1)>"; DROP TABLE outbox; --'
  const stored = await enqueue(adapter, save('notes/nasty.md', nasty), 1)
  assert.equal(stored.content, nasty)
  let capturedBody = ''
  await flushOutbox(adapter, {
    fetchImpl: async (url, init) => { capturedBody = init.body; return okResponse() },
    now: 1700000070000,
  })
  assert.equal(JSON.parse(capturedBody).content, nasty)
  assert.equal(JSON.parse(capturedBody).path, 'notes/nasty.md')
  // Oversized hostile content is rejected before it reaches the store.
  await assert.rejects(
    () => enqueueSave(adapter, save('notes/nasty.md', 'x'.repeat(900001))),
    /900k char limit/,
  )
  assert.equal(await getPendingOutboxCount(adapter), 0)
})
