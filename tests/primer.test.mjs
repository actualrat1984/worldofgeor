// Wave F2: reader's primer — spoiler-gated read lens over the reveals table.
// API reads the caller's own reveals only (own + global '*' rows); the curated
// reading list links real wiki pages; locked entries show a lock + article
// link and never any secret bytes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import worker, { __test } from '../worker.js'
import {
  PRIMER_READING,
  isWikiUrl,
  primerItemState,
  renderPrimerItem,
  renderPrimerList,
  summarizePrimer,
} from '../public/primer.js'

const SECRET = 'test-only-secret-that-is-longer-than-32-characters'

// Minimal reveals store mirroring makeSecretsDb in worker.test.mjs: own rows,
// global '*' rows, and locked rows that must never surface.
function makePrimerDb({ seedReveals = [] } = {}) {
  const reveals = new Map(seedReveals.map(([member, id, state]) => [`${member}\0${id}`, state]))
  return {
    prepare(sql) {
      let args = []
      const api = {
        bind(...values) { args = values; return api },
        async run() {
          if (/CREATE TABLE IF NOT EXISTS/i.test(sql) || /CREATE INDEX IF NOT EXISTS/i.test(sql)) return { meta: { changes: 0 } }
          if (/ALTER TABLE users ADD COLUMN role/i.test(sql)) return { meta: { changes: 0 } }
          return { meta: { changes: 1 } }
        },
        async first() { return null },
        async all() {
          if (sql.includes('FROM reveals')) {
            const email = args[0]
            const rows = []
            for (const [key, state] of reveals) {
              const [member, id] = key.split('\0')
              if (state === 'revealed' && (member === email || member === '*')) rows.push({ secret_id: id })
            }
            return { results: rows }
          }
          return { results: [] }
        },
      }
      return api
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())) },
  }
}

async function primerToken(email) {
  const now = Math.floor(Date.now() / 1000)
  return __test.signJwt({ email, iss: 'worldofgeor', iat: now, exp: now + 60 }, SECRET)
}

function primerEnv(db) {
  return {
    JWT_SECRET: SECRET,
    DB: db,
    ASSETS: { fetch: async () => new Response('primer-shell', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) },
  }
}

const primerGet = token => new Request('https://worldofgeor.com/api/primer', {
  headers: token ? { Cookie: `geor_token=${token}` } : {},
})

const seed = [
  ['member@example.com', 'aelis-true-name', 'revealed'],
  ['member@example.com', 'stale-draft', 'locked'],
  ['*', 'erisian-throne-secret', 'revealed'],
  ['other@example.com', 'other-members-secret', 'revealed'],
]

test('primer: revealed set mirrors own + global reveals rows', async () => {
  const env = primerEnv(makePrimerDb({ seedReveals: seed }))
  const response = await worker.fetch(primerGet(await primerToken('member@example.com')), env, {})
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { revealed: ['aelis-true-name', 'erisian-throne-secret'], count: 2 })
})

test('primer: another member’s reveals stay invisible', async () => {
  const env = primerEnv(makePrimerDb({ seedReveals: seed }))
  const response = await worker.fetch(primerGet(await primerToken('other@example.com')), env, {})
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { revealed: ['erisian-throne-secret', 'other-members-secret'], count: 2 })
})

test('primer: anonymous readers are turned away', async () => {
  const env = primerEnv(makePrimerDb({ seedReveals: seed }))
  assert.equal((await worker.fetch(primerGet(null), env, {})).status, 401)
  assert.equal((await worker.fetch(new Request('https://worldofgeor.com/primer'), env, {})).status, 302)
})

test('primer: curated reading list links only real wiki pages', () => {
  const root = path.resolve(import.meta.dirname, '..')
  const index = JSON.parse(readFileSync(path.join(root, 'public', 'wiki-index.json'), 'utf8'))
  const known = new Set(index.map(entry => entry?.url).filter(Boolean))
  assert.ok(PRIMER_READING.length > 0, 'curated list is non-empty')
  for (const item of PRIMER_READING) {
    assert.ok(typeof item.label === 'string' && item.label.length > 0, 'entry has a label')
    assert.ok(isWikiUrl(item.path), `entry path is a same-site wiki URL: ${item?.path}`)
    const onDisk = existsSync(path.join(root, 'dist', 'wiki', item.path.slice('/wiki/'.length), 'index.html'))
    assert.ok(onDisk || known.has(item.path), `curated path exists: ${item.path}`)
  }
})

test('primer: locked entries show a lock + article link, never secret bytes', () => {
  const item = { label: 'Aelis', path: '/wiki/World/History/Characters/Aelis/', secret: 'aelis-true-name' }
  assert.equal(primerItemState(item, []), 'locked')
  assert.equal(primerItemState(item, ['aelis-true-name']), 'revealed')
  assert.equal(primerItemState({ label: 'Open Folio', path: '/wiki/World/Dates/' }, []), 'open')
  const locked = renderPrimerItem(item, [])
  assert.match(locked, /🔒/)
  assert.match(locked, /\/wiki\/World\/History\/Characters\/Aelis\//)
  assert.equal(locked.includes('aelis-true-name'), false, 'locked card emits no spoiler id')
  const revealed = renderPrimerList([item], ['aelis-true-name'])
  assert.match(revealed, /Revealed/)
  assert.equal(revealed.includes('aelis-true-name'), false, 'revealed card still emits no spoiler id')
  const summary = summarizePrimer([item, { label: 'Open Folio', path: '/wiki/World/Dates/' }], [])
  assert.deepEqual(summary, { total: 2, revealed: 0, locked: 1 })
})

test('primer: unknown paths render as text, never as links', () => {
  const html = renderPrimerItem({ label: 'Elsewhere', path: 'https://example.com/evil', secret: 'x' }, [])
  assert.equal(html.includes('<a '), false)
  assert.match(html, /Elsewhere/)
})
