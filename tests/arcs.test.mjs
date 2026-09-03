// Wave F1: story arcs + plot trees — isolation, loop guard, depth cap,
// state enum, gate. Reuses the 0006 arcs/plots/threads tables (already in
// the mock's table set, mirroring ensureTables()).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import worker, { __test } from '../worker.js'
import {
  arcOptions,
  layoutPlotTree,
  renderPlotTreeSVG,
  renderThreadList,
} from '../public/arcs.js'

const SECRET = 'test-only-secret-that-is-longer-than-32-characters'

// Isolated arcs store. Tables start present (0006 ships them); scoping runs
// through arcs.created_by — plots + threads carry no member column.
function makeArcsDb() {
  const tables = new Set(['users', 'invites', 'requests', 'activity', 'map_documents', 'rate_limits', 'reveals', 'notes', 'arcs', 'plots', 'threads', 'boards', 'member_library', 'workflow_items', 'workflow_history', 'notebook_notes'])
  const arcs = new Map()
  const plots = new Map()
  const threads = new Map()
  const limits = new Map()
  const stamp = () => new Date().toISOString()
  return {
    tables,
    arcs,
    plots,
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
          if (/INSERT INTO plots/i.test(sql)) {
            const [id, arc_id, parent_id, title, summary, is_master, sort] = args
            plots.set(id, { id, arc_id, parent_id, title, summary, is_master, sort })
            return { meta: { changes: 1 } }
          }
          if (/INSERT INTO threads/i.test(sql)) {
            const [id, arc_id, title, state] = args
            const at = stamp()
            threads.set(id, { id, arc_id, title, state, created_at: at, updated_at: at })
            return { meta: { changes: 1 } }
          }
          if (/UPDATE plots SET/i.test(sql)) {
            const id = args[args.length - 1]
            const row = plots.get(id)
            if (!row) return { meta: { changes: 0 } }
            const setPart = sql.slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'))
            const cols = [...setPart.matchAll(/(\w+)\s*=\s*\?/g)].map(match => match[1])
            cols.forEach((col, index) => { row[col] = args[index] })
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
          if (sql.includes('FROM plots')) {
            const row = plots.get(args[0])
            if (!row) return null
            if (sql.includes('title')) return { ...row }
            return { id: row.id, arc_id: row.arc_id, parent_id: row.parent_id }
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
          if (sql.includes('FROM plots')) {
            const rows = [...plots.values()].filter(row => row.arc_id === args[0])
            rows.sort((a, b) => (a.sort - b.sort) || String(a.title).localeCompare(String(b.title)))
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

async function arcsToken(email) {
  const now = Math.floor(Date.now() / 1000)
  return __test.signJwt({ email, iss: 'worldofgeor', iat: now, exp: now + 60 }, SECRET)
}

function arcsEnv(db) {
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

async function makePlot(env, token, arcId, title, extra = {}) {
  const response = await worker.fetch(authed('POST', '/api/plots', token, { arc_id: arcId, title, ...extra }), env, {})
  assert.equal(response.status, 201)
  return (await response.json()).plot
}

test('arcs validators accept good input and reject hostile shapes', () => {
  assert.equal(__test.cleanArcTitle('  Ember  '), 'Ember')
  assert.equal(__test.cleanArcTitle(''), null)
  assert.equal(__test.cleanArcTitle('   '), null)
  assert.equal(__test.cleanArcTitle('x'.repeat(200)), 'x'.repeat(200))
  assert.equal(__test.cleanArcTitle('x'.repeat(201)), null)
  assert.equal(__test.cleanArcTitle(42), null)
  assert.equal(__test.cleanArcSummary(undefined), '')
  assert.equal(__test.cleanArcSummary(''), '')
  assert.equal(__test.cleanArcSummary('x'.repeat(2000)), 'x'.repeat(2000))
  assert.equal(__test.cleanArcSummary('x'.repeat(2001)), null)
  assert.equal(__test.cleanArcStatus(undefined), 'active')
  assert.equal(__test.cleanArcStatus('complete'), 'complete')
  assert.equal(__test.cleanArcStatus('archived'), 'archived')
  assert.equal(__test.cleanArcStatus('deleted'), null)
  assert.equal(__test.cleanPlotTitle(' Master '), 'Master')
  assert.equal(__test.cleanPlotTitle(''), null)
  assert.equal(__test.cleanPlotId('abc-123_X'), 'abc-123_X')
  assert.equal(__test.cleanPlotId('../evil'), null)
  assert.equal(__test.cleanThreadTitle(' Loose end '), 'Loose end')
  assert.equal(__test.cleanThreadTitle(''), null)
  assert.equal(__test.cleanThreadState(undefined), 'seed')
  assert.equal(__test.cleanThreadState('active'), 'active')
  assert.equal(__test.cleanThreadState('resolved'), 'resolved')
  assert.equal(__test.cleanThreadState('done'), null)
  assert.equal(__test.cleanThreadState('SEED'), null)
})

test('arcs: create lists own arcs only, detail carries the tree', async () => {
  const db = makeArcsDb()
  const env = arcsEnv(db)
  const ada = await arcsToken('ada@example.com')
  const bob = await arcsToken('bob@example.com')
  const arc = await makeArc(env, ada, 'Ember Arc')
  assert.equal(arc.title, 'Ember Arc')
  assert.equal(arc.status, 'active')
  await makeArc(env, ada, 'Second Arc')
  await makeArc(env, bob, 'Bob private')
  const adaList = await (await worker.fetch(authed('GET', '/api/arcs', ada), env, {})).json()
  assert.equal(adaList.arcs.length, 2)
  assert.ok(adaList.arcs.every(entry => entry.title !== 'Bob private'))
  const bobList = await (await worker.fetch(authed('GET', '/api/arcs', bob), env, {})).json()
  assert.deepEqual(bobList.arcs.map(entry => entry.title), ['Bob private'])
  const master = await makePlot(env, ada, arc.id, 'The Siege', { is_master: true })
  assert.equal(master.is_master, true)
  assert.equal(master.parent_id, null)
  await makePlot(env, ada, arc.id, 'The Betrayal', { parent_id: master.id })
  const detail = await (await worker.fetch(authed('GET', `/api/arcs/${arc.id}`, ada), env, {})).json()
  assert.equal(detail.arc.title, 'Ember Arc')
  assert.equal(detail.plots.length, 2)
  assert.deepEqual(detail.threads, [])
  assert.equal((await worker.fetch(authed('GET', `/api/arcs/${arc.id}`, bob), env, {})).status, 404)
})

test('arcs: validation rejects bad creates with 400', async () => {
  const db = makeArcsDb()
  const env = arcsEnv(db)
  const ada = await arcsToken('ada@example.com')
  for (const bad of [{}, { title: '' }, { title: '   ' }, { title: 'x'.repeat(201) }, { title: 42 }, { title: 'ok', status: 'deleted' }, { title: 'ok', summary: 'x'.repeat(2001) }]) {
    assert.equal((await worker.fetch(authed('POST', '/api/arcs', ada, bad), env, {})).status, 400)
  }
  const minimal = await worker.fetch(authed('POST', '/api/arcs', ada, { title: 'kept' }), env, {})
  assert.equal(minimal.status, 201)
  assert.deepEqual([(await minimal.json()).arc.summary, 'active'], ['', 'active'])
})

test('plots: parent must belong to the same arc', async () => {
  const db = makeArcsDb()
  const env = arcsEnv(db)
  const ada = await arcsToken('ada@example.com')
  const bob = await arcsToken('bob@example.com')
  const first = await makeArc(env, ada, 'First')
  const second = await makeArc(env, ada, 'Second')
  const foreign = await makeArc(env, bob, 'Bob arc')
  const root = await makePlot(env, ada, first.id, 'Root')
  assert.equal((await worker.fetch(authed('POST', '/api/plots', ada, { arc_id: first.id, title: 'Cross', parent_id: root.id }), env, {})).status, 201)
  const other = await makePlot(env, ada, second.id, 'Other root')
  assert.equal((await worker.fetch(authed('POST', '/api/plots', ada, { arc_id: first.id, title: 'Smuggled', parent_id: other.id }), env, {})).status, 400)
  assert.equal((await worker.fetch(authed('POST', '/api/plots', ada, { arc_id: first.id, title: 'Ghost', parent_id: 'missing-plot-id' }), env, {})).status, 400)
  assert.equal((await worker.fetch(authed('POST', '/api/plots', ada, { arc_id: foreign.id, title: 'Hijack' }), env, {})).status, 404)
  assert.equal((await worker.fetch(authed('POST', '/api/plots', bob, { arc_id: first.id, title: 'Hijack' }), env, {})).status, 404)
  assert.equal((await worker.fetch(authed('PATCH', `/api/plots/${root.id}`, bob, { title: 'Hijack' }), env, {})).status, 404)
})

test('plots: self-parents and cycles are rejected with 400', async () => {
  const db = makeArcsDb()
  const env = arcsEnv(db)
  const ada = await arcsToken('ada@example.com')
  const arc = await makeArc(env, ada, 'Loops')
  const solo = await makePlot(env, ada, arc.id, 'Solo')
  assert.equal((await worker.fetch(authed('PATCH', `/api/plots/${solo.id}`, ada, { parent_id: solo.id }), env, {})).status, 400)
  const a = await makePlot(env, ada, arc.id, 'A')
  const b = await makePlot(env, ada, arc.id, 'B', { parent_id: a.id })
  const c = await makePlot(env, ada, arc.id, 'C', { parent_id: b.id })
  assert.equal((await worker.fetch(authed('PATCH', `/api/plots/${a.id}`, ada, { parent_id: c.id }), env, {})).status, 400)
  assert.equal((await worker.fetch(authed('PATCH', `/api/plots/${b.id}`, ada, { parent_id: c.id }), env, {})).status, 400)
  const detail = await (await worker.fetch(authed('GET', `/api/arcs/${arc.id}`, ada), env, {})).json()
  const byId = new Map(detail.plots.map(plot => [plot.id, plot]))
  assert.equal(byId.get(a.id).parent_id, null)
  assert.equal(byId.get(b.id).parent_id, a.id)
  assert.equal(byId.get(c.id).parent_id, b.id)
})

test('plots: depth past 32 ancestors is rejected with 400', async () => {
  const db = makeArcsDb()
  const env = arcsEnv(db)
  const ada = await arcsToken('ada@example.com')
  const arc = await makeArc(env, ada, 'Deep')
  let parent = (await makePlot(env, ada, arc.id, 'Depth 0')).id
  for (let level = 1; level <= 32; level++) {
    parent = (await makePlot(env, ada, arc.id, `Depth ${level}`, { parent_id: parent })).id
  }
  const tooDeep = await worker.fetch(authed('POST', '/api/plots', ada, { arc_id: arc.id, title: 'Depth 33', parent_id: parent }), env, {})
  assert.equal(tooDeep.status, 400)
  assert.match((await tooDeep.json()).error, /too deep/)
})

test('plots: patch renames, crowns, detaches, and 400s on bad edits', async () => {
  const db = makeArcsDb()
  const env = arcsEnv(db)
  const ada = await arcsToken('ada@example.com')
  const arc = await makeArc(env, ada, 'Edits')
  const root = await makePlot(env, ada, arc.id, 'Root', { is_master: true })
  const child = await makePlot(env, ada, arc.id, 'Child', { parent_id: root.id })
  const renamed = await worker.fetch(authed('PATCH', `/api/plots/${child.id}`, ada, { title: 'Heir', summary: 'Takes the keep' }), env, {})
  assert.equal(renamed.status, 200)
  assert.deepEqual([(await renamed.json()).plot.title, 'Heir'], ['Heir', 'Heir'])
  const detached = await worker.fetch(authed('PATCH', `/api/plots/${child.id}`, ada, { parent_id: null }), env, {})
  assert.equal(detached.status, 200)
  assert.equal((await detached.json()).plot.parent_id, null)
  const crowned = await worker.fetch(authed('PATCH', `/api/plots/${child.id}`, ada, { is_master: true, sort: 3 }), env, {})
  assert.equal(crowned.status, 200)
  assert.deepEqual([(await crowned.json()).plot.is_master, true], [true, true])
  assert.equal((await worker.fetch(authed('PATCH', '/api/plots/missing-plot-id', ada, { title: 'Ghost' }), env, {})).status, 404)
  assert.equal((await worker.fetch(authed('PATCH', '/api/plots/!!!', ada, { title: 'Ghost' }), env, {})).status, 404)
  for (const bad of [{}, { title: '' }, { title: 'x'.repeat(201) }, { summary: 'x'.repeat(2001) }, { parent_id: 'nope!' }, { parent_id: 'missing-plot-id' }, { sort: 1.5 }]) {
    assert.equal((await worker.fetch(authed('PATCH', `/api/plots/${child.id}`, ada, bad), env, {})).status, 400)
  }
})

test('threads: strict state enum and member isolation', async () => {
  const db = makeArcsDb()
  const env = arcsEnv(db)
  const ada = await arcsToken('ada@example.com')
  const bob = await arcsToken('bob@example.com')
  const arc = await makeArc(env, ada, 'Threads')
  const seeded = await (await worker.fetch(authed('POST', '/api/threads', ada, { arc_id: arc.id, title: 'The missing seal' }), env, {})).json()
  assert.equal(seeded.thread.state, 'seed')
  const active = await (await worker.fetch(authed('POST', '/api/threads', ada, { arc_id: arc.id, title: 'The open gate', state: 'active' }), env, {})).json()
  assert.equal(active.thread.state, 'active')
  for (const bad of [{}, { title: '' }, { title: 'x'.repeat(201) }, { arc_id: arc.id, title: 'ok', state: 'done' }, { arc_id: arc.id, title: 'ok', state: 'SEED' }, { arc_id: '../evil', title: 'ok' }, { title: 'no arc' }]) {
    assert.equal((await worker.fetch(authed('POST', '/api/threads', ada, bad), env, {})).status, 400)
  }
  assert.equal((await worker.fetch(authed('POST', '/api/threads', ada, { arc_id: 'missing-arc-id', title: 'Ghost' }), env, {})).status, 404)
  assert.equal((await worker.fetch(authed('POST', '/api/threads', bob, { arc_id: arc.id, title: 'Hijack' }), env, {})).status, 404)
  const listed = await (await worker.fetch(authed('GET', `/api/threads?arc=${arc.id}`, ada), env, {})).json()
  assert.deepEqual(listed.threads.map(thread => thread.title), ['The missing seal', 'The open gate'])
  assert.equal((await worker.fetch(authed('GET', `/api/threads?arc=${arc.id}`, bob), env, {})).status, 404)
  assert.equal((await worker.fetch(authed('GET', '/api/threads', ada), env, {})).status, 400)
  assert.equal((await worker.fetch(authed('GET', '/api/threads?arc=missing', ada), env, {})).status, 404)
  const moved = await worker.fetch(authed('PATCH', `/api/threads/${seeded.thread.id}`, ada, { state: 'active' }), env, {})
  assert.equal(moved.status, 200)
  assert.equal((await moved.json()).thread.state, 'active')
  const resolved = await worker.fetch(authed('PATCH', `/api/threads/${seeded.thread.id}`, ada, { state: 'resolved' }), env, {})
  assert.equal((await resolved.json()).thread.state, 'resolved')
  assert.equal((await worker.fetch(authed('PATCH', `/api/threads/${seeded.thread.id}`, ada, { state: 'done' }), env, {})).status, 400)
  assert.equal((await worker.fetch(authed('PATCH', `/api/threads/${seeded.thread.id}`, ada, {}), env, {})).status, 400)
  assert.equal((await worker.fetch(authed('PATCH', `/api/threads/${seeded.thread.id}`, bob, { state: 'seed' }), env, {})).status, 404)
  assert.equal((await worker.fetch(authed('PATCH', '/api/threads/missing-thread-id', ada, { state: 'seed' }), env, {})).status, 404)
})

test('arcs: anonymous API and page requests are rejected at the gate', async () => {
  const db = makeArcsDb()
  const env = arcsEnv(db)
  const ada = await arcsToken('ada@example.com')
  const arc = await makeArc(env, ada, 'Gated')
  assert.equal((await worker.fetch(authed('GET', '/api/arcs', null), env, {})).status, 401)
  assert.equal((await worker.fetch(authed('POST', '/api/arcs', null, { title: 'x' }), env, {})).status, 401)
  assert.equal((await worker.fetch(authed('GET', `/api/arcs/${arc.id}`, null), env, {})).status, 401)
  assert.equal((await worker.fetch(authed('POST', '/api/plots', null, { arc_id: arc.id, title: 'x' }), env, {})).status, 401)
  assert.equal((await worker.fetch(authed('PATCH', '/api/plots/some-id', null, { title: 'x' }), env, {})).status, 401)
  assert.equal((await worker.fetch(authed('GET', `/api/threads?arc=${arc.id}`, null), env, {})).status, 401)
  assert.equal((await worker.fetch(authed('POST', '/api/threads', null, { arc_id: arc.id, title: 'x' }), env, {})).status, 401)
  assert.equal((await worker.fetch(authed('PATCH', '/api/threads/some-id', null, { state: 'active' }), env, {})).status, 401)
  for (const path of ['/arcs', '/arcs/']) {
    const page = await worker.fetch(new Request(`https://worldofgeor.com${path}`, { headers: { Accept: 'text/html' } }), env, {})
    assert.equal(page.status, 302, path)
    assert.match(page.headers.get('location'), /next=%2Farcs/, path)
    assert.equal(page.headers.get('cache-control'), 'no-store', path)
  }
  const script = await worker.fetch(new Request('https://worldofgeor.com/arcs.js', { headers: { 'Sec-Fetch-Dest': 'script' } }), env, {})
  assert.equal(script.status, 401)
  const authedPage = await worker.fetch(new Request('https://worldofgeor.com/arcs', { headers: { Cookie: `geor_token=${ada}`, Accept: 'text/html' } }), env, {})
  assert.equal(authedPage.status, 200)
  assert.equal(authedPage.headers.get('cache-control'), 'private, no-store')
})

test('plot tree layout layers children below parents on a collision-free grid', () => {
  const plots = [
    { id: 'master', arc_id: 'a', parent_id: null, title: 'The Siege', is_master: 1 },
    { id: 'b', arc_id: 'a', parent_id: 'master', title: 'The Betrayal' },
    { id: 'c', arc_id: 'a', parent_id: 'b', title: 'The Flight' },
    { id: 'd', arc_id: 'a', parent_id: null, title: 'The Market' },
  ]
  const nodes = layoutPlotTree(plots)
  assert.equal(nodes.length, 4)
  const byId = new Map(nodes.map(node => [node.id, node]))
  assert.ok(byId.get('b').y > byId.get('master').y)
  assert.ok(byId.get('c').y > byId.get('b').y)
  assert.equal(byId.get('d').generation, 0)
  const positions = nodes.map(node => `${node.x}/${node.y}`)
  assert.equal(new Set(positions).size, positions.length, 'overlapping nodes')
  assert.deepEqual(layoutPlotTree([]), [])
  // Cycles cannot hang the layout; hostile parents never become edges.
  const cyclic = layoutPlotTree([
    { id: 'x', parent_id: 'y', title: 'X' },
    { id: 'y', parent_id: 'x', title: 'Y' },
  ])
  assert.equal(cyclic.length, 2)
  assert.notEqual(`${cyclic[0].x}/${cyclic[0].y}`, `${cyclic[1].x}/${cyclic[1].y}`)
  const svg = renderPlotTreeSVG(nodes)
  assert.match(svg, /<svg[^>]*viewBox="0 0 \d+(\.\d+)? \d+(\.\d+)?"/)
  assert.match(svg, /plot-master/)
  assert.match(svg, /The Siege/)
  const hostile = renderPlotTreeSVG(layoutPlotTree([{ id: 'e', parent_id: null, title: '<script>alert(1)</script>' }]))
  assert.match(hostile, /&lt;script&gt;/)
  assert.doesNotMatch(hostile, /<script>/)
  assert.match(renderPlotTreeSVG([]), /No plots yet/)
})

test('thread list renders state badges and escapes hostile titles', () => {
  const html = renderThreadList([
    { id: 't1', title: 'The seal', state: 'seed' },
    { id: 't2', title: 'The gate', state: 'active' },
    { id: 't3', title: '<b>Fall</b>', state: 'resolved' },
  ])
  assert.match(html, /SEED/)
  assert.match(html, /ACTIVE/)
  assert.match(html, /RESOLVED/)
  assert.match(html, /&lt;b&gt;Fall&lt;\/b&gt;/)
  assert.doesNotMatch(html, /<b>Fall<\/b>/)
  assert.match(html, /data-thread-id="t1" data-thread-state="active"/)
  assert.match(renderThreadList([]), /No open threads/)
  assert.deepEqual(arcOptions([{ id: 'b', title: 'Zeta' }, { id: 'a', title: 'Alpha' }, { id: 'c', title: '' }]).map(entry => entry.title), ['Alpha', 'Zeta'])
})

test('arcs gate: worker treats page and script as private', () => {
  assert.equal(__test.isPrivatePath('/arcs'), true)
  assert.equal(__test.isPrivatePath('/arcs/'), true)
  assert.equal(__test.isPrivatePath('/arcs.html'), true)
  assert.equal(__test.isPrivatePath('/arcs.js'), true)
})

test('arcs shell mounts the arc select, tree canvas, and thread list while staying noindex', () => {
  const html = readFileSync(new URL('../public/arcs.html', import.meta.url), 'utf8')
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive" \/>/)
  assert.match(html, /id="arcSelect"/)
  assert.match(html, /id="plotCanvas"/)
  assert.match(html, /id="arcsStatus"/)
  assert.match(html, /id="threadList"/)
  assert.match(html, /id="arcForm"/)
  assert.match(html, /id="plotForm"/)
  assert.match(html, /id="threadForm"/)
  assert.match(html, /src="\/arcs\.js"/)
  assert.match(html, /src="\/archive-compass\.js"/)
  const script = readFileSync(new URL('../public/arcs.js', import.meta.url), 'utf8')
  assert.match(script, /from '\.\/timeline\.js'/)
  assert.match(script, /escapeHtml/)
  assert.match(script, /\/api\/arcs/)
  assert.match(script, /\/\?next=' \+ encodeURIComponent\('\/arcs'\)/)
  const workerSource = readFileSync(new URL('../worker.js', import.meta.url), 'utf8')
  assert.match(workerSource, /\['\/arcs', '\/arcs\.html'\]/)
  assert.match(workerSource, /'\/arcs\.js'/)
  const compass = readFileSync(new URL('../public/archive-compass.js', import.meta.url), 'utf8')
  assert.match(compass, /url: '\/arcs'/)
})
