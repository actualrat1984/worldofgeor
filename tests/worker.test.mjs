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
  assert.equal(__test.isPrivatePath('/updates'), false)
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
})

test('private files redirect to the gate and public aliases reach the intended asset', async () => {
  const env = {
    JWT_SECRET: SECRET,
    ASSETS: { fetch: async request => new Response(new URL(request.url).pathname) },
  }
  const privateResponse = await worker.fetch(new Request('https://worldofgeor.com/wiki-index.json', { headers: { Accept: 'text/html' } }), env, {})
  assert.equal(privateResponse.status, 302)
  assert.match(privateResponse.headers.get('location'), /next=%2Fwiki-index\.json/)

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
