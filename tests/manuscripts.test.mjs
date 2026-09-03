// Wave E1: manuscripts studio on the additions pipeline — validators,
// path traversal rejection, caps, Books/ isolation, anon gate, and a
// save→read round-trip through a mocked GitHub contents/tree API.
import test from 'node:test'
import assert from 'node:assert/strict'
import worker, { __test } from '../worker.js'
import {
  MANUSCRIPT_BODY_MAX,
  buildManuscriptContent,
  manuscriptDownloadName,
  manuscriptDraftKey,
  parseManuscriptContent,
  renderManuscriptList,
  splitManuscriptPath,
} from '../public/manuscripts.js'

const SECRET = 'test-only-secret-that-is-longer-than-32-characters'
const OWNER = 'actualrat1984'
const REPO = 'Website-additions'

// In-memory GitHub: contents GET/PUT + recursive tree, nothing else.
// Seeded with one non-Books file to prove Books/ isolation.
function makeFakeGitHub() {
  const files = new Map([['Loose/stray-note.md', { content: '# stray', sha: 'aaa1111' }]])
  let counter = 1
  const b64e = value => Buffer.from(value, 'utf8').toString('base64')
  const b64d = value => Buffer.from(String(value).replace(/\s/g, ''), 'base64').toString('utf8')
  async function handler(url, init = {}) {
    const method = String(init.method || 'GET').toUpperCase()
    const u = new URL(String(url))
    if (u.origin !== 'https://api.github.com') return new Response('not mocked', { status: 500 })
    if (method === 'GET' && u.pathname === `/repos/${OWNER}/${REPO}/git/trees/main`) {
      return Response.json({
        tree: [...files.entries()].map(([path, file]) => ({ path, sha: file.sha, size: file.content.length, type: 'blob' })),
        truncated: false,
      })
    }
    const match = u.pathname.match(new RegExp(`^/repos/${OWNER}/${REPO}/contents/(.+)$`))
    if (match) {
      const path = decodeURIComponent(match[1])
      if (method === 'GET') {
        const file = files.get(path)
        if (!file) return new Response('nf', { status: 404 })
        return Response.json({ type: 'file', path, sha: file.sha, size: file.content.length, html_url: `https://github.com/${OWNER}/${REPO}/blob/main/${path}`, content: b64e(file.content) })
      }
      if (method === 'PUT') {
        const payload = JSON.parse(init.body)
        const existing = files.get(path)
        if (existing && payload.sha !== existing.sha) return new Response('conflict', { status: 409 })
        const sha = `deadbeef${String(counter++).padStart(4, '0')}`
        files.set(path, { content: b64d(payload.content), sha })
        return Response.json({ content: { sha, html_url: `https://github.com/${OWNER}/${REPO}/blob/main/${path}` }, commit: { sha, html_url: '' } })
      }
    }
    return new Response('not mocked', { status: 500 })
  }
  return { files, handler }
}

async function manuscriptToken(email) {
  const now = Math.floor(Date.now() / 1000)
  return __test.signJwt({ email, iss: 'worldofgeor', iat: now, exp: now + 60 }, SECRET)
}

