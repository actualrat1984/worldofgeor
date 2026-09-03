// Wave E2: per-member notebook — isolation, search scoping, validation, gate.
import test from 'node:test'
import assert from 'node:assert/strict'
import worker, { __test } from '../worker.js'
import { openChecklistCount, renderChecklist, renderNoteItem, renderNoteList } from '../public/notebook.js'

const SECRET = 'test-only-secret-that-is-longer-than-32-characters'

// Isolated notebook store. notebook_notes starts absent so the first request
// proves ensureTables() creates it (mirrors migrations/0007_notebook.sql);
// any touch before that throws exactly like D1/SQLite would.
function makeNotebookDb() {
  const tables = new Set(['users', 'invites', 'requests', 'activity', 'map_documents', 'rate_limits', 'reveals', 'notes', 'arcs', 'plots', 'threads', 'boards', 'member_library', 'workflow_items', 'workflow_history'])
  const notes = new Map()
  const limits = new Map()
  let nextId = 1
  const stamp = () => new Date().toISOString()
  return {
    tables,
    notes,
    limits,
    prepare(sql) {
      let args = []
      const api = {
        bind(...values) { args = values; return api },
        async run() {
          if (/CREATE TABLE IF NOT EXISTS/i.test(sql)) {
            const table = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)[1]
            tables.add(table)
            return { meta: { changes: 0 } }
          }
          if (/CREATE INDEX IF NOT EXISTS/i.test(sql)) return { meta: { changes: 0 } }
          if (/ALTER TABLE users ADD COLUMN role/i.test(sql)) return { meta: { changes: 0 } }
          if (sql.includes('INSERT INTO rate_limits')) {
            const [key, resetAt] = args
            const current = limits.get(key)
            limits.set(key, { attempts: (current?.attempts || 0) + 1, reset_at: current?.reset_at ?? resetAt })
            return { meta: { changes: 1 } }
          }
          if (sql.includes('DELETE FROM rate_limits')) { limits.delete(args[0]); return { meta: { changes: 1 } } }
          if (/INSERT INTO notebook_notes/i.test(sql)) {
            if (!tables.has('notebook_notes')) throw new Error('no such table: notebook_notes')
            const [member_email, title, body, checklist_json] = args
            const id = nextId++
            const at = stamp()
            notes.set(id, { id, member_email, title, body, checklist_json, created_at: at, updated_at: at })
            return { meta: { changes: 1, last_row_id: id } }
          }
          if (/UPDATE notebook_notes/i.test(sql)) {
            if (!tables.has('notebook_notes')) throw new Error('no such table: notebook_notes')
            const id = args[args.length - 2]
            const email = args[args.length - 1]
            const row = notes.get(id)
            if (!row || row.member_email !== email) return { meta: { changes: 0 } }
            const setPart = sql.slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'))
            const cols = [...setPart.matchAll(/(\w+)\s*=\s*\?/g)].map(match => match[1])
            cols.forEach((col, index) => { row[col] = args[index] })
            if (/updated_at = strftime/i.test(sql)) row.updated_at = stamp()
            return { meta: { changes: 1 } }
          }
          if (/DELETE FROM notebook_notes/i.test(sql)) {
            if (!tables.has('notebook_notes')) throw new Error('no such table: notebook_notes')
            const [id, email] = args
            const row = notes.get(id)
            if (!row || row.member_email !== email) return { meta: { changes: 0 } }
            notes.delete(id)
            return { meta: { changes: 1 } }
          }
          return { meta: { changes: 0 } }
        },
        async first() {
          if (sql.includes('FROM rate_limits')) {
            const record = limits.get(args[0])
            return record ? { attempts: record.attempts, reset_at: record.reset_at } : null
          }
          if (/FROM notebook_notes/i.test(sql)) {
            if (!tables.has('notebook_notes')) throw new Error('no such table: notebook_notes')
            const [id, email] = args
            const row = notes.get(id)
            return row && row.member_email === email ? { ...row } : null
          }
          return null
        },
        async all() {
          if (/FROM notebook_notes/i.test(sql)) {
            if (!tables.has('notebook_notes')) throw new Error('no such table: notebook_notes')
            const [email, ...rest] = args
            let rows = [...notes.values()].filter(row => row.member_email === email)
            if (rest.length) {
              const needle = String(rest[0]).slice(1, -1).replace(/\\(.)/g, '$1').toLowerCase()
              rows = rows.filter(row => row.title.toLowerCase().includes(needle) || row.body.toLowerCase().includes(needle))
            }
            rows.sort((a, b) => b.id - a.id)
            return { results: rows.map(row => ({ ...row })) }
          }
          return { results: [] }
        },
      }
      return api
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())) },
  }
}

async function notebookToken(email) {
  const now = Math.floor(Date.now() / 1000)
  return __test.signJwt({ email, iss: 'worldofgeor', iat: now, exp: now + 60 }, SECRET)
}

