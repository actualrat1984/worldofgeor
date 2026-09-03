// Wave E3: whiteboards — isolation, caps, wiki-link checks, gate.
import test from 'node:test'
import assert from 'node:assert/strict'
import worker, { __test } from '../worker.js'
import { arrowEndpoints, renderArrowList, renderBoardList, renderCard, shapeNewArrow, shapeNewCard } from '../public/boards.js'

const SECRET = 'test-only-secret-that-is-longer-than-32-characters'

// Boards store reusing the 0006 `boards` table shape (id TEXT PK,
// owner_email, title, doc_json). Starts present — the wave reuses the
// table; ensureTables() only adds the owner index.
function makeBoardsDb() {
  const tables = new Set(['users', 'invites', 'requests', 'activity', 'map_documents', 'rate_limits', 'reveals', 'notes', 'arcs', 'plots', 'threads', 'boards', 'member_library', 'workflow_items', 'workflow_history', 'notebook_notes'])
  const boards = new Map()
  const limits = new Map()
  const stamp = () => new Date().toISOString()
  return {
    tables,
    boards,
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
          if (/INSERT INTO boards/i.test(sql)) {
            const [id, owner_email, title, doc_json] = args
            boards.set(id, { id, owner_email, title, doc_json, updated_at: stamp() })
            return { meta: { changes: 1 } }
          }
          if (/UPDATE boards/i.test(sql)) {
            const id = args[args.length - 2]
            const email = args[args.length - 1]
            const row = boards.get(id)
            if (!row || row.owner_email !== email) return { meta: { changes: 0 } }
            const setPart = sql.slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'))
            const cols = [...setPart.matchAll(/(\w+)\s*=\s*\?/g)].map(match => match[1])
            cols.forEach((col, index) => { row[col] = args[index] })
            if (/updated_at = strftime/i.test(sql)) row.updated_at = stamp()
            return { meta: { changes: 1 } }
          }
          if (/DELETE FROM boards/i.test(sql)) {
            const [id, email] = args
            const row = boards.get(id)
            if (!row || row.owner_email !== email) return { meta: { changes: 0 } }
            boards.delete(id)
            return { meta: { changes: 1 } }
          }
          return { meta: { changes: 0 } }
        },
        async first() {
          if (sql.includes('FROM rate_limits')) {
            const record = limits.get(args[0])
            return record ? { attempts: record.attempts, reset_at: record.reset_at } : null
          }
          if (/FROM boards/i.test(sql)) {
            const [id, email] = args
            const row = boards.get(id)
            return row && row.owner_email === email ? { ...row } : null
          }
          return null
        },
        async all() {
          if (/FROM boards/i.test(sql)) {
            const [email] = args
            const rows = [...boards.values()].filter(row => row.owner_email === email)
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

async function boardToken(email) {
  const now = Math.floor(Date.now() / 1000)
  return __test.signJwt({ email, iss: 'worldofgeor', iat: now, exp: now + 60 }, SECRET)
}

function boardEnv(db) {
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

const fiftyCards = () => Array.from({ length: 50 }, (_, index) => ({
  id: `card-${index}`, x: index * 10, y: index * 5, title: `Plot ${index}`, body: '', wiki: index % 2 ? '/wiki/World/' : '',
}))

test('board validators accept good docs and reject hostile shapes', () => {
  assert.equal(__test.cleanBoardTitle('  Ember plot  '), 'Ember plot')
  assert.equal(__test.cleanBoardTitle(''), null)
  assert.equal(__test.cleanBoardTitle('   '), null)
  assert.equal(__test.cleanBoardTitle('x'.repeat(200)), 'x'.repeat(200))
  assert.equal(__test.cleanBoardTitle('x'.repeat(201)), null)
  assert.equal(__test.cleanBoardTitle(42), null)
  assert.equal(__test.cleanBoardId('card-1_2'), 'card-1_2')
  assert.equal(__test.cleanBoardId('../evil'), null)
  assert.equal(__test.cleanBoardId(''), null)
  assert.equal(__test.cleanBoardId('x'.repeat(65)), null)
  assert.equal(__test.cleanBoardWiki(''), '')
  assert.equal(__test.cleanBoardWiki(undefined), '')
  assert.equal(__test.cleanBoardWiki('/wiki/World/Nations/'), '/wiki/World/Nations/')
  for (const bad of ['https://evil.example/wiki/x', '/other/page', '/wiki/../secret', '/wiki/has space', '/wiki/back\\slash', 'wiki/relative', 42]) {
    assert.equal(__test.cleanBoardWiki(bad), null, String(bad))
  }
  assert.equal(__test.cleanBoardCoord(12.345), 12.35)
  assert.equal(__test.cleanBoardCoord(NaN), null)
  assert.equal(__test.cleanBoardCoord(Infinity), null)
  assert.equal(__test.cleanBoardCoord(100001), null)
  assert.equal(__test.cleanBoardCoord('12'), null)
  const cards = __test.cleanBoardCards([{ id: 'a', x: 0, y: 0, title: ' A ', wiki: '/wiki/World/' }])
  assert.deepEqual(cards, [{ id: 'a', x: 0, y: 0, title: 'A', body: '', wiki: '/wiki/World/' }])
  assert.equal(__test.cleanBoardCards('nope'), null)
  assert.equal(__test.cleanBoardCards(new Array(201).fill({ id: 'a', x: 0, y: 0 })), null)
  assert.equal(__test.cleanBoardCards([{ id: 'a', x: 0, y: 0 }, { id: 'a', x: 1, y: 1 }]), null)
  assert.equal(__test.cleanBoardCards([{ id: 'a', x: NaN, y: 0 }]), null)
  assert.equal(__test.cleanBoardCards([{ id: 'a', x: 0, y: 0, title: 'x'.repeat(201) }]), null)
  assert.equal(__test.cleanBoardCards([{ id: 'a', x: 0, y: 0, body: 'x'.repeat(2001) }]), null)
  assert.equal(__test.cleanBoardCards([{ id: 'a', x: 0, y: 0, wiki: 'https://evil.example/' }]), null)
  assert.equal(__test.cleanBoardCards([{ id: '../x', x: 0, y: 0 }]), null)
  const ids = new Set(['a', 'b'])
  assert.deepEqual(__test.cleanBoardArrows([{ from: 'a', to: 'b' }], ids), [{ id: 'arrow-0', from: 'a', to: 'b' }])
  assert.deepEqual(
    __test.cleanBoardArrows([{ id: 'edge-1', from: 'a', to: 'b' }], ids),
    [{ id: 'edge-1', from: 'a', to: 'b' }],
  )
  assert.equal(__test.cleanBoardArrows([{ from: 'a', to: 'ghost' }], ids), null)
  assert.equal(__test.cleanBoardArrows([{ from: 'a' }], ids), null)
  assert.equal(__test.cleanBoardArrows('nope', ids), null)
  assert.equal(__test.cleanBoardArrows(new Array(401).fill({ from: 'a', to: 'b' }), ids), null)
})

test('board render helpers escape hostile input and resolve endpoints', () => {
  assert.match(renderBoardList([], null), /No whiteboards yet/)
  assert.match(renderBoardList([{ id: 'b1', title: '<b>', cardCount: 2, arrowCount: 1 }], 'b1'), /&lt;b&gt;/)
  assert.doesNotMatch(renderBoardList([{ id: 'b1', title: '<b>' }], 'b1'), /<b>/)
  const card = renderCard({ id: 'c1', x: 10, y: 20, title: '<script>', body: 'x', wiki: '/wiki/World/' }, true)
  assert.match(card, /&lt;script&gt;/)
  assert.match(card, /translate\(10px, 20px\)/)
  assert.doesNotMatch(card, /<script>/)
  const byId = new Map([['a', { id: 'a', x: 0, y: 0 }], ['b', { id: 'b', x: 100, y: 50 }]])
  assert.deepEqual(arrowEndpoints({ from: 'a', to: 'b' }, byId), { x1: 0, y1: 0, x2: 100, y2: 50 })
  assert.equal(arrowEndpoints({ from: 'a', to: 'ghost' }, byId), null)
  assert.match(renderArrowList([], byId), /No arrows yet/)
  assert.match(renderArrowList([{ id: 'e1', from: 'a', to: 'b' }], byId), /→/)
  assert.equal(shapeNewCard(5, 7, 'fixed').id, 'fixed')
  assert.equal(shapeNewArrow('a', 'b', 'fixed-edge').id, 'fixed-edge')
  assert.match(shapeNewCard(0, 0).id, /^card-/)
})

test('boards: create lists own boards only and a full doc round-trips', async () => {
  const db = makeBoardsDb()
  const env = boardEnv(db)
  const ada = await boardToken('ada@example.com')
  const bob = await boardToken('bob@example.com')
  const created = await worker.fetch(authed('POST', '/api/boards', ada, { title: 'Ember schemes' }), env, {})
  assert.equal(created.status, 201)
  const board = (await created.json()).board
  assert.deepEqual([board.title, board.cards, board.arrows], ['Ember schemes', [], []])
  const put = await worker.fetch(authed('PUT', `/api/boards/${board.id}`, ada, {
    cards: fiftyCards(),
    arrows: [{ id: 'edge-1', from: 'card-0', to: 'card-1' }],
  }), env, {})
  assert.equal(put.status, 200)
  assert.deepEqual(
    (await put.json()).board.arrows,
    [{ id: 'edge-1', from: 'card-0', to: 'card-1' }],
  )
  const restored = await (await worker.fetch(authed('GET', `/api/boards/${board.id}`, ada), env, {})).json()
  assert.equal(restored.board.cards.length, 50)
  assert.equal(restored.board.cards[7].wiki, '/wiki/World/')
  await worker.fetch(authed('POST', '/api/boards', bob, { title: 'Bob private' }), env, {})
  const adaList = await (await worker.fetch(authed('GET', '/api/boards', ada), env, {})).json()
  assert.equal(adaList.boards.length, 1)
  assert.equal(adaList.boards[0].cardCount, 50)
  assert.equal(adaList.boards[0].arrowCount, 1)
  const bobList = await (await worker.fetch(authed('GET', '/api/boards', bob), env, {})).json()
  assert.deepEqual(bobList.boards.map(entry => entry.title), ['Bob private'])
})

test('boards: cross-member reads, writes, and deletes 404', async () => {
  const db = makeBoardsDb()
  const env = boardEnv(db)
  const ada = await boardToken('ada@example.com')
  const bob = await boardToken('bob@example.com')
  const id = (await (await worker.fetch(authed('POST', '/api/boards', ada, { title: 'Secret plot' }), env, {})).json()).board.id
  assert.equal((await worker.fetch(authed('GET', `/api/boards/${id}`, bob), env, {})).status, 404)
  assert.equal((await worker.fetch(authed('PUT', `/api/boards/${id}`, bob, { cards: [], arrows: [] }), env, {})).status, 404)
  assert.equal((await worker.fetch(authed('DELETE', `/api/boards/${id}`, bob), env, {})).status, 404)
  assert.equal((await worker.fetch(authed('GET', '/api/boards/no-such-board', ada), env, {})).status, 404)
  assert.equal((await worker.fetch(authed('GET', '/api/boards/%2E%2E%2Fevil', ada), env, {})).status, 404)
  const removed = await worker.fetch(authed('DELETE', `/api/boards/${id}`, ada), env, {})
  assert.equal(removed.status, 200)
  assert.deepEqual(await removed.json(), { ok: true, id })
  assert.deepEqual((await (await worker.fetch(authed('GET', '/api/boards', ada), env, {})).json()).boards, [])
})

test('boards: caps and bad links are rejected with 400', async () => {
  const db = makeBoardsDb()
  const env = boardEnv(db)
  const ada = await boardToken('ada@example.com')
  const id = (await (await worker.fetch(authed('POST', '/api/boards', ada, { title: 'Caps' }), env, {})).json()).board.id
  for (const badTitle of [{}, { title: '' }, { title: '   ' }, { title: 'x'.repeat(201) }, { title: 42 }]) {
    assert.equal((await worker.fetch(authed('POST', '/api/boards', ada, badTitle), env, {})).status, 400)
  }
  const tooManyCards = Array.from({ length: 201 }, (_, index) => ({ id: `c-${index}`, x: 0, y: 0 }))
  assert.equal((await worker.fetch(authed('PUT', `/api/boards/${id}`, ada, { cards: tooManyCards, arrows: [] }), env, {})).status, 400)
  const twoCards = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 1 }]
  const tooManyArrows = Array.from({ length: 401 }, (_, index) => ({ id: `e-${index}`, from: 'a', to: 'b' }))
  assert.equal((await worker.fetch(authed('PUT', `/api/boards/${id}`, ada, { cards: twoCards, arrows: tooManyArrows }), env, {})).status, 400)
  for (const bad of [
    { cards: [{ id: 'a', x: 0, y: 0, wiki: 'https://evil.example/x' }], arrows: [] },
    { cards: [{ id: 'a', x: 0, y: 0, wiki: '/other/page' }], arrows: [] },
    { cards: [{ id: 'a', x: 0, y: 0, wiki: '/wiki/../secret' }], arrows: [] },
    { cards: [{ id: 'a', x: 0, y: 0 }], arrows: [{ from: 'a', to: 'ghost' }] },
    { cards: [{ id: 'a', x: 0, y: 0 }, { id: 'a', x: 1, y: 1 }], arrows: [] },
    { cards: [{ id: 'a', x: NaN, y: 0 }], arrows: [] },
    { cards: [{ id: 'a', x: 0, y: 0, title: 'x'.repeat(201) }], arrows: [] },
    { cards: [{ id: 'a', x: 0, y: 0, body: 'x'.repeat(2001) }], arrows: [] },
    { cards: 'nope', arrows: [] },
    { cards: twoCards },
    { cards: twoCards, arrows: [], title: 'x'.repeat(201) },
  ]) {
    assert.equal((await worker.fetch(authed('PUT', `/api/boards/${id}`, ada, bad), env, {})).status, 400)
  }
  const renamed = await worker.fetch(authed('PUT', `/api/boards/${id}`, ada, { cards: [], arrows: [], title: 'Renamed' }), env, {})
  assert.equal(renamed.status, 200)
  assert.equal((await renamed.json()).board.title, 'Renamed')
})

test('boards: anonymous API and page requests are rejected at the gate', async () => {
  const db = makeBoardsDb()
  const env = boardEnv(db)
  assert.equal((await worker.fetch(authed('GET', '/api/boards', null), env, {})).status, 401)
  assert.equal((await worker.fetch(authed('POST', '/api/boards', null, { title: 'x' }), env, {})).status, 401)
  assert.equal((await worker.fetch(authed('PUT', '/api/boards/any-id', null, { cards: [], arrows: [] }), env, {})).status, 401)
  assert.equal((await worker.fetch(authed('DELETE', '/api/boards/any-id', null), env, {})).status, 401)
  for (const path of ['/boards', '/boards/']) {
    const page = await worker.fetch(new Request(`https://worldofgeor.com${path}`, { headers: { Accept: 'text/html' } }), env, {})
    assert.equal(page.status, 302, path)
    assert.match(page.headers.get('location'), /next=%2Fboards/, path)
    assert.equal(page.headers.get('cache-control'), 'no-store', path)
  }
  const script = await worker.fetch(new Request('https://worldofgeor.com/boards.js', { headers: { 'Sec-Fetch-Dest': 'script' } }), env, {})
  assert.equal(script.status, 401)
  const ada = await boardToken('ada@example.com')
  const authedPage = await worker.fetch(new Request('https://worldofgeor.com/boards', { headers: { Cookie: `geor_token=${ada}`, Accept: 'text/html' } }), env, {})
  assert.equal(authedPage.status, 200)
  assert.equal(authedPage.headers.get('cache-control'), 'private, no-store')
})
