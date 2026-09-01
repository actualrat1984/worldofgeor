import test from 'node:test'
import assert from 'node:assert/strict'
import worker, { __test } from '../worker.js'

const SECRET = 'test-only-secret-that-is-longer-than-32-characters'

test('JWT verification accepts an intact token and rejects tampering', async () => {
  const now = Math.floor(Date.now() / 1000)
  const token = await __test.signJwt({ email: 'keeper@example.com', iss: 'worldofgeor', iat: now, exp: now + 60 }, SECRET)
  assert.equal((await __test.verifyJwt(token, SECRET))?.email, 'keeper@example.com')
  const parts = token.split('.')
  parts[1] = parts[1].slice(0, -1) + (parts[1].endsWith('A') ? 'B' : 'A')
  assert.equal(await __test.verifyJwt(parts.join('.'), SECRET), null)
})

test('JWT verification requires an expiry and the expected algorithm', async () => {
  const token = await __test.signJwt({ email: 'keeper@example.com' }, SECRET)
  assert.equal(await __test.verifyJwt(token, SECRET), null)
  const now = Math.floor(Date.now() / 1000)
  const missingIssuedAt = await __test.signJwt({ email: 'keeper@example.com', iss: 'worldofgeor', exp: now + 60 }, SECRET)
  assert.equal(await __test.verifyJwt(missingIssuedAt, SECRET), null)
})

test('addition paths normalize safe files and reject traversal or hidden segments', () => {
  assert.equal(__test.sanitizeAdditionsPath('Lore/New Page'), 'Lore/New Page.md')
  assert.equal(__test.sanitizeAdditionsPath('Lore/data.json'), 'Lore/data.json')
  for (const value of ['../secret.md', 'Lore/../secret.md', 'Lore/.env', 'Lore//page.md', 'Lore\\page.md', 'Lore/page.html']) {
    assert.equal(__test.sanitizeAdditionsPath(value), null, value)
  }
})

test('folder paths reject traversal, empty segments, and dot-folders', () => {
  assert.equal(__test.sanitizeFolderPath('Lore/Characters'), 'Lore/Characters')
  for (const value of ['../Lore', 'Lore//People', 'Lore/.private', 'Lore\\People']) {
    assert.equal(__test.sanitizeFolderPath(value), null, value)
  }
})

test('invite codes and protected route classification fail closed', () => {
  assert.equal(__test.cleanInviteCode(' keeper 2026 '), 'KEEPER_2026')
  assert.equal(__test.cleanInviteCode('short'), null)
  assert.equal(__test.isPrivatePath('/wiki-index.json'), true)
  assert.equal(__test.isPrivatePath('/world-map.jpg'), true)
  assert.equal(__test.isPrivatePath('/map-editor'), true)
  assert.equal(__test.isPrivatePath('/map-editor.js'), true)
  assert.equal(__test.isPrivatePath('/species'), true)
  assert.equal(__test.isPrivatePath('/species.js'), true)
  assert.equal(__test.isPrivatePath('/search'), true)
  assert.equal(__test.isPrivatePath('/updates'), false)
  assert.equal(__test.cleanMapSlug('world'), 'world')
  assert.equal(__test.cleanMapSlug('../world'), null)
  assert.equal(__test.sanitizeMapDocument({ version: 1, slug: 'world', title: 'Atlas', layers: [{ id: 'political', name: 'Political', features: [] }] }, 'world')?.title, 'Atlas')
  assert.equal(__test.sanitizeMapDocument({ version: 1, slug: 'world', layers: [{ id: '../bad', name: 'Bad', features: [] }] }, 'world'), null)
})

test('cross-origin mutations are rejected', () => {
  const same = new Request('https://worldofgeor.com/api/logout', { method: 'POST', headers: { Origin: 'https://worldofgeor.com' } })
  const cross = new Request('https://worldofgeor.com/api/logout', { method: 'POST', headers: { Origin: 'https://example.com' } })
  assert.equal(__test.isTrustedMutation(same, new URL(same.url)), true)
  assert.equal(__test.isTrustedMutation(cross, new URL(cross.url)), false)
})

test('constant-time comparison checks decoded password hashes', () => {
  assert.equal(__test.constantTimeEqual('YWJj', 'YWJj'), true)
  assert.equal(__test.constantTimeEqual('YWJj', 'YWJk'), false)
  assert.equal(__test.constantTimeEqual('YWJj', 'YWJjZA'), false)
})

