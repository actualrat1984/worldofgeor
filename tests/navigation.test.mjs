import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import worker, { __test } from '../worker.js'
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const redirectCode = html.slice(html.indexOf('const allowedNextRoots'), html.indexOf('// a11y helpers'))
function next(destination) {
  return vm.runInNewContext(redirectCode + '; safeNext()', { URL, URLSearchParams, location: { origin: 'https://worldofgeor.com', search: '?next=' + encodeURIComponent(destination) } })
}
test('all private rooms preserve destination through sign-in, including HTML and trailing-slash links', () => {
  const roots = ['wiki', 'app', 'atlas', 'map-editor', 'search', 'species', 'dashboard', 'admin', 'timeline', 'calendar', 'gazetteer', 'trees', 'arcs', 'quests', 'statblocks', 'notebook', 'manuscripts', 'boards', 'webs', 'gallery', 'oracle', 'chronicles', 'primer', 'desk', 'audio']
  for (const root of roots) for (const suffix of ['', '/', '.html']) {
    const path = '/' + root + suffix + '?view=wide#entry'
    assert.equal(next(path), path)
  }
  for (const path of ['//evil.example/wiki', '/\\evil.example/wiki', 'https://evil.example/wiki', '/notebook/../../evil', '/notebooks', '/api/logout']) assert.equal(next(path), null, path)
})
test('all admin aliases reject non-admin members before fetching the page', async () => {
  const secret = 'regression-test-only-secret-at-least-32-characters'
  const now = Math.floor(Date.now() / 1000)
  for (const email of ['reader@example.com', 'ichieisenheart@gmail.com']) {
    const token = await __test.signJwt({ email, iss: 'worldofgeor', iat: now, exp: now + 60 }, secret)
    for (const path of ['/admin', '/admin/', '/admin.html', '/%61dmin/']) {
      let fetched = false
      const response = await worker.fetch(new Request('https://worldofgeor.com' + path, { headers: { Cookie: 'geor_token=' + token } }), {
        JWT_SECRET: secret, ASSETS: { fetch: async () => { fetched = true; return new Response('admin') } },
      }, {})
      const owner = email === 'ichieisenheart@gmail.com'
      assert.equal(response.status, owner ? 200 : 302, path)
      assert.equal(fetched, owner, path)
    }
  }
})