function notebookEnv(db) {
  return {
    JWT_SECRET: SECRET,
    DB: db,
    ASSETS: { fetch: async request => {
      const pathname = new URL(request.url).pathname
      return new Response(pathname, { headers: { 'Content-Type': pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain' } })
    } },
  }
}

const authed = (method, path, token, body) => new Request(`https://worldofgeor.com${path}`, {
  method,
  headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Cookie: `geor_token=${token}` } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
})

test('notebook validators accept good input and reject overlong shapes', () => {
  assert.equal(__test.cleanNotebookTitle(null), '')
  assert.equal(__test.cleanNotebookTitle('  Ember  '), 'Ember')
  assert.equal(__test.cleanNotebookTitle('x'.repeat(200)), 'x'.repeat(200))
  assert.equal(__test.cleanNotebookTitle('x'.repeat(201)), null)
  assert.equal(__test.cleanNotebookTitle(42), null)
  assert.equal(__test.cleanNotebookBody('  keep  '), 'keep')
  assert.equal(__test.cleanNotebookBody(''), null)
  assert.equal(__test.cleanNotebookBody('   '), null)
  assert.equal(__test.cleanNotebookBody('x'.repeat(20000)), 'x'.repeat(20000))
  assert.equal(__test.cleanNotebookBody('x'.repeat(20001)), null)
  assert.deepEqual(__test.cleanNotebookChecklist(undefined), [])
  assert.deepEqual(__test.cleanNotebookChecklist(['a', { text: 'b', done: 1 }]), [{ text: 'a', done: false }, { text: 'b', done: true }])
  assert.equal(__test.cleanNotebookChecklist('nope'), null)
  assert.equal(__test.cleanNotebookChecklist(new Array(101).fill('x')), null)
  assert.equal(__test.cleanNotebookChecklist(['']), null)
  assert.equal(__test.cleanNotebookChecklist(['x'.repeat(201)]), null)
  assert.equal(__test.cleanNotebookChecklist([42]), null)
})

test('notebook render helpers escape hostile input and count open items', () => {
  assert.equal(openChecklistCount([{ text: 'a', done: true }, { text: 'b' }]), 1)
  assert.match(renderChecklist([{ text: '<script>', done: false }]), /&lt;script&gt;/)
  assert.doesNotMatch(renderChecklist([{ text: '<script>' }]), /<script>/)
  assert.match(renderNoteItem({ id: 3, title: '<b>', body: 'x', checklist: [{ text: 'a' }] }, true), /&lt;b&gt;/)
  assert.match(renderNoteList([], null), /No notes yet/)
})

test('notebook: create lists own notes only and auto-migrates the table', async () => {
  const db = makeNotebookDb()
  const env = notebookEnv(db)
  const ada = await notebookToken('ada@example.com')
  const bob = await notebookToken('bob@example.com')
  const first = await worker.fetch(authed('POST', '/api/notes', ada, { title: 'Ember treaty', body: 'Draft terms', checklist: ['ink', { text: 'seal', done: true }] }), env, {})
  assert.equal(first.status, 201)
  assert.equal(db.tables.has('notebook_notes'), true)
  const created = (await first.json()).note
  assert.equal(created.title, 'Ember treaty')
  assert.deepEqual(created.checklist, [{ text: 'ink', done: false }, { text: 'seal', done: true }])
  await worker.fetch(authed('POST', '/api/notes', ada, { body: 'Second page' }), env, {})
  await worker.fetch(authed('POST', '/api/notes', bob, { title: 'Bob private', body: 'Not for Ada' }), env, {})
  const adaList = await (await worker.fetch(authed('GET', '/api/notes', ada), env, {})).json()
  assert.equal(adaList.notes.length, 2)
  assert.ok(adaList.notes.every(note => note.title !== 'Bob private'))
  const bobList = await (await worker.fetch(authed('GET', '/api/notes', bob), env, {})).json()
  assert.deepEqual(bobList.notes.map(note => note.title), ['Bob private'])
})

test('notebook: search matches title and body but never another member', async () => {
  const db = makeNotebookDb()
  const env = notebookEnv(db)
  const ada = await notebookToken('ada@example.com')
  const bob = await notebookToken('bob@example.com')
  await worker.fetch(authed('POST', '/api/notes', ada, { title: 'Ember treaty', body: 'Draft terms' }), env, {})
  await worker.fetch(authed('POST', '/api/notes', ada, { title: 'Market list', body: 'Buy lamp oil' }), env, {})
  await worker.fetch(authed('POST', '/api/notes', bob, { title: 'Ember pact', body: 'Secret terms' }), env, {})
  const titleHit = await (await worker.fetch(authed('GET', '/api/notes?q=ember', ada), env, {})).json()
  assert.deepEqual(titleHit.notes.map(note => note.title), ['Ember treaty'])
  const bodyHit = await (await worker.fetch(authed('GET', '/api/notes?q=lamp', ada), env, {})).json()
  assert.deepEqual(bodyHit.notes.map(note => note.title), ['Market list'])
  const missing = await (await worker.fetch(authed('GET', '/api/notes?q=pact', ada), env, {})).json()
  assert.deepEqual(missing.notes, [])
  const capped = await worker.fetch(authed('GET', `/api/notes?q=${'y'.repeat(400)}`, ada), env, {})
  assert.equal(capped.status, 200)
})

test('notebook: patch updates own notes, 404s on others, 400s on bad edits', async () => {
  const db = makeNotebookDb()
  const env = notebookEnv(db)
  const ada = await notebookToken('ada@example.com')
  const bob = await notebookToken('bob@example.com')
  const id = (await (await worker.fetch(authed('POST', '/api/notes', ada, { title: 'Draft', body: 'Words' }), env, {})).json()).note.id
  const patched = await worker.fetch(authed('PATCH', `/api/notes/${id}`, ada, { title: 'Final', checklist: [{ text: 'done', done: true }] }), env, {})
  assert.equal(patched.status, 200)
  assert.deepEqual((await patched.json()).note.checklist, [{ text: 'done', done: true }])
  assert.equal((await worker.fetch(authed('PATCH', `/api/notes/${id}`, bob, { title: 'Hijack' }), env, {})).status, 404)
  assert.equal((await worker.fetch(authed('PATCH', '/api/notes/999999', ada, { title: 'Ghost' }), env, {})).status, 404)
  assert.equal((await worker.fetch(authed('PATCH', '/api/notes/abc', ada, { title: 'Ghost' }), env, {})).status, 404)
  for (const bad of [{}, { title: 'x'.repeat(201) }, { body: '' }, { body: 'x'.repeat(20001) }, { checklist: ['x'.repeat(201)] }]) {
    assert.equal((await worker.fetch(authed('PATCH', `/api/notes/${id}`, ada, bad), env, {})).status, 400)
  }
})

test('notebook: delete removes own notes and 404s on others or ghosts', async () => {
  const db = makeNotebookDb()
  const env = notebookEnv(db)
  const ada = await notebookToken('ada@example.com')
  const bob = await notebookToken('bob@example.com')
  const id = (await (await worker.fetch(authed('POST', '/api/notes', ada, { body: 'Ephemeral' }), env, {})).json()).note.id
  assert.equal((await worker.fetch(authed('DELETE', `/api/notes/${id}`, bob), env, {})).status, 404)
  assert.equal((await worker.fetch(authed('DELETE', '/api/notes/999999', ada), env, {})).status, 404)
  const removed = await worker.fetch(authed('DELETE', `/api/notes/${id}`, ada), env, {})
  assert.equal(removed.status, 200)
  assert.deepEqual(await removed.json(), { ok: true, id })
  assert.deepEqual((await (await worker.fetch(authed('GET', '/api/notes', ada), env, {})).json()).notes, [])
})

test('notebook: validation rejects bad creates with 400', async () => {
  const db = makeNotebookDb()
  const env = notebookEnv(db)
  const ada = await notebookToken('ada@example.com')
  for (const bad of [
    {},
    { body: '' },
    { body: '   ' },
    { body: 'x'.repeat(20001) },
    { title: 'x'.repeat(201), body: 'ok' },
    { body: 'ok', checklist: 'nope' },
    { body: 'ok', checklist: new Array(101).fill('x') },
    { body: 'ok', checklist: ['x'.repeat(201)] },
    { body: 'ok', checklist: [null] },
  ]) {
    assert.equal((await worker.fetch(authed('POST', '/api/notes', ada, bad), env, {})).status, 400)
  }
  const minimal = await worker.fetch(authed('POST', '/api/notes', ada, { body: 'kept' }), env, {})
  assert.equal(minimal.status, 201)
  const kept = (await minimal.json()).note
  assert.deepEqual([kept.title, kept.checklist], ['', []])
})

test('notebook: anonymous API and page requests are rejected at the gate', async () => {
  const db = makeNotebookDb()
  const env = notebookEnv(db)
  assert.equal((await worker.fetch(authed('GET', '/api/notes', null), env, {})).status, 401)
  assert.equal((await worker.fetch(authed('POST', '/api/notes', null, { body: 'x' }), env, {})).status, 401)
  assert.equal((await worker.fetch(authed('PATCH', '/api/notes/1', null, { body: 'x' }), env, {})).status, 401)
  assert.equal((await worker.fetch(authed('DELETE', '/api/notes/1', null), env, {})).status, 401)
  for (const path of ['/notebook', '/notebook/']) {
    const page = await worker.fetch(new Request(`https://worldofgeor.com${path}`, { headers: { Accept: 'text/html' } }), env, {})
    assert.equal(page.status, 302, path)
    assert.match(page.headers.get('location'), /next=%2Fnotebook/, path)
    assert.equal(page.headers.get('cache-control'), 'no-store', path)
  }
  const script = await worker.fetch(new Request('https://worldofgeor.com/notebook.js', { headers: { 'Sec-Fetch-Dest': 'script' } }), env, {})
  assert.equal(script.status, 401)
  const ada = await notebookToken('ada@example.com')
  const authedPage = await worker.fetch(new Request('https://worldofgeor.com/notebook', { headers: { Cookie: `geor_token=${ada}`, Accept: 'text/html' } }), env, {})
  assert.equal(authedPage.status, 200)
  assert.equal(authedPage.headers.get('cache-control'), 'private, no-store')
})
