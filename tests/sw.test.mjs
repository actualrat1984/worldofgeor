import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

function harness(network = async () => new Response('private folio', { headers: { 'Cache-Control': 'private, no-store' } })) {
  const listeners = {}, removed = [], stored = []
  const context = {
    URL, Response, location: { origin: 'https://worldofgeor.com' }, fetch: network,
    self: { addEventListener: (type, handler) => { listeners[type] = handler }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: {
      keys: async () => ['geor-pages-v1', 'geor-pages-v0', 'geor-shell-v2', 'geor-shell-v3', 'other-app'],
      delete: async key => { removed.push(key) },
      open: async () => ({ match: async () => undefined, put: async (...args) => { stored.push(args) }, addAll: async () => {} }),
    },
  }
  vm.runInNewContext(source, context)
  async function request(path, mode = 'navigate', method = 'GET') {
    let promise
    listeners.fetch({ request: { url: `https://worldofgeor.com${path}`, mode, method }, respondWith: p => { promise = p } })
    return promise ? await promise : undefined
  }
  return { listeners, removed, stored, request }
}

test('activation removes every old private page cache and only obsolete Geor shell caches', async () => {
  const h = harness()
  let done
  h.listeners.activate({ waitUntil: p => { done = p } })
  await done
  assert.deepEqual(h.removed, ['geor-pages-v1', 'geor-pages-v0', 'geor-shell-v2'])
})
test('private HTML is delivered live without persisting a copy', async () => {
  const h = harness()
  for (const path of ['/wiki/World/', '/notebook', '/atlas.html', '/dashboard']) {
    assert.equal(await (await h.request(path)).text(), 'private folio')
  }
  assert.equal(h.stored.length, 0)
})
test('offline navigation never replays cached private pages and offers retry at the same URL', async () => {
  const h = harness(async () => { throw new TypeError('offline') })
  const response = await h.request('/wiki/World/')
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const html = await response.text()
  assert.match(html, /href="">Try again/)
  assert.doesNotMatch(html, /private folio/)
  assert.equal(h.stored.length, 0)
})
test('authorization errors are returned unchanged and APIs and writes bypass the cache', async () => {
  const h = harness(async () => new Response('Sign in', { status: 401 }))
  assert.equal((await h.request('/wiki/')).status, 401)
  assert.equal(await h.request('/api/me'), undefined)
  assert.equal(await h.request('/wiki/', 'navigate', 'POST'), undefined)
})
test('public assets can be cached, but no-store or private responses cannot', async () => {
  const h = harness(async () => new Response('css'))
  await h.request('/site.css', 'no-cors')
  assert.equal(h.stored.length, 1)
  const privateResponse = harness()
  await privateResponse.request('/site.css', 'no-cors')
  assert.equal(privateResponse.stored.length, 0)
})
