// Wave E4: marginalia — page-anchored notes surface in the article reader.
// Isolation (private invisible, shared visible), anchor filtering, caps,
// anonymous gate for API + script asset.
import test from 'node:test'
import assert from 'node:assert/strict'
import worker, { __test } from '../worker.js'
import { MARGINALIA_BODY_MAX, renderMarginaliaItem, renderMarginaliaList } from '../public/marginalia.js'

const SECRET = 'test-only-secret-that-is-longer-than-32-characters'

// Marginalia reuses the 0006 `notes` table shape (id INTEGER PK,
// member_email, page, anchor, body, shared). Starts present; ensureTables()
// only adds indexes.
function makeMarginaliaDb() {
  const tables = new Set(['users', 'invites', 'requests', 'activity', 'map_documents', 'rate_limits', 'reveals', 'notes', 'arcs', 'plots', 'threads', 'boards', 'member_library', 'workflow_items', 'workflow_history', 'notebook_notes'])
  const notes = new Map()
  const limits = new Map()
  let nextId = 1
  const stamp = () => new Date().toISOString()
  return {
    tables,
    notes,
    prepare(sql) {
      let args = []
      const api = {
        bind(...values) { args = values; return api },
        async run() {
          if (/CREATE TABLE IF NOT EXISTS/i.test(sql)) {
            tables.add(sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)[1])
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
          if (/INSERT INTO notes/i.test(sql)) {
            const [member_email, page, anchor, body, shared] = args
            const id = nextId++
            notes.set(id, { id, member_email, page, anchor, body, shared, created_at: stamp(), updated_at: stamp() })
            return { meta: { changes: 1, last_row_id: id } }
          }
          return { meta: { changes: 0 } }
        },
        async first() {
          if (sql.includes('FROM rate_limits')) {
            const record = limits.get(args[0])
            return record ? { attempts: record.attempts, reset_at: record.reset_at } : null
          }
          if (/FROM notes/i.test(sql)) {
            const [id, email] = args
            const row = notes.get(id)
            return row && row.member_email === email ? { ...row } : null
          }
          return null
        },
        async all() {
          if (/FROM notes/i.test(sql)) {
            const [page, email, maybeAnchor] = args
            const hasAnchor = /anchor\s*=\s*\?/i.test(sql)
            const rows = [...notes.values()]
              .filter(row => row.page === page
                && (row.member_email === email || Number(row.shared) === 1)
                && (!hasAnchor || row.anchor === maybeAnchor))
              .sort((a, b) => a.id - b.id)
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

async function marginaliaToken(email) {
  const now = Math.floor(Date.now() / 1000)
  return __test.signJwt({ email, iss: 'worldofgeor', iat: now, exp: now + 60 }, SECRET)
}

function marginaliaEnv(db) {
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

const PAGE = '/wiki/World/Nations/Central%20Erisdar/'

test('marginalia validators accept wiki pages and reject hostile shapes', () => {
  assert.equal(__test.cleanMarginaliaPage('/wiki/World/Nations/'), '/wiki/World/Nations/')
  assert.equal(__test.cleanMarginaliaPage(PAGE), PAGE)
  assert.equal(__test.cleanMarginaliaPage('  /wiki/World/  '), '/wiki/World/')
  for (const bad of ['', '   ', '/other/page', 'wiki/relative', '/wiki/../secret', '/wiki/has space', '/wiki/back\\slash', '/wiki/x?y=1', '/wiki/x#frag', 'https://evil.example/wiki/x', 42, null, undefined]) {
    assert.equal(__test.cleanMarginaliaPage(bad), null, String(bad))
  }
  assert.equal(__test.cleanMarginaliaPage(`/wiki/${'x'.repeat(500)}`), null)
  assert.equal(__test.cleanMarginaliaAnchor(undefined), '')
  assert.equal(__test.cleanMarginaliaAnchor(''), '')
  assert.equal(__test.cleanMarginaliaAnchor('   '), '')
  assert.equal(__test.cleanMarginaliaAnchor('  ember-arrival  '), 'ember-arrival')
  assert.equal(__test.cleanMarginaliaAnchor('x'.repeat(200)), 'x'.repeat(200))
  assert.equal(__test.cleanMarginaliaAnchor('x'.repeat(201)), null)
  assert.equal(__test.cleanMarginaliaAnchor(42), null)
  assert.equal(__test.cleanMarginaliaBody('  a margin thought  '), 'a margin thought')
  assert.equal(__test.cleanMarginaliaBody(''), null)
  assert.equal(__test.cleanMarginaliaBody('   '), null)
  assert.equal(__test.cleanMarginaliaBody(42), null)
  assert.equal(__test.cleanMarginaliaBody('x'.repeat(MARGINALIA_BODY_MAX)), 'x'.repeat(MARGINALIA_BODY_MAX))
  assert.equal(__test.cleanMarginaliaBody('x'.repeat(MARGINALIA_BODY_MAX + 1)), null)
})

test('marginalia render helpers escape hostile input and label provenance', () => {
  assert.match(renderMarginaliaList([]), /No marginalia yet/)
  assert.match(renderMarginaliaList(null), /No marginalia yet/)
  const own = renderMarginaliaItem({ id: 1, body: '<script>alert(1)</script>', anchor: 'arrival', mine: true, shared: false })
  assert.match(own, /&lt;script&gt;/)
  assert.doesNotMatch(own, /<script>/)
  assert.match(own, /Your note/)
  assert.match(own, /arrival/)
  assert.doesNotMatch(own, /SHARED/)
  const shared = renderMarginaliaItem({ id: 2, body: 'a clue', anchor: '', mine: false, author: 'bob@example.com', shared: true })
  assert.match(shared, /SHARED/)
  assert.match(shared, /bob@example\.com/)
  assert.doesNotMatch(shared, /Your note/)
  const hostile = renderMarginaliaItem({ id: 3, body: 'x', anchor: '"><img src=x>', mine: false, author: '<b>bob</b>', shared: true })
  assert.doesNotMatch(hostile, /<img|<b>/)
  assert.match(hostile, /&lt;b&gt;bob&lt;\/b&gt;/)
})

test('marginalia: note created on page X appears in the reader on page X for the author', async () => {
  const db = makeMarginaliaDb()
  const env = marginaliaEnv(db)
  const ada = await marginaliaToken('ada@example.com')
  const created = await worker.fetch(authed('POST', '/api/marginalia', ada, { page: PAGE, anchor: 'arrival', body: 'The harbor paragraph hides a date.' }), env, {})
  assert.equal(created.status, 201)
  const note = (await created.json()).note
  assert.deepEqual([note.page, note.anchor, note.body, note.shared, note.mine, note.author],
    [PAGE, 'arrival', 'The harbor paragraph hides a date.', false, true, null])
  const read = await worker.fetch(authed('GET', `/api/marginalia?page=${encodeURIComponent(PAGE)}`, ada), env, {})
  assert.equal(read.status, 200)
  const notes = (await read.json()).notes
  assert.equal(notes.length, 1)
  assert.equal(notes[0].body, 'The harbor paragraph hides a date.')
  const otherPage = await (await worker.fetch(authed('GET', '/api/marginalia?page=/wiki/World/Nations/Other/', ada), env, {})).json()
  assert.deepEqual(otherPage.notes, [])
})

test('marginalia: private notes are invisible to others, shared notes surface with author', async () => {
  const db = makeMarginaliaDb()
  const env = marginaliaEnv(db)
  const ada = await marginaliaToken('ada@example.com')
  const bob = await marginaliaToken('bob@example.com')
  await worker.fetch(authed('POST', '/api/marginalia', ada, { page: PAGE, body: 'private theory' }), env, {})
  await worker.fetch(authed('POST', '/api/marginalia', ada, { page: PAGE, anchor: 'treaty', body: 'shared clue', shared: true }), env, {})
  const bobView = await (await worker.fetch(authed('GET', `/api/marginalia?page=${encodeURIComponent(PAGE)}`, bob), env, {})).json()
  assert.equal(bobView.notes.length, 1)
  assert.deepEqual([bobView.notes[0].body, bobView.notes[0].mine, bobView.notes[0].author, bobView.notes[0].shared],
    ['shared clue', false, 'ada@example.com', true])
  assert.doesNotMatch(JSON.stringify(bobView), /private theory/)
  const adaView = await (await worker.fetch(authed('GET', `/api/marginalia?page=${encodeURIComponent(PAGE)}`, ada), env, {})).json()
  assert.equal(adaView.notes.length, 2)
})

test('marginalia: anchor filtering narrows the strip', async () => {
  const db = makeMarginaliaDb()
  const env = marginaliaEnv(db)
  const ada = await marginaliaToken('ada@example.com')
  await worker.fetch(authed('POST', '/api/marginalia', ada, { page: PAGE, anchor: 'arrival', body: 'anchored thought' }), env, {})
  await worker.fetch(authed('POST', '/api/marginalia', ada, { page: PAGE, body: 'whole-page thought' }), env, {})
  const filtered = await (await worker.fetch(authed('GET', `/api/marginalia?page=${encodeURIComponent(PAGE)}&anchor=arrival`, ada), env, {})).json()
  assert.deepEqual(filtered.notes.map(note => note.body), ['anchored thought'])
  const empty = await (await worker.fetch(authed('GET', `/api/marginalia?page=${encodeURIComponent(PAGE)}&anchor=${encodeURIComponent('elsewhere')}`, ada), env, {})).json()
  assert.deepEqual(empty.notes, [])
})

test('marginalia: validation rejects bad payloads with 400', async () => {
  const db = makeMarginaliaDb()
  const env = marginaliaEnv(db)
  const ada = await marginaliaToken('ada@example.com')
  assert.equal((await worker.fetch(authed('GET', '/api/marginalia', ada), env, {})).status, 400)
  assert.equal((await worker.fetch(authed('GET', '/api/marginalia?page=/other/page', ada), env, {})).status, 400)
  assert.equal((await worker.fetch(authed('GET', `/api/marginalia?page=${encodeURIComponent(PAGE)}&anchor=${'x'.repeat(201)}`, ada), env, {})).status, 400)
  for (const bad of [
    {},
    { page: PAGE },
    { body: 'no page' },
    { page: '/other/page', body: 'off-archive' },
    { page: '/wiki/../secret', body: 'traversal' },
    { page: PAGE, body: '' },
    { page: PAGE, body: '   ' },
    { page: PAGE, body: 42 },
    { page: PAGE, body: 'x'.repeat(MARGINALIA_BODY_MAX + 1) },
    { page: PAGE, body: 'ok', anchor: 'x'.repeat(201) },
    { page: PAGE, body: 'ok', anchor: 42 },
  ]) {
    assert.equal((await worker.fetch(authed('POST', '/api/marginalia', ada, bad), env, {})).status, 400, JSON.stringify(bad).slice(0, 80))
  }
  const sharedFlag = await worker.fetch(authed('POST', '/api/marginalia', ada, { page: PAGE, body: 'open clue', shared: true }), env, {})
  assert.equal(sharedFlag.status, 201)
  assert.equal((await sharedFlag.json()).note.shared, true)
})

test('marginalia: anonymous API and script requests are rejected at the gate', async () => {
  const db = makeMarginaliaDb()
  const env = marginaliaEnv(db)
  assert.equal((await worker.fetch(authed('GET', `/api/marginalia?page=${encodeURIComponent(PAGE)}`, null), env, {})).status, 401)
  assert.equal((await worker.fetch(authed('POST', '/api/marginalia', null, { page: PAGE, body: 'x' }), env, {})).status, 401)
  const script = await worker.fetch(new Request('https://worldofgeor.com/marginalia.js', { headers: { 'Sec-Fetch-Dest': 'script' } }), env, {})
  assert.equal(script.status, 401)
  const ada = await marginaliaToken('ada@example.com')
  const authedScript = await worker.fetch(new Request('https://worldofgeor.com/marginalia.js', { headers: { Cookie: `geor_token=${ada}`, 'Sec-Fetch-Dest': 'script' } }), env, {})
  assert.equal(authedScript.status, 200)
})
