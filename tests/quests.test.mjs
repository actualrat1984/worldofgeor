// Wave F4: lore quest board — a guild-board skin over the author's real
// threads. No new API and no new tables: boards read GET /api/arcs plus
// GET /api/threads?arc=, and seals move through PATCH /api/threads/:id.
// Tests verify the open/settled split, member isolation, the anon gate,
// transition reuse of the existing endpoint, and the page shell.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import worker, { __test } from '../worker.js'
import {
  questArcOptions,
  renderQuestBoard,
  renderQuestBoards,
  renderQuestPosting,
  renderSettledContracts,
  splitQuestThreads,
} from '../public/quests.js'

const SECRET = 'test-only-secret-that-is-longer-than-32-characters'

// Isolated arcs + threads store. Tables start present (0006 ships
// them); scoping runs through arcs.created_by — threads carry no
// member column, mirroring ensureTables().
function makeQuestsDb() {
  const tables = new Set(['users', 'invites', 'requests', 'activity', 'map_documents', 'rate_limits', 'reveals', 'notes', 'arcs', 'plots', 'threads', 'boards', 'member_library', 'workflow_items', 'workflow_history', 'notebook_notes'])
  const arcs = new Map()
  const threads = new Map()
  const limits = new Map()
  const stamp = () => new Date().toISOString()
  return {
    tables,
    arcs,
    threads,
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
          if (/INSERT INTO arcs/i.test(sql)) {
            const [id, title, summary, status, created_by] = args
            const at = stamp()
            arcs.set(id, { id, title, summary, status, created_by, created_at: at, updated_at: at })
            return { meta: { changes: 1 } }
          }
          if (/INSERT INTO threads/i.test(sql)) {
            const [id, arc_id, title, state] = args
            const at = stamp()
            threads.set(id, { id, arc_id, title, state, created_at: at, updated_at: at })
            return { meta: { changes: 1 } }
          }
          if (/UPDATE threads SET/i.test(sql)) {
            const id = args[args.length - 1]
            const row = threads.get(id)
            if (!row) return { meta: { changes: 0 } }
            const setPart = sql.slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'))
            const cols = [...setPart.matchAll(/(\w+)\s*=\s*\?/g)].map(match => match[1])
            cols.forEach((col, index) => { row[col] = args[index] })
            if (/updated_at = strftime/i.test(sql)) row.updated_at = stamp()
            return { meta: { changes: 1 } }
          }
          return { meta: { changes: 0 } }
        },
        async first() {
          if (sql.includes('FROM rate_limits')) {
            const record = limits.get(args[0])
            return record ? { attempts: record.attempts, reset_at: record.reset_at } : null
          }
          if (sql.includes('FROM arcs')) {
            if (sql.includes('AND created_by')) {
              const row = arcs.get(args[0])
              return row && row.created_by === args[1] ? { ...row } : null
            }
            return null
          }
          if (sql.includes('FROM threads')) {
            const row = threads.get(args[0])
            return row ? { ...row } : null
          }
          return null
        },
        async all() {
          if (sql.includes('FROM arcs')) {
            const rows = [...arcs.values()].filter(row => row.created_by === args[0])
            rows.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
            return { results: rows.map(row => ({ ...row })) }
          }
          if (sql.includes('FROM threads')) {
            const rows = [...threads.values()].filter(row => row.arc_id === args[0])
            rows.sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
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

async function questsToken(email) {
  const now = Math.floor(Date.now() / 1000)
  return __test.signJwt({ email, iss: 'worldofgeor', iat: now, exp: now + 60 }, SECRET)
}

function questsEnv(db) {
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

async function makeArc(env, token, title = 'Ember Arc') {
  const response = await worker.fetch(authed('POST', '/api/arcs', token, { title }), env, {})
  assert.equal(response.status, 201)
  return (await response.json()).arc
}

async function makeThread(env, token, arcId, title, state) {
  const body = state === undefined ? { arc_id: arcId, title } : { arc_id: arcId, title, state }
  const response = await worker.fetch(authed('POST', '/api/threads', token, body), env, {})
  assert.equal(response.status, 201)
  return (await response.json()).thread
}

test('quests: open/settled split keeps seed and active pinned, resolved settled', () => {
  const { open, settled } = splitQuestThreads([
    { id: 't1', title: 'The missing seal', state: 'seed' },
    { id: 't2', title: 'The open gate', state: 'active' },
    { id: 't3', title: 'The buried crown', state: 'resolved' },
    { id: 't4', title: 'The strange omen', state: 'mystery' },
  ])
  assert.deepEqual(open.map(thread => thread.id), ['t1', 't2', 't4'])
  assert.deepEqual(settled.map(thread => thread.id), ['t3'])
  assert.deepEqual(splitQuestThreads([]), { open: [], settled: [] })
  assert.deepEqual(splitQuestThreads(null), { open: [], settled: [] })
})

test('quests: postings carry title, seal, arc name, and reseal buttons — all escaped', () => {
  const html = renderQuestPosting({ id: 't1', title: '<b>Fall</b>', state: 'active' }, 'Ember <Arc>')
  assert.match(html, /❧ &lt;b&gt;Fall&lt;\/b&gt;/)
  assert.doesNotMatch(html, /<b>Fall<\/b>/)
  assert.match(html, /Pinned under Ember &lt;Arc&gt;/)
  assert.match(html, /ACTIVE/)
  assert.match(html, /data-thread-id="t1" data-thread-state="resolved"/)
  const seeded = renderQuestPosting({ id: 't2', title: 'The seal', state: 'seed' }, 'Ember Arc')
  assert.match(seeded, /SEED/)
  const settled = renderQuestPosting({ id: 't3', title: 'The crown', state: 'resolved' }, 'Ember Arc')
  assert.match(settled, /RESOLVED/)
})

test('quests: per-arc boards and settled rolls render with empty states', () => {
  const boards = renderQuestBoards(
    [{ id: 'a1', title: 'Ember Arc' }, { id: 'a2', title: 'Hollow Arc' }],
    new Map([['a1', [{ id: 't1', title: 'The seal', state: 'seed' }]], ['a2', []]]),
  )
  assert.match(boards, /Ember Arc/)
  assert.match(boards, /The seal/)
  assert.match(boards, /the guild rests easy here/)
  assert.match(renderQuestBoards([], new Map()), /crown the first one/)
  assert.match(renderQuestBoard('Ember Arc', []), /the guild rests easy here/)
  const rolls = renderSettledContracts([{ thread: { id: 't3', title: 'The crown', state: 'resolved' }, arcTitle: 'Ember Arc' }])
  assert.match(rolls, /The crown/)
  assert.match(rolls, /Ember Arc/)
  assert.match(renderSettledContracts([]), /No settled contracts yet/)
  assert.deepEqual(questArcOptions([{ id: 'b', title: 'Zeta' }, { id: 'a', title: 'Alpha' }, { id: 'c', title: '' }]).map(entry => entry.title), ['Alpha', 'Zeta'])
})

test('quests: member isolation — another member’s threads stay invisible', async () => {
  const db = makeQuestsDb()
  const env = questsEnv(db)
  const ada = await questsToken('ada@example.com')
  const bob = await questsToken('bob@example.com')
  const arc = await makeArc(env, ada, 'Ember Arc')
  await makeThread(env, ada, arc.id, 'The missing seal')
  await makeThread(env, ada, arc.id, 'The open gate', 'active')
  await makeThread(env, ada, arc.id, 'The buried crown', 'resolved')
  // Bob cannot list, read through, or move Ada's threads — a foreign
  // arc id reads as a generic 404, never confirming her titles.
  assert.equal((await worker.fetch(authed('GET', `/api/threads?arc=${arc.id}`, bob), env, {})).status, 404)
  const bobArcs = await (await worker.fetch(authed('GET', '/api/arcs', bob), env, {})).json()
  assert.deepEqual(bobArcs.arcs, [])
  const adaListed = await (await worker.fetch(authed('GET', `/api/threads?arc=${arc.id}`, ada), env, {})).json()
  assert.equal(adaListed.threads.length, 3)
  const { open, settled } = splitQuestThreads(adaListed.threads)
  assert.equal(open.length, 2)
  assert.equal(settled.length, 1)
  const victim = adaListed.threads[0].id
  assert.equal((await worker.fetch(authed('PATCH', `/api/threads/${victim}`, bob, { state: 'resolved' }), env, {})).status, 404)
})

test('quests: state seals move through the existing threads endpoint — no quest API', async () => {
  const db = makeQuestsDb()
  const env = questsEnv(db)
  const ada = await questsToken('ada@example.com')
  const arc = await makeArc(env, ada, 'Ember Arc')
  const thread = await makeThread(env, ada, arc.id, 'The missing seal')
  assert.equal(thread.state, 'seed')
  const active = await worker.fetch(authed('PATCH', `/api/threads/${thread.id}`, ada, { state: 'active' }), env, {})
  assert.equal(active.status, 200)
  assert.equal((await active.json()).thread.state, 'active')
  const resolved = await worker.fetch(authed('PATCH', `/api/threads/${thread.id}`, ada, { state: 'resolved' }), env, {})
  assert.equal(resolved.status, 200)
  assert.equal((await resolved.json()).thread.state, 'resolved')
  const listed = await (await worker.fetch(authed('GET', `/api/threads?arc=${arc.id}`, ada), env, {})).json()
  assert.deepEqual(splitQuestThreads(listed.threads).settled.map(entry => entry.id), [thread.id])
  const workerSource = readFileSync(new URL('../worker.js', import.meta.url), 'utf8')
  assert.doesNotMatch(workerSource, /\/api\/quests/)
  assert.match(workerSource, /PATCH \/api\/threads\/:id/)
})

test('quests: anonymous board, script, and thread API requests are rejected at the gate', async () => {
  const db = makeQuestsDb()
  const env = questsEnv(db)
  const ada = await questsToken('ada@example.com')
  const arc = await makeArc(env, ada, 'Gated')
  assert.equal((await worker.fetch(authed('GET', `/api/threads?arc=${arc.id}`, null), env, {})).status, 401)
  assert.equal((await worker.fetch(authed('POST', '/api/threads', null, { arc_id: arc.id, title: 'x' }), env, {})).status, 401)
  assert.equal((await worker.fetch(authed('PATCH', '/api/threads/some-id', null, { state: 'active' }), env, {})).status, 401)
  for (const path of ['/quests', '/quests/']) {
    const page = await worker.fetch(new Request(`https://worldofgeor.com${path}`, { headers: { Accept: 'text/html' } }), env, {})
    assert.equal(page.status, 302, path)
    assert.match(page.headers.get('location'), /next=%2Fquests/, path)
    assert.equal(page.headers.get('cache-control'), 'no-store', path)
  }
  const script = await worker.fetch(new Request('https://worldofgeor.com/quests.js', { headers: { 'Sec-Fetch-Dest': 'script' } }), env, {})
  assert.equal(script.status, 401)
  const authedPage = await worker.fetch(new Request('https://worldofgeor.com/quests', { headers: { Cookie: `geor_token=${ada}`, Accept: 'text/html' } }), env, {})
  assert.equal(authedPage.status, 200)
  assert.equal(authedPage.headers.get('cache-control'), 'private, no-store')
})

test('quests gate: worker treats page and script as private', () => {
  assert.equal(__test.isPrivatePath('/quests'), true)
  assert.equal(__test.isPrivatePath('/quests/'), true)
  assert.equal(__test.isPrivatePath('/quests.html'), true)
  assert.equal(__test.isPrivatePath('/quests.js'), true)
})

test('quests shell mounts the arc filter, per-arc boards, and settled rolls while staying noindex', () => {
  const html = readFileSync(new URL('../public/quests.html', import.meta.url), 'utf8')
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive" \/>/)
  assert.match(html, /id="questArcFilter"/)
  assert.match(html, /id="questBoards"/)
  assert.match(html, /id="settledContracts"/)
  assert.match(html, /id="questsStatus"/)
  assert.match(html, /id="questsCount"/)
  assert.match(html, /src="\/quests\.js"/)
  assert.match(html, /src="\/archive-compass\.js"/)
  const script = readFileSync(new URL('../public/quests.js', import.meta.url), 'utf8')
  assert.match(script, /from '\.\/timeline\.js'/)
  assert.match(script, /escapeHtml/)
  assert.match(script, /credentials: 'same-origin'/)
  assert.match(script, /\/\?next=' \+ encodeURIComponent\('\/quests'\)/)
  assert.match(script, /\/api\/arcs/)
  assert.match(script, /\/api\/threads\?arc=/)
  assert.match(script, /\/api\/threads\/\$\{encodeURIComponent\(id\)\}.*method: 'PATCH'/)
  const workerSource = readFileSync(new URL('../worker.js', import.meta.url), 'utf8')
  assert.match(workerSource, /\['\/quests', '\/quests\.html'\]/)
  assert.match(workerSource, /'\/quests\.js'/)
  const compass = readFileSync(new URL('../public/archive-compass.js', import.meta.url), 'utf8')
  assert.match(compass, /url: '\/quests'/)
})