// No DB: rate limits allow-list without one, and the activity log skips
// without one — the manuscripts surface needs neither.
function manuscriptEnv() {
  return {
    JWT_SECRET: SECRET,
    GITHUB_TOKEN: 'test-token',
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

// Run fn with global fetch routed to the fake GitHub, always restored.
async function withFakeGitHub(fn) {
  const fake = makeFakeGitHub()
  const realFetch = globalThis.fetch
  globalThis.fetch = (url, init) => fake.handler(url, init)
  try { return await fn(fake) } finally { globalThis.fetch = realFetch }
}

test('manuscript segments accept plain names and reject traversal or separators', () => {
  assert.equal(__test.cleanManuscriptSegment('Ember Dawn'), 'Ember Dawn')
  assert.equal(__test.cleanManuscriptSegment('  ch.1  '), 'ch.1')
  assert.equal(__test.cleanManuscriptSegment('x'.repeat(80)), 'x'.repeat(80))
  for (const bad of ['..', '.', '.hidden', 'ends.', '', '   ', 'a/b', 'a\\b', 'x'.repeat(81), 42, null, undefined]) {
    assert.equal(__test.cleanManuscriptSegment(bad), null, String(bad))
  }
})

test('manuscript paths stay inside Books/ and keep the .md extension', () => {
  assert.equal(__test.manuscriptPath('Ember', 'Arrival'), 'Books/Ember/Arrival.md')
  assert.equal(__test.manuscriptPath('Ember', 'ch1.md'), 'Books/Ember/ch1.md')
  for (const [book, chapter] of [['..', 'x'], ['Ember', '../x'], ['Ember', 'a/b'], ['Ember', 'page.html'], ['', 'x'], ['Ember', ''], ['../Books', 'x']]) {
    assert.equal(__test.manuscriptPath(book, chapter), null, `${book}/${chapter}`)
  }
})

test('manuscript title and body caps are enforced', () => {
  assert.equal(__test.cleanManuscriptTitle(null), '')
  assert.equal(__test.cleanManuscriptTitle(undefined), '')
  assert.equal(__test.cleanManuscriptTitle('  The Arrival  '), 'The Arrival')
  assert.equal(__test.cleanManuscriptTitle('x'.repeat(200)), 'x'.repeat(200))
  assert.equal(__test.cleanManuscriptTitle('x'.repeat(201)), null)
  assert.equal(__test.cleanManuscriptTitle(42), null)
  assert.equal(__test.cleanManuscriptBody('  It began…  '), 'It began…')
  assert.equal(__test.cleanManuscriptBody(''), null)
  assert.equal(__test.cleanManuscriptBody('   '), null)
  assert.equal(__test.cleanManuscriptBody('x'.repeat(100000)), 'x'.repeat(100000))
  assert.equal(__test.cleanManuscriptBody('x'.repeat(100001)), null)
  assert.equal(__test.buildManuscriptContent('The Arrival', 'It began…'), '# The Arrival\n\nIt began…')
  assert.equal(__test.buildManuscriptContent('', 'It began…'), 'It began…')
})

test('manuscript client helpers shape keys, names, content, and lists', () => {
  assert.equal(manuscriptDraftKey('Books/Ember/Arrival.md'), 'geor:manuscript-draft:Books/Ember/Arrival.md')
  assert.equal(manuscriptDownloadName('Books/Ember/Arrival.md'), 'Arrival.md')
  assert.equal(MANUSCRIPT_BODY_MAX, 100000)
  assert.deepEqual(parseManuscriptContent('# The Arrival\n\nIt began…'), { title: 'The Arrival', body: 'It began…' })
  assert.deepEqual(parseManuscriptContent('No heading here'), { title: '', body: 'No heading here' })
  assert.equal(buildManuscriptContent('T', 'B'), '# T\n\nB')
  assert.deepEqual(splitManuscriptPath('Books/Ember/Arrival.md'), { book: 'Ember', chapter: 'Arrival' })
  assert.equal(splitManuscriptPath('Loose/note.md'), null)
  assert.match(renderManuscriptList([], null), /No chapters yet/)
  assert.match(renderManuscriptList([{ path: 'Books/Ember/<b>.md' }], null), /&lt;b&gt;/)
  assert.doesNotMatch(renderManuscriptList([{ path: 'Books/Ember/<b>.md' }], null), /<b>/)
})

test('manuscripts: anonymous API and page requests are rejected at the gate', async () => {
  await withFakeGitHub(async () => {
    const env = manuscriptEnv()
    assert.equal((await worker.fetch(authed('GET', '/api/manuscripts', null), env, {})).status, 401)
    assert.equal((await worker.fetch(authed('POST', '/api/manuscripts', null, { book: 'B', chapter: 'C', body: 'x' }), env, {})).status, 401)
    for (const path of ['/manuscripts', '/manuscripts/']) {
      const page = await worker.fetch(new Request(`https://worldofgeor.com${path}`, { headers: { Accept: 'text/html' } }), env, {})
      assert.equal(page.status, 302, path)
      assert.match(page.headers.get('location'), /next=%2Fmanuscripts/, path)
    }
    const script = await worker.fetch(new Request('https://worldofgeor.com/manuscripts.js', { headers: { 'Sec-Fetch-Dest': 'script' } }), env, {})
    assert.equal(script.status, 401)
    const ada = await manuscriptToken('ada@example.com')
    const authedPage = await worker.fetch(new Request('https://worldofgeor.com/manuscripts', { headers: { Cookie: `geor_token=${ada}`, Accept: 'text/html' } }), env, {})
    assert.equal(authedPage.status, 200)
    assert.equal(authedPage.headers.get('cache-control'), 'private, no-store')
  })
})

test('manuscripts: traversal and over-cap saves are rejected with 400', async () => {
  await withFakeGitHub(async () => {
    const env = manuscriptEnv()
    const ada = await manuscriptToken('ada@example.com')
    for (const bad of [
      { book: '..', chapter: 'x', body: 'ok' },
      { book: 'Ember', chapter: '../x', body: 'ok' },
      { book: 'Ember', chapter: 'a/b', body: 'ok' },
      { book: 'Ember', chapter: 'page.html', body: 'ok' },
      { book: '', chapter: 'x', body: 'ok' },
      { book: 'Ember', chapter: 'x', title: 'x'.repeat(201), body: 'ok' },
      { book: 'Ember', chapter: 'x', body: '' },
      { book: 'Ember', chapter: 'x', body: '   ' },
      { book: 'Ember', chapter: 'x', body: 'x'.repeat(100001) },
      { book: 'Ember', chapter: 'x' },
    ]) {
      assert.equal((await worker.fetch(authed('POST', '/api/manuscripts', ada, bad), env, {})).status, 400, JSON.stringify(bad).slice(0, 60))
    }
    assert.equal((await worker.fetch(authed('GET', '/api/manuscripts?chapter=Arrival', ada), env, {})).status, 400)
    assert.equal((await worker.fetch(authed('GET', '/api/manuscripts?book=../x', ada), env, {})).status, 400)
    assert.equal((await worker.fetch(authed('GET', '/api/manuscripts?book=Ember&chapter=../x', ada), env, {})).status, 400)
  })
})

test('manuscripts: save→read round-trip with Books/ isolation', async () => {
  await withFakeGitHub(async fake => {
    const env = manuscriptEnv()
    const ada = await manuscriptToken('ada@example.com')
    const saved = await worker.fetch(authed('POST', '/api/manuscripts', ada, { book: 'Ember', chapter: 'Arrival', title: 'The Arrival', body: 'It began with a harbor bell.' }), env, {})
    assert.equal(saved.status, 200)
    const created = await saved.json()
    assert.equal(created.ok, true)
    assert.equal(created.path, 'Books/Ember/Arrival.md')
    assert.ok(created.sha)
    assert.equal(fake.files.get('Books/Ember/Arrival.md').content, '# The Arrival\n\nIt began with a harbor bell.')
    const read = await (await worker.fetch(authed('GET', '/api/manuscripts?book=Ember&chapter=Arrival', ada), env, {})).json()
    assert.equal(read.content, '# The Arrival\n\nIt began with a harbor bell.')
    assert.equal(read.path, 'Books/Ember/Arrival.md')
    // Second save revises through the existing-sha commit flow.
    const revised = await worker.fetch(authed('POST', '/api/manuscripts', ada, { book: 'Ember', chapter: 'Arrival', title: 'The Arrival', body: 'It began with two bells.' }), env, {})
    assert.equal(revised.status, 200)
    const reread = await (await worker.fetch(authed('GET', '/api/manuscripts?book=Ember&chapter=Arrival', ada), env, {})).json()
    assert.equal(reread.content, '# The Arrival\n\nIt began with two bells.')
    // Listing shows Books/ entries only — the seeded stray file stays invisible.
    const listed = await (await worker.fetch(authed('GET', '/api/manuscripts', ada), env, {})).json()
    assert.ok(listed.files.some(file => file.path === 'Books/Ember/Arrival.md'))
    assert.ok(listed.files.every(file => file.path.startsWith('Books/')))
    const scoped = await (await worker.fetch(authed('GET', '/api/manuscripts?book=Ember', ada), env, {})).json()
    assert.deepEqual(scoped.files.map(file => file.path), ['Books/Ember/Arrival.md'])
    const other = await (await worker.fetch(authed('GET', '/api/manuscripts?book=Other', ada), env, {})).json()
    assert.deepEqual(other.files, [])
    assert.equal((await worker.fetch(authed('GET', '/api/manuscripts?book=Ember&chapter=Missing', ada), env, {})).status, 404)
  })
})
