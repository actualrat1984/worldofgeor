import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dashboardHtml = readFileSync(path.join(root, 'public', 'dashboard.html'), 'utf8')

// --- trail caps (H9 partial, kept): 6 -> 5, most-recent-first ---

test('reading trail stays capped at 5 (local read and synced merge)', () => {
  assert.ok(
    dashboardHtml.includes("safeLocalItems('geor_archive_trail_v1',5)"),
    "local trail reads capped at 5",
  )
  assert.match(
    dashboardHtml,
    /merge\(localTrail,syncedArchive\?\.recent,5\)/,
    'merged trail capped at 5',
  )
  assert.ok(
    !dashboardHtml.includes("geor_archive_trail_v1',6"),
    'no reverted 6-cap on the local trail read',
  )
  assert.ok(!/recent,6\)/.test(dashboardHtml), 'no reverted 6-cap on the trail merge')
})

test('trail merge keeps most-recent-first order (local before remote)', () => {
  assert.match(
    dashboardHtml,
    /\[\.\.\.local,\.\.\.\(remote/,
    'merge spreads local (most recent) items first',
  )
})

// --- task helpers: extracted from the page and executed for real ---

function loadTaskHelpers() {
  const start = dashboardHtml.indexOf('const TASKS_LIMIT=')
  const end = dashboardHtml.indexOf('const renderTasks=')
  assert.ok(start >= 0 && end > start, 'task helper block is present in dashboard.html')
  const src = dashboardHtml.slice(start, end)
  const context = vm.createContext({ Math, Date, JSON })
  vm.runInContext(
    `${src};globalThis.__helpers={TASKS_LIMIT,taskKeyFor,parseTasks,addTaskTo,toggleTaskIn,removeTaskFrom};`,
    context,
  )
  return context.__helpers
}

const helpers = loadTaskHelpers()
const plain = value => JSON.parse(JSON.stringify(value))

function fakeStorage() {
  const store = new Map()
  return {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  }
}

test('task storage key is namespaced per logged-in member email', () => {
  const alice = helpers.taskKeyFor('alice@example.com')
  const bob = helpers.taskKeyFor('bob@example.com')
  assert.ok(alice.includes('alice@example.com'), 'key carries the member email')
  assert.notEqual(alice, bob, 'different members get different keys')
  assert.equal(
    helpers.taskKeyFor('Alice@Example.com'),
    helpers.taskKeyFor('alice@example.com'),
    'key is case-insensitive',
  )
})

test('task add / toggle / delete round-trips under an email key', () => {
  const storage = fakeStorage()
  const key = helpers.taskKeyFor('alice@example.com')
  const read = () => helpers.parseTasks(storage.getItem(key))
  const write = items => storage.setItem(key, JSON.stringify(items))

  // add
  write(helpers.addTaskTo(read(), 'Read the Silver Bride folio'))
  let items = read()
  assert.equal(items.length, 1)
  assert.equal(items[0].text, 'Read the Silver Bride folio')
  assert.equal(items[0].done, false)

  // blank adds are ignored
  write(helpers.addTaskTo(read(), '   '))
  assert.equal(read().length, 1)

  // newest first
  write(helpers.addTaskTo(read(), 'Second task'))
  items = read()
  assert.equal(items[0].text, 'Second task')

  // toggle done and back
  const id = items[0].id
  write(helpers.toggleTaskIn(read(), id))
  assert.equal(read().find(task => task.id === id).done, true)
  write(helpers.toggleTaskIn(read(), id))
  assert.equal(read().find(task => task.id === id).done, false)

  // delete
  write(helpers.removeTaskFrom(read(), id))
  items = read()
  assert.equal(items.length, 1)
  assert.ok(!items.some(task => task.id === id), 'deleted task is gone')
})

test('task lists are isolated per member', () => {
  const storage = fakeStorage()
  const aliceKey = helpers.taskKeyFor('alice@example.com')
  const bobKey = helpers.taskKeyFor('bob@example.com')
  storage.setItem(bobKey, JSON.stringify(helpers.addTaskTo([], 'Bob task')))
  assert.deepEqual(plain(helpers.parseTasks(storage.getItem(aliceKey))), [])
  assert.equal(helpers.parseTasks(storage.getItem(bobKey)).length, 1)
})

test('corrupt or hostile stored payloads parse to a safe empty list', () => {
  assert.deepEqual(plain(helpers.parseTasks('not json{{')), [])
  assert.deepEqual(plain(helpers.parseTasks('{"a":1}')), [])
  const survivors = helpers.parseTasks(JSON.stringify([{ text: 42 }, null, { text: '  ok  ' }]))
  assert.equal(survivors.length, 1)
  assert.equal(survivors[0].text, 'ok')
  assert.equal(survivors[0].done, false)
  assert.equal(typeof survivors[0].id, 'string')
})

// --- empty states carry actions (H4 pattern) ---

test('task empty state carries an action, and trail/saved empties keep theirs', () => {
  for (const id of ['id="taskForm"', 'id="taskInput"', 'id="taskList"', 'id="taskCount"']) {
    assert.ok(dashboardHtml.includes(id), `task card contains ${id}`)
  }
  const renderStart = dashboardHtml.indexOf('const renderTasks=')
  const renderSrc = dashboardHtml.slice(renderStart, dashboardHtml.indexOf('let recentMotion=[]'))
  assert.ok(renderSrc.includes("act.href='/wiki/'"), 'task empty state links somewhere useful')
  assert.ok(renderSrc.includes("act.textContent='Open the wiki'"), 'task empty action has a label')
  assert.ok(
    dashboardHtml.includes('kept on this device'),
    'task list is honestly labeled device-local',
  )
  assert.ok(dashboardHtml.includes('Find a folio'), 'trail empty state keeps its action')
  assert.ok(dashboardHtml.includes('Open the wiki'), 'saved-folios empty state keeps its action')
})

// --- zero new network calls ---

test('dashboard adds zero new network calls (API surface unchanged)', () => {
  const allowlist = new Set([
    '/api/me',
    '/api/archive-state',
    '/api/workflow',
    '/api/world-stats',
    '/api/updates',
    '/api/logout',
    '/api/change-password',
  ])
  const called = new Set(
    [...dashboardHtml.matchAll(/\/api\/[a-z-]+/g)].map(match => match[0]),
  )
  for (const endpoint of called) {
    assert.ok(allowlist.has(endpoint), `${endpoint} is a known endpoint (no new network calls)`)
  }
  const taskStart = dashboardHtml.indexOf('const TASKS_LIMIT=')
  const taskEnd = dashboardHtml.indexOf('let recentMotion=[]')
  const taskSrc = dashboardHtml.slice(taskStart, taskEnd)
  assert.ok(!taskSrc.includes('fetch('), 'task code performs no fetch')
  assert.ok(!taskSrc.includes('/api/'), 'task code touches no API route')
})

// --- user text is escaped (textContent only) ---

test('user task text is never injected as HTML', () => {
  assert.ok(!dashboardHtml.includes('innerHTML'), 'dashboard uses no innerHTML anywhere')
  const renderStart = dashboardHtml.indexOf('const renderTasks=')
  const renderSrc = dashboardHtml.slice(renderStart, dashboardHtml.indexOf('let recentMotion=[]'))
  assert.ok(renderSrc.includes('label.textContent=task.text'), 'task label renders via textContent')
  assert.ok(!renderSrc.includes('innerHTML'), 'task renderer uses no innerHTML')
  assert.ok(
    !renderSrc.includes('insertAdjacentHTML') && !renderSrc.includes('document.write'),
    'task renderer uses no other HTML sinks',
  )
})