test('/api/me returns 401 without a session', async () => {
  const response = await worker.fetch(new Request('https://worldofgeor.com/api/me'), { JWT_SECRET: SECRET }, {})
  assert.equal(response.status, 401)
  assert.equal((await response.json()).user, null)
  const mapResponse = await worker.fetch(new Request('https://worldofgeor.com/api/maps/world'), { JWT_SECRET: SECRET }, {})
  assert.equal(mapResponse.status, 401)
  const passwordResponse = await worker.fetch(new Request('https://worldofgeor.com/api/change-password', { method: 'POST', body: '{}' }), { JWT_SECRET: SECRET }, {})
  assert.equal(passwordResponse.status, 401)
  const statsResponse = await worker.fetch(new Request('https://worldofgeor.com/api/world-stats'), { JWT_SECRET: SECRET }, {})
  assert.equal(statsResponse.status, 401)

  const now = Math.floor(Date.now() / 1000)
  const token = await __test.signJwt({ email: 'keeper@example.com', iss: 'worldofgeor', iat: now, exp: now + 60 }, SECRET)
  const invalidMapResponse = await worker.fetch(new Request('https://worldofgeor.com/api/maps/world', {
    method: 'POST',
    headers: { Cookie: `geor_token=${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ map: { version: 1, slug: 'world', layers: [] } }),
  }), { JWT_SECRET: SECRET }, { waitUntil() {} })
  assert.equal(invalidMapResponse.status, 400)

  const records = new Map()
  const db = {
    prepare(sql) {
      let args = []
      return {
        bind(...values) { args = values; return this },
        async run() {
          if (sql.includes('INSERT INTO map_documents')) records.set(args[0], { title: args[1], document_json: args[2], updated_by: args[3], updated_at: '2026-08-31T12:00:00Z' })
          if (sql.includes('COUNT(*) AS count FROM activity')) return { results: [{ count: 7 }] }
          if (sql.includes('COUNT(*) AS count FROM map_documents')) return { results: [{ count: records.size }] }
          return { meta: { changes: 1 } }
        },
        async first() {
          if (sql.includes('FROM map_documents')) return records.get(args[0]) || null
          return null
        },
        async all() { return { results: [] } },
      }
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())) },
  }
  const map = { version: 1, slug: 'world', title: 'Keeper Atlas', layers: [{ id: 'political', name: 'Political', visible: true, locked: false, features: [{ id: 'marker_123456', type: 'marker', name: 'Dissenbarg', note: '', wikiUrl: '/wiki/World/', color: '#d9b77a', icon: 'city', point: { lat: 420, lng: 840 } }] }] }
  const ctx = { waitUntil() {} }
  const saveResponse = await worker.fetch(new Request('https://worldofgeor.com/api/maps/world', { method: 'POST', headers: { Cookie: `geor_token=${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ map }) }), { JWT_SECRET: SECRET, DB: db }, ctx)
  assert.equal(saveResponse.status, 200)
  const loadResponse = await worker.fetch(new Request('https://worldofgeor.com/api/maps/world', { headers: { Cookie: `geor_token=${token}` } }), { JWT_SECRET: SECRET, DB: db }, ctx)
  assert.equal(loadResponse.status, 200)
  assert.deepEqual((await loadResponse.json()).map, map)
  const archiveIndex = [{ url: '/wiki/World/Nations/A/' }, { url: '/wiki/World/Species/Elves/' }, { url: '/wiki/World/History/Ages/' }, { url: '/wiki/World/Systems/Magic/' }]
  const worldStatsResponse = await worker.fetch(new Request('https://worldofgeor.com/api/world-stats', { headers: { Cookie: `geor_token=${token}` } }), { JWT_SECRET: SECRET, DB: db, ASSETS: { fetch: async () => Response.json(archiveIndex) } }, ctx)
  assert.equal(worldStatsResponse.status, 200)
  const worldStats = await worldStatsResponse.json()
  assert.equal(worldStats.archive.pages, archiveIndex.length)
  assert.equal(worldStats.canonical.species, 34)
  assert.equal(worldStats.live.activity, 7)
  assert.equal(worldStats.live.mapFolios, 1)
})

test('private files redirect to the gate and public aliases reach the intended asset', async () => {
  const env = {
    JWT_SECRET: SECRET,
    ASSETS: { fetch: async request => new Response(new URL(request.url).pathname) },
  }
  const privateResponse = await worker.fetch(new Request('https://worldofgeor.com/wiki-index.json', { headers: { Accept: 'text/html' } }), env, {})
  assert.equal(privateResponse.status, 302)
  assert.match(privateResponse.headers.get('location'), /next=%2Fwiki-index\.json/)
  assert.equal(privateResponse.headers.get('cache-control'), 'no-store')

  const protectedAssetResponse = await worker.fetch(new Request('https://worldofgeor.com/map-editor.js', { headers: { 'Sec-Fetch-Dest': 'script' } }), env, {})
  assert.equal(protectedAssetResponse.status, 401)
  const speciesResponse = await worker.fetch(new Request('https://worldofgeor.com/species', { headers: { Accept: 'text/html' } }), env, {})
  assert.equal(speciesResponse.status, 302)
  assert.equal(speciesResponse.headers.get('cache-control'), 'no-store')

  const publicResponse = await worker.fetch(new Request('https://worldofgeor.com/updates'), env, {})
  assert.equal(publicResponse.status, 200)
  assert.equal(await publicResponse.text(), '/updates.html')
})

test('cross-origin logout is blocked before cookies are changed', async () => {
  const request = new Request('https://worldofgeor.com/api/logout', { method: 'POST', headers: { Origin: 'https://attacker.example' } })
  const response = await worker.fetch(request, { JWT_SECRET: SECRET }, {})
  assert.equal(response.status, 403)
  assert.equal(response.headers.get('set-cookie'), null)
})
