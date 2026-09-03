import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
  for (const value of ['/Lore/page.md', '../secret.md', 'Lore/../secret.md', 'Lore/.env', 'Lore//page.md', 'Lore\\page.md', 'Lore/page.html']) {
    assert.equal(__test.sanitizeAdditionsPath(value), null, value)
  }
})

test('folder paths reject traversal, empty segments, and dot-folders', () => {
  assert.equal(__test.sanitizeFolderPath('Lore/Characters'), 'Lore/Characters')
  for (const value of ['/Lore/People', '../Lore', 'Lore//People', 'Lore/.private', 'Lore\\People']) {
    assert.equal(__test.sanitizeFolderPath(value), null, value)
  }
})

test('archive state and workflow values are normalized safely', () => {
  assert.equal(__test.cleanArchivePath('/wiki/World/Nations/?view=wide'), '/wiki/World/Nations/?view=wide')
  assert.equal(__test.cleanArchivePath('//attacker.example/wiki'), null)
  assert.equal(__test.cleanArchivePath('/wiki/%2e%2e/secret'), null)
  assert.equal(__test.cleanArchiveTitle('  A\nConnected   Folio  '), 'A Connected Folio')
  assert.equal(__test.cleanWorkflowKind('addition'), 'addition')
  assert.equal(__test.cleanWorkflowKind('admin'), null)
  assert.equal(__test.cleanWorkflowStatus('approved'), 'approved')
  assert.equal(__test.cleanWorkflowStatus('deleted'), null)
})

test('invite codes and protected route classification fail closed', () => {
  assert.equal(__test.cleanInviteCode(' keeper 2026 '), 'KEEPER_2026')
  assert.equal(__test.cleanInviteCode('short'), null)
  assert.equal(__test.isPrivatePath('/wiki-index.json'), true)
  assert.equal(__test.isPrivatePath('/world-map.jpg'), true)
  assert.equal(__test.isPrivatePath('/map-editor'), true)
  assert.equal(__test.isPrivatePath('/map-editor/'), true)
  assert.equal(__test.isPrivatePath('/map-editor.js'), true)
  assert.equal(__test.isPrivatePath('/species'), true)
  assert.equal(__test.isPrivatePath('/species.js'), true)
  assert.equal(__test.isPrivatePath('/search'), true)
  assert.equal(__test.isPrivatePath('/search.js'), true)
  assert.equal(__test.isPrivatePath('/timeline'), true)
  assert.equal(__test.isPrivatePath('/timeline/'), true)
  assert.equal(__test.isPrivatePath('/timeline.html'), true)
  assert.equal(__test.isPrivatePath('/timeline.js'), true)
  assert.equal(__test.isPrivatePath('/gazetteer'), true)
  assert.equal(__test.isPrivatePath('/gazetteer/'), true)
  assert.equal(__test.isPrivatePath('/gazetteer.html'), true)
  assert.equal(__test.isPrivatePath('/gazetteer.js'), true)
  assert.equal(__test.isPrivatePath('/atlas-chain.js'), true)
  assert.equal(__test.isPrivatePath('/wiki/timeline-index.json'), true)
  assert.equal(__test.isPrivatePath('/archive-compass.js'), true)
  assert.equal(__test.isPrivatePath('/archive-compass.css'), true)
  assert.equal(__test.isPrivatePath('/updates'), false)
  assert.equal(__test.cleanMapSlug('world'), 'world')
  assert.equal(__test.cleanMapSlug('../world'), null)
  assert.equal(__test.sanitizeMapDocument({ version: 1, slug: 'world', title: 'Atlas', layers: [{ id: 'political', name: 'Political', features: [] }] }, 'world')?.title, 'Atlas')
  assert.equal(__test.sanitizeMapDocument({ version: 1, slug: 'world', layers: [{ id: '../bad', name: 'Bad', features: [] }] }, 'world'), null)
  assert.equal(__test.sanitizeMapDocument({ version: 1, slug: 'world', layers: [{ id: 'political', name: 'Political', features: [{ id: 'marker_123456', type: 'marker', point: { lat: -1, lng: 12 } }] }] }, 'world'), null)
  assert.equal(__test.sanitizeMapDocument({ version: 1, slug: 'world', layers: [{ id: 'political', name: 'Political', features: [{ id: 'marker_123456', type: 'marker', point: { lat: 120, lng: 3841 } }] }] }, 'world'), null)
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

test('password hashes support legacy verification and modern upgrades', async () => {
  const salt = 'AAAAAAAAAAAAAAAAAAAAAA'
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('keeper-password'), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: Uint8Array.from(atob(salt), c => c.charCodeAt(0)), iterations: 100000, hash: 'SHA-256' }, key, 256)
  const legacyDigest = Buffer.from(bits).toString('base64url')
  assert.deepEqual(__test.parsePasswordHash(legacyDigest), { digest: legacyDigest, iterations: 100000, modern: false })
  assert.deepEqual(await __test.verifyPassword('keeper-password', salt, legacyDigest), { ok: true, needsUpgrade: true })
  const modern = await __test.createPasswordHash('keeper-password', salt)
  assert.match(modern, /^pbkdf2-sha256\$600000\$/)
  assert.deepEqual(await __test.verifyPassword('keeper-password', salt, modern), { ok: true, needsUpgrade: false })
  assert.equal((await __test.verifyPassword('wrong-password', salt, modern)).ok, false)
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
  assert.equal((await worker.fetch(new Request('https://worldofgeor.com/api/archive-state'), { JWT_SECRET: SECRET }, {})).status, 401)
  assert.equal((await worker.fetch(new Request('https://worldofgeor.com/api/workflow'), { JWT_SECRET: SECRET }, {})).status, 401)
  assert.equal((await worker.fetch(new Request('https://worldofgeor.com/api/additions/history?path=test.md'), { JWT_SECRET: SECRET }, {})).status, 401)
  const changelogResponse = await worker.fetch(new Request('https://worldofgeor.com/api/updates?limit=2'), { JWT_SECRET: SECRET }, {})
  assert.equal(changelogResponse.status, 200)
  assert.equal(changelogResponse.headers.get('cache-control'), 'public, max-age=15')
  const changelog = await changelogResponse.json()
  assert.equal(changelog.source, 'changelog')
  assert.equal(changelog.updates.length, 2)

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
  assert.equal(worldStats.canonical.species, worldStats.archive.species)
  assert.equal(worldStats.canonical.nations, worldStats.archive.nations)
  assert.equal(worldStats.live.activity, 7)
  assert.equal(worldStats.live.mapFolios, 1)
  const updatesResponse = await worker.fetch(new Request('https://worldofgeor.com/api/updates?limit=3'), { JWT_SECRET: SECRET, DB: db }, ctx)
  assert.equal(updatesResponse.status, 200)
  assert.equal(updatesResponse.headers.get('cache-control'), 'public, max-age=15, stale-while-revalidate=120')
  const updates = await updatesResponse.json()
  assert.equal(updates.source, 'changelog')
  assert.equal(updates.updates.length, 3)
  assert.match(updates.updates[0].summary, /unified archive shell/)
})

test('private files redirect to the gate and public aliases reach the intended asset', async () => {
  const env = {
    JWT_SECRET: SECRET,
    ASSETS: { fetch: async request => {
      const pathname = new URL(request.url).pathname
      return new Response(pathname, { headers: { 'Content-Type': pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain' } })
    } },
  }
  const privateResponse = await worker.fetch(new Request('https://worldofgeor.com/wiki-index.json', { headers: { Accept: 'text/html' } }), env, {})
  assert.equal(privateResponse.status, 302)
  assert.match(privateResponse.headers.get('location'), /next=%2Fwiki-index\.json/)
  assert.equal(privateResponse.headers.get('cache-control'), 'no-store')

  const protectedAssetResponse = await worker.fetch(new Request('https://worldofgeor.com/map-editor.js', { headers: { 'Sec-Fetch-Dest': 'script' } }), env, {})
  assert.equal(protectedAssetResponse.status, 401)
  const studioResponse = await worker.fetch(new Request('https://worldofgeor.com/map-editor', { headers: { Accept: 'text/html' } }), env, {})
  assert.equal(studioResponse.status, 302)
  assert.match(studioResponse.headers.get('location'), /next=%2Fmap-editor/)
  assert.equal(studioResponse.headers.get('cache-control'), 'no-store')
  const studioSlashResponse = await worker.fetch(new Request('https://worldofgeor.com/map-editor/', { headers: { Accept: 'text/html' } }), env, {})
  assert.equal(studioSlashResponse.status, 302)
  assert.equal(studioSlashResponse.headers.get('cache-control'), 'no-store')
  const speciesResponse = await worker.fetch(new Request('https://worldofgeor.com/species', { headers: { Accept: 'text/html' } }), env, {})
  assert.equal(speciesResponse.status, 302)
  assert.equal(speciesResponse.headers.get('cache-control'), 'no-store')

  const publicResponse = await worker.fetch(new Request('https://worldofgeor.com/updates'), env, {})
  assert.equal(publicResponse.status, 200)
  assert.equal(await publicResponse.text(), '/updates.html')
  assert.equal(publicResponse.headers.get('cache-control'), 'public, max-age=300, must-revalidate')
  const publicSlashResponse = await worker.fetch(new Request('https://worldofgeor.com/updates/'), env, {})
  assert.equal(publicSlashResponse.status, 200)
  assert.equal(await publicSlashResponse.text(), '/updates.html')

  const studioHtml = readFileSync(new URL('../public/map-editor.html', import.meta.url), 'utf8')
  const studioScript = readFileSync(new URL('../public/map-editor.js', import.meta.url), 'utf8')
  const atlasHtml = readFileSync(new URL('../public/atlas.html', import.meta.url), 'utf8')
  const appHtml = readFileSync(new URL('../public/app/index.html', import.meta.url), 'utf8')
  const updatesHtml = readFileSync(new URL('../public/updates.html', import.meta.url), 'utf8')
  const workerSource = readFileSync(new URL('../worker.js', import.meta.url), 'utf8')
  const compassScript = readFileSync(new URL('../public/archive-compass.js', import.meta.url), 'utf8')
  assert.match(studioHtml, /unpkg\.com\/leaflet@1\.9\.4\/dist\/leaflet\.js/)
  assert.match(studioHtml, /integrity="sha256-20nQCchB9co0qIjJZRGuk2\/Z9VM\+kNiyxNV1lvTlZBo="/)
  assert.match(studioScript, /world: \{ slug: 'world', title: 'World Atlas', width: 3840, height: 1920/)
  assert.match(studioScript, /L\.map\('editorMap', \{ crs: L\.CRS\.Simple/)
  assert.match(studioScript, /method: 'POST'.+body: JSON\.stringify\(\{ map: state \}\)/)
  assert.match(studioScript, /Math\.min\(config\.height, Math\.max\(0, Math\.round\(latlng\.lat\)\)\)/)
  assert.match(studioScript, /globalThis\.history\.replaceState/)
  assert.match(atlasHtml, /L\.map\(mapEl, \{ crs:L\.CRS\.Simple/)
  assert.doesNotMatch(atlasHtml, /C:\\Users\\/)
  assert.match(appHtml, /leaflet\.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2\/Z9VM\+kNiyxNV1lvTlZBo="/)
  assert.match(appHtml, /const allowed = \['md','txt','json','yaml','yml','csv'\]/)
  assert.match(workerSource, /archive-compass\.js/)
  assert.match(compassScript, /ctrlKey/)
  assert.match(compassScript, /wiki-index\.json/)
  assert.match(compassScript, /geor_archive_bookmarks_v1/)
  assert.match(compassScript, /geor-reading-progress/)
  assert.match(compassScript, /geor-archive-rail/)
  assert.match(compassScript, /geor-split-panel/)
  assert.match(workerSource, /\/api\/archive-state/)
  assert.match(workerSource, /\/api\/workflow/)
  assert.match(workerSource, /\/api\/additions\/history/)
  assert.match(studioScript, /geor_atlas_draft_v1_/)
  assert.match(atlasHtml, /atlasFullscreen/)
  assert.match(updatesHtml, /data-update-filter="security"/)
  for (const releaseId of ['release-unified-archive', 'release-reader-experience', 'release-compass', 'release-auth-v2', 'release-species', 'release-stats', 'release-studio', 'release-reserve', 'release-atlas', 'release-ledger']) {
    assert.match(workerSource, new RegExp(releaseId))
    assert.match(updatesHtml, new RegExp(releaseId))
  }
})

test('timeline page and timeline index stay behind the gate', async () => {
  const timelineHtml = readFileSync(new URL('../public/timeline.html', import.meta.url), 'utf8')
  const env = {
    JWT_SECRET: SECRET,
    ASSETS: { fetch: async request => {
      const pathname = new URL(request.url).pathname
      const body = pathname === '/timeline.html' ? timelineHtml : pathname
      return new Response(body, { headers: { 'Content-Type': pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/json' } })
    } },
  }
  for (const path of ['/timeline', '/timeline/']) {
    const response = await worker.fetch(new Request(`https://worldofgeor.com${path}`, { headers: { Accept: 'text/html' } }), env, {})
    assert.equal(response.status, 302, path)
    assert.match(response.headers.get('location'), /next=%2Ftimeline/, path)
    assert.equal(response.headers.get('cache-control'), 'no-store', path)
  }
  const gatedScript = await worker.fetch(new Request('https://worldofgeor.com/timeline.js', { headers: { 'Sec-Fetch-Dest': 'script' } }), env, {})
  assert.equal(gatedScript.status, 401)
  const gatedIndex = await worker.fetch(new Request('https://worldofgeor.com/wiki/timeline-index.json', { headers: { Accept: 'text/html' } }), env, {})
  assert.equal(gatedIndex.status, 302)
  assert.match(gatedIndex.headers.get('location'), /timeline-index\.json/)
  const gatedIndexJson = await worker.fetch(new Request('https://worldofgeor.com/wiki/timeline-index.json', { headers: { Accept: 'application/json' } }), env, {})
  assert.equal(gatedIndexJson.status, 401)

  const now = Math.floor(Date.now() / 1000)
  const token = await __test.signJwt({ email: 'keeper@example.com', iss: 'worldofgeor', iat: now, exp: now + 60 }, SECRET)
  const authed = await worker.fetch(new Request('https://worldofgeor.com/timeline', { headers: { Cookie: `geor_token=${token}`, Accept: 'text/html' } }), env, {})
  assert.equal(authed.status, 200)
  assert.equal(authed.headers.get('cache-control'), 'private, no-store')
  const html = await authed.text()
  assert.match(html, /TIMELINE OF THE AGES/)
  assert.match(html, /eraRail/)
  assert.match(html, /timeline\.js/)
})

test('cross-origin logout is blocked before cookies are changed', async () => {
  const request = new Request('https://worldofgeor.com/api/logout', { method: 'POST', headers: { Origin: 'https://attacker.example' } })
  const response = await worker.fetch(request, { JWT_SECRET: SECRET }, {})
  assert.equal(response.status, 403)
  assert.equal(response.headers.get('set-cookie'), null)
})

test('login throttling blocks repeated attempts without storing the raw client address', async () => {
  const limits = new Map()
  const db = {
    prepare(sql) {
      let args = []
      return {
        bind(...values) { args = values; return this },
        async run() {
          if (sql.includes('INSERT INTO rate_limits')) {
            const [key, resetAt] = args
            const current = limits.get(key)
            limits.set(key, { attempts: current ? current.attempts + 1 : 1, reset_at: current?.reset_at || resetAt })
          }
          if (sql.includes('DELETE FROM rate_limits')) limits.delete(args[0])
          return { meta: { changes: 1 } }
        },
        async first() {
          if (sql.includes('FROM rate_limits')) return limits.get(args[0]) || null
          if (sql.includes('FROM users')) return null
          return null
        },
        async all() { return { results: [] } },
      }
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())) },
  }
  const makeRequest = () => new Request('https://worldofgeor.com/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://worldofgeor.com', 'CF-Connecting-IP': '203.0.113.44' },
    body: JSON.stringify({ email: 'unknown@example.com', password: 'not-the-password' }),
  })
  for (let attempt = 0; attempt < 8; attempt++) assert.equal((await worker.fetch(makeRequest(), { JWT_SECRET: SECRET, DB: db }, {})).status, 401)
  const blocked = await worker.fetch(makeRequest(), { JWT_SECRET: SECRET, DB: db }, {})
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.headers.get('retry-after')) > 0)
  assert.equal([...limits.keys()].some(key => key.includes('203.0.113.44')), false)
})

test('crawler traps stay private: no sitemap, no crawl', async () => {
  const sitemap = await worker.fetch(new Request('https://worldofgeor.com/sitemap.xml'), { JWT_SECRET: SECRET }, {})
  assert.equal(sitemap.status, 404)
  assert.equal(sitemap.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive')
  const robots = await worker.fetch(new Request('https://worldofgeor.com/robots.txt'), { JWT_SECRET: SECRET }, {})
  assert.equal(robots.status, 200)
  assert.match(await robots.text(), /Disallow: \//)
  assert.equal(robots.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive')
  const rootHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(rootHtml, /<meta name="robots" content="noindex, nofollow, noarchive"/)
})

// --- Wave B: path-driven article layouts ------------------------------------
// Minimal HTMLRewriter test double: implements exactly the API surface the
// worker uses (on/head/body/article-h1 + append/before/get/setAttribute) so
// fetch-level hero assertions run in node, where the platform global is absent.
function parseFakeAttrs(tag) {
  const attrs = {}
  const inner = tag.replace(/^<\w+/, '').replace(/\/?>$/, '')
  for (const match of inner.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[match[1]] = match[2] ?? ''
  return attrs
}

function renderFakeAttrs(attrs) {
  return Object.entries(attrs).map(([key, value]) => (value === '' ? ` ${key}` : ` ${key}="${value}"`)).join('')
}

class FakeHTMLRewriter {
  constructor() { this.rules = [] }
  on(selector, handlers) { this.rules.push([selector, handlers]); return this }
  async transform(response) {
    let html = await response.text()
    for (const [selector, handlers] of this.rules) {
      if (!handlers.element) continue
      if (selector === 'head' || selector === 'body') {
        const open = html.match(new RegExp(`<${selector}(\\s[^>]*)?>`, 'i'))
        assert.ok(open, `fake rewriter: <${selector}> missing`)
        const attrs = parseFakeAttrs(open[0])
        handlers.element({
          getAttribute: name => (name in attrs ? attrs[name] : null),
          setAttribute: (name, value) => { attrs[name] = value },
          append: fragment => {
            const close = html.match(new RegExp(`</${selector}>`, 'i'))
            html = `${html.slice(0, close.index)}${fragment}${html.slice(close.index)}`
          },
        })
        html = `${html.slice(0, open.index)}<${selector}${renderFakeAttrs(attrs)}>${html.slice(open.index + open[0].length)}`
      } else if (selector === 'article h1') {
        // First in-article h1 only — mirrors the worker's heroApplied guard.
        const article = html.match(/<article(\s[^>]*)?>/i)
        if (!article) continue
        const rest = html.slice(article.index)
        const h1 = rest.match(/<h1(\s[^>]*)?>/i)
        if (!h1) continue
        const absolute = article.index + h1.index
        const attrs = parseFakeAttrs(h1[0])
        let beforeFragment = ''
        handlers.element({
          getAttribute: name => (name in attrs ? attrs[name] : null),
          setAttribute: (name, value) => { attrs[name] = value },
          before: fragment => { beforeFragment += fragment },
        })
        html = `${html.slice(0, absolute)}${beforeFragment}<h1${renderFakeAttrs(attrs)}>${html.slice(absolute + h1[0].length)}`
      }
    }
    return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}

test('article layouts classify real wiki prefixes and nothing else', () => {
  assert.deepEqual(__test.classifyArticleLayout('/wiki/World/History/Characters/Aelis/'), { bodyClass: 'geor-layout-character', eyebrow: 'Character' })
  assert.deepEqual(__test.classifyArticleLayout('/wiki/World/Nations/Central%20Erisdar/'), { bodyClass: 'geor-layout-nation', eyebrow: 'Nation' })
  assert.deepEqual(__test.classifyArticleLayout('/wiki/World/History/Events/Age%200%20%E2%80%94%20The%20Lost%20Era/'), { bodyClass: 'geor-layout-event', eyebrow: 'Event' })
  for (const pathname of [
    '/wiki/World/History/Characters/',
    '/wiki/World/Nations/',
    '/wiki/World/History/Events/',
    '/wiki/World/Locations/Cleton%20Island/',
    '/wiki/World/Species/Elves/',
    '/wiki/World/History/Figures/Someone/',
    '/wiki/',
    '/updates',
    '/',
  ]) assert.equal(__test.classifyArticleLayout(pathname), null, pathname)
})

test('article layout hero injects on matching wiki articles only', async () => {
  const previous = globalThis.HTMLRewriter
  globalThis.HTMLRewriter = FakeHTMLRewriter
  try {
    const now = Math.floor(Date.now() / 1000)
    const token = await __test.signJwt({ email: 'keeper@example.com', iss: 'worldofgeor', iat: now, exp: now + 60 }, SECRET)
    const articleHtml = '<!DOCTYPE html><html><head><title>Aelis</title></head><body dir="ltr"><article class="md-content__inner md-typeset"><h1 id="aelis">Aelis</h1><p>Keeper.</p></article></body></html>'
    const pngBytes = new Uint8Array([137, 80, 78, 71])
    const env = {
      JWT_SECRET: SECRET,
      ASSETS: { fetch: async request => {
        const pathname = new URL(request.url).pathname
        if (pathname.endsWith('.png')) return new Response(pngBytes, { headers: { 'Content-Type': 'image/png' } })
        return new Response(articleHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      } },
    }
    const authed = path => new Request(`https://worldofgeor.com${path}`, { headers: { Cookie: `geor_token=${token}` } })
    for (const [path, bodyClass, eyebrow] of [
      ['/wiki/World/History/Characters/Aelis/', 'geor-layout-character', 'Character'],
      ['/wiki/World/Nations/Central%20Erisdar/', 'geor-layout-nation', 'Nation'],
      ['/wiki/World/History/Events/Age%200%20%E2%80%94%20The%20Lost%20Era/', 'geor-layout-event', 'Event'],
    ]) {
      const response = await worker.fetch(authed(path), env, {})
      assert.equal(response.status, 200, path)
      const html = await response.text()
      assert.match(html, new RegExp(bodyClass), path)
      assert.match(html, new RegExp(`<p class="geor-hero-eyebrow">${eyebrow}</p>`), path)
      assert.match(html, /article-layouts\.css/, path)
      assert.match(html, /archive-compass\.js/, path)
    }
    const plain = await worker.fetch(authed('/wiki/World/Locations/Cleton%20Island/'), env, {})
    assert.equal(plain.status, 200)
    const plainHtml = await plain.text()
    assert.match(plainHtml, /archive-compass\.js/)
    assert.doesNotMatch(plainHtml, /geor-layout-/)
    assert.doesNotMatch(plainHtml, /geor-hero-eyebrow/)
    assert.doesNotMatch(plainHtml, /article-layouts\.css/)
    const image = await worker.fetch(authed('/wiki/World/Maps%20and%20Assets/x.png'), env, {})
    assert.equal(image.status, 200)
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), pngBytes)
    const gated = await worker.fetch(new Request('https://worldofgeor.com/wiki/World/Nations/Central%20Erisdar/'), env, {})
    assert.equal(gated.status, 302)
  } finally {
    if (previous === undefined) delete globalThis.HTMLRewriter
    else globalThis.HTMLRewriter = previous
  }
})

// --- Wave B2: spoiler-block secrets ------------------------------------------
// Author syntax (documented in worker.js — the vault is never touched):
//   <div class="geor-secret" data-secret="slug-id">hidden html</div>
//   <div class="geor-secret-gm">owner-only notes</div>
const SECRET_BYTES = 'S3CR3T-VAULT-KEY-BYTES-9f8e7d6c5b4a'
const GM_BYTES = 'GM-ONLY-NOTES-BYTES-1a2b3c4d5e6f'
const secretArticleHtml = () => `<!DOCTYPE html><html><head><title>Veil</title></head><body dir="ltr"><article class="md-content__inner md-typeset"><h1 id="veil">Veil</h1><div class="geor-secret" data-secret="vault-key"><p>${SECRET_BYTES}</p></div><div class="geor-secret-gm"><p>${GM_BYTES}</p></div></article></body></html>`

// Test double covering the selectors the worker registers (head/body/
// article-h1 like the layout fake, plus the two secret selectors).
class FakeSecretsRewriter {
  constructor() { this.rules = [] }
  on(selector, handlers) { this.rules.push([selector, handlers]); return this }
  async transform(response) {
    let html = await response.text()
    for (const [selector, handlers] of this.rules) {
      const handle = handlers.element
      if (!handle) continue
      if (selector === 'head') {
        let out = ''
        handle({ append: fragment => { out += fragment } })
        html = html.replace(/<\/head>/i, `${out}</head>`)
      } else if (selector === 'body') {
        const open = html.match(/<body(\s[^>]*)?>/i)
        assert.ok(open, 'fake rewriter: <body> missing')
        const attrs = parseFakeAttrs(open[0])
        let tail = ''
        handle({
          getAttribute: name => (name in attrs ? attrs[name] : null),
          setAttribute: (name, value) => { attrs[name] = value },
          append: fragment => { tail += fragment },
        })
        html = `${html.slice(0, open.index)}<body${renderFakeAttrs(attrs)}>${html.slice(open.index + open[0].length)}`
        html = html.replace(/<\/body>/i, `${tail}</body>`)
      } else if (selector === 'article h1') {
        const article = html.match(/<article(\s[^>]*)?>/i)
        if (!article) continue
        const rest = html.slice(article.index)
        const h1 = rest.match(/<h1(\s[^>]*)?>/i)
        if (!h1) continue
        const absolute = article.index + h1.index
        const attrs = parseFakeAttrs(h1[0])
        let beforeFragment = ''
        handle({
          getAttribute: name => (name in attrs ? attrs[name] : null),
          setAttribute: (name, value) => { attrs[name] = value },
          before: fragment => { beforeFragment += fragment },
        })
        html = `${html.slice(0, absolute)}${beforeFragment}<h1${renderFakeAttrs(attrs)}>${html.slice(absolute + h1[0].length)}`
      } else if (selector === 'div.geor-secret' || selector === 'div.geor-secret-gm') {
        const token = selector === 'div.geor-secret' ? 'geor-secret' : 'geor-secret-gm'
        const matches = [...html.matchAll(/<div(\s[^>]*)?>([\s\S]*?)<\/div>/gi)]
          .filter(m => {
            const classes = (parseFakeAttrs(`<div${m[1] || ''}>`).class || '').split(/\s+/).filter(Boolean)
            return token === 'geor-secret'
              ? classes.includes('geor-secret') && !classes.includes('geor-secret-gm')
              : classes.includes('geor-secret-gm')
          })
        for (let i = matches.length - 1; i >= 0; i--) {
          const m = matches[i]
          const start = m.index
          const end = start + m[0].length
          const attrs = parseFakeAttrs(`<div${m[1] || ''}>`)
          let inner = m[2]
          let removed = false
          let keepContent = false
          let before = ''
          let after = ''
          handle({
            getAttribute: name => (name in attrs ? attrs[name] : null),
            setAttribute: (name, value) => { attrs[name] = value },
            removeAttribute: name => { delete attrs[name] },
            setInnerContent: content => { inner = content },
            remove: () => { removed = true },
            removeAndKeepContent: () => { keepContent = true },
            before: fragment => { before += fragment },
            after: fragment => { after = fragment + after },
          })
          const replacement = removed ? '' : keepContent ? inner : `<div${renderFakeAttrs(attrs)}>${inner}</div>`
          html = `${html.slice(0, start)}${before}${replacement}${after}${html.slice(end)}`
        }
      }
    }
    return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}

// Mock D1 mirroring the existing mock-db pattern, plus reveals + roles.
function makeSecretsDb({ roles = {}, seedReveals = [] } = {}) {
  const reveals = new Map(seedReveals.map(([member, id, state]) => [`${member}\0${id}`, state]))
  const limits = new Map()
  return {
    reveals,
    limits,
    prepare(sql) {
      let args = []
      const api = {
        bind(...values) { args = values; return api },
        async run() {
          if (sql.includes('INSERT INTO rate_limits')) {
            const [key, resetAt] = args
            const current = limits.get(key)
            limits.set(key, { attempts: (current?.attempts || 0) + 1, reset_at: current?.reset_at ?? resetAt })
          }
          if (sql.includes('DELETE FROM rate_limits')) limits.delete(args[0])
          if (sql.includes('INSERT INTO reveals')) {
            if (sql.includes("VALUES ('*'")) reveals.set(`*\0${args[0]}`, args[1])
            else reveals.set(`${args[0]}\0${args[1]}`, 'revealed')
          }
          return { meta: { changes: 1 } }
        },
        async first() {
          if (sql.includes('FROM rate_limits')) {
            const record = limits.get(args[0])
            return record ? { attempts: record.attempts, reset_at: record.reset_at } : null
          }
          if (sql.includes('SELECT role FROM users')) return roles[args[0]] ? { role: roles[args[0]] } : null
          return null
        },
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

async function secretsToken(email) {
  const now = Math.floor(Date.now() / 1000)
  return __test.signJwt({ email, iss: 'worldofgeor', iat: now, exp: now + 60 }, SECRET)
}

function secretsEnv(db) {
  return {
    JWT_SECRET: SECRET,
    DB: db,
    ASSETS: { fetch: async () => new Response(secretArticleHtml(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) },
  }
}

const secretsArticle = token => new Request('https://worldofgeor.com/wiki/World/Nations/Veil/', { headers: { Cookie: `geor_token=${token}` } })
const secretsPost = (path, token, body, extraHeaders = {}) => new Request(`https://worldofgeor.com${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: `geor_token=${token}` } : {}), ...extraHeaders },
  body: JSON.stringify(body),
})

async function withSecretsRewriter(fn) {
  const previous = globalThis.HTMLRewriter
  globalThis.HTMLRewriter = FakeSecretsRewriter
  try { await fn() } finally {
    if (previous === undefined) delete globalThis.HTMLRewriter
    else globalThis.HTMLRewriter = previous
  }
}

test('secrets: locked responses carry zero secret bytes', async () => {
  await withSecretsRewriter(async () => {
    const db = makeSecretsDb({ roles: { 'member@example.com': 'viewer' } })
    const html = await (await worker.fetch(secretsArticle(await secretsToken('member@example.com')), secretsEnv(db), {})).text()
    assert.equal(html.includes(SECRET_BYTES), false, 'locked card must not contain secret bytes')
    assert.equal(html.includes(GM_BYTES), false, 'GM notes must never reach non-owners')
    assert.match(html, /geor-secret-locked/)
    assert.match(html, /data-geor-reveal="vault-key"/)
    assert.match(html, /\/api\/secrets\/reveal/)
  })
})

test('secrets: reveal persists per member; bad ids rejected', async () => {
  assert.equal(__test.cleanSecretId('vault-key'), 'vault-key')
  assert.equal(__test.cleanSecretId('Bad_ID!!'), null)
  assert.equal(__test.cleanSecretId(''), null)
  await withSecretsRewriter(async () => {
    const db = makeSecretsDb({ roles: { 'member@example.com': 'viewer', 'other@example.com': 'viewer' } })
    const env = secretsEnv(db)
    const token = await secretsToken('member@example.com')
    const bad = await worker.fetch(secretsPost('/api/secrets/reveal', token, { id: 'Bad_ID!!' }), env, {})
    assert.equal(bad.status, 400)
    const revealed = await worker.fetch(secretsPost('/api/secrets/reveal', token, { id: 'vault-key' }), env, {})
    assert.equal(revealed.status, 200)
    assert.deepEqual(await revealed.json(), { ok: true, id: 'vault-key', state: 'revealed' })
    const mine = await (await worker.fetch(secretsArticle(token), env, {})).text()
    assert.equal(mine.includes(SECRET_BYTES), true, 'revealed member reads the content unwrapped')
    assert.equal(mine.includes('data-geor-reveal="vault-key"'), false)
    const other = await (await worker.fetch(secretsArticle(await secretsToken('other@example.com')), env, {})).text()
    assert.equal(other.includes(SECRET_BYTES), false, 'reveal is per-member, not global')
  })
})

test('secrets: GM stripped for editors, visible to owners', async () => {
  await withSecretsRewriter(async () => {
    const db = makeSecretsDb({ roles: { 'editor@example.com': 'editor', 'owner@example.com': 'owner' } })
    const env = secretsEnv(db)
    const editorHtml = await (await worker.fetch(secretsArticle(await secretsToken('editor@example.com')), env, {})).text()
    assert.equal(editorHtml.includes(GM_BYTES), false, 'editors never receive GM notes')
    assert.equal(editorHtml.includes(SECRET_BYTES), false, 'editors still see locked secrets')
    const ownerHtml = await (await worker.fetch(secretsArticle(await secretsToken('owner@example.com')), env, {})).text()
    assert.equal(ownerHtml.includes(GM_BYTES), true, 'owners read GM notes')
    assert.equal(ownerHtml.includes(SECRET_BYTES), true, 'owners bypass secret locks')
  })
})

test('secrets: global set is owner-only and applies to all members', async () => {
  await withSecretsRewriter(async () => {
    const db = makeSecretsDb({ roles: { 'member@example.com': 'viewer', 'owner@example.com': 'owner' } })
    const env = secretsEnv(db)
    const member = await secretsToken('member@example.com')
    const owner = await secretsToken('owner@example.com')
    assert.equal((await worker.fetch(secretsPost('/api/secrets/set', null, { id: 'vault-key', state: 'revealed' }), env, {})).status, 401)
    assert.equal((await worker.fetch(secretsPost('/api/secrets/set', member, { id: 'vault-key', state: 'revealed' }), env, {})).status, 403)
    assert.equal((await worker.fetch(secretsPost('/api/secrets/set', owner, { id: 'vault-key', state: 'sometimes' }), env, {})).status, 400)
    const set = await worker.fetch(secretsPost('/api/secrets/set', owner, { id: 'vault-key', state: 'revealed' }), env, {})
    assert.equal(set.status, 200)
    assert.deepEqual(await set.json(), { ok: true, id: 'vault-key', state: 'revealed' })
    const globalHtml = await (await worker.fetch(secretsArticle(member), env, {})).text()
    assert.equal(globalHtml.includes(SECRET_BYTES), true, 'global reveal opens the secret for every viewer')
    const relock = await worker.fetch(secretsPost('/api/secrets/set', owner, { id: 'vault-key', state: 'locked' }), env, {})
    assert.equal(relock.status, 200)
    const relockedHtml = await (await worker.fetch(secretsArticle(member), env, {})).text()
    assert.equal(relockedHtml.includes(SECRET_BYTES), false, 'global lock closes it again')
  })
})

test('secrets: logged-out reveal attempts are rejected at the gate', async () => {
  await withSecretsRewriter(async () => {
    const db = makeSecretsDb()
    const env = secretsEnv(db)
    assert.equal((await worker.fetch(secretsPost('/api/secrets/reveal', null, { id: 'vault-key' }), env, {})).status, 401)
    assert.equal((await worker.fetch(secretsPost('/api/secrets/set', null, { id: 'vault-key', state: 'revealed' }), env, {})).status, 401)
    const gated = await worker.fetch(new Request('https://worldofgeor.com/wiki/World/Nations/Veil/'), env, {})
    assert.equal(gated.status, 302, 'logged-out HTML never reaches the transform')
  })
})

test('secrets: reveal attempts are rate limited', async () => {
  const db = makeSecretsDb({ roles: { 'member@example.com': 'viewer' } })
  const env = secretsEnv(db)
  const token = await secretsToken('member@example.com')
  const headers = { 'CF-Connecting-IP': '203.0.113.77' }
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await worker.fetch(secretsPost('/api/secrets/reveal', token, { id: 'vault-key' }, headers), env, {})
    assert.equal(response.status, 200, `attempt ${attempt + 1}`)
  }
  const blocked = await worker.fetch(secretsPost('/api/secrets/reveal', token, { id: 'vault-key' }, headers), env, {})
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.headers.get('retry-after')) > 0)
})

// --- Wave B4a: auto-migrate proves itself on a pre-0006 database --------------
// Old-schema mock: only pre-0006 tables exist, users has no role column.
// Missing tables / columns throw exactly like D1/SQLite would, so a green
// reveal here proves ensureTables() created them (mirrors 0006_foundation.sql).
function makeOldSchemaDb({ roles = {} } = {}) {
  const tables = new Set(['users', 'invites', 'requests', 'activity', 'map_documents', 'rate_limits', 'member_library', 'workflow_items', 'workflow_history'])
  let roleAdded = false
  const reveals = new Map()
  const limits = new Map()
  const tableOf = sql => {
    const create = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)
    if (create) return create[1]
    const into = sql.match(/INSERT INTO (\w+)/i)
    if (into) return into[1]
    const from = sql.match(/FROM (\w+)/i)
    if (from) return from[1]
    return null
  }
  return {
    tables,
    reveals,
    get roleAdded() { return roleAdded },
    prepare(sql) {
      let args = []
      const api = {
        bind(...values) { args = values; return api },
        async run() {
          if (/CREATE TABLE IF NOT EXISTS/i.test(sql)) { tables.add(tableOf(sql)); return { meta: { changes: 0 } } }
          if (/CREATE INDEX IF NOT EXISTS/i.test(sql)) return { meta: { changes: 0 } }
          if (/ALTER TABLE users ADD COLUMN role/i.test(sql)) {
            if (roleAdded) throw new Error('duplicate column name: role')
            roleAdded = true
            return { meta: { changes: 0 } }
          }
          if (sql.includes('INSERT INTO rate_limits')) {
            const [key, resetAt] = args
            const current = limits.get(key)
            limits.set(key, { attempts: (current?.attempts || 0) + 1, reset_at: current?.reset_at ?? resetAt })
            return { meta: { changes: 1 } }
          }
          if (sql.includes('DELETE FROM rate_limits')) { limits.delete(args[0]); return { meta: { changes: 1 } } }
          if (sql.includes('INSERT INTO reveals')) {
            if (!tables.has('reveals')) throw new Error('no such table: reveals')
            if (sql.includes("VALUES ('*'")) reveals.set(`*\0${args[0]}`, args[1])
            else reveals.set(`${args[0]}\0${args[1]}`, 'revealed')
            return { meta: { changes: 1 } }
          }
          return { meta: { changes: 0 } }
        },
        async first() {
          if (sql.includes('FROM rate_limits')) {
            const record = limits.get(args[0])
            return record ? { attempts: record.attempts, reset_at: record.reset_at } : null
          }
          if (sql.includes('SELECT role FROM users')) {
            if (!roleAdded) throw new Error('no such column: role')
            return roles[args[0]] ? { role: roles[args[0]] } : null
          }
          return null
        },
        async all() {
          if (sql.includes('FROM reveals')) {
            if (!tables.has('reveals')) throw new Error('no such table: reveals')
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

test('automigrate: reveal succeeds on a pre-0006 database and backfills 0006 tables', async () => {
  await withSecretsRewriter(async () => {
    const db = makeOldSchemaDb({ roles: { 'member@example.com': 'viewer' } })
    const env = secretsEnv(db)
    const token = await secretsToken('member@example.com')
    const revealed = await worker.fetch(secretsPost('/api/secrets/reveal', token, { id: 'vault-key' }), env, {})
    assert.equal(revealed.status, 200, 'auto-migrate must create reveals before the insert')
    assert.deepEqual(await revealed.json(), { ok: true, id: 'vault-key', state: 'revealed' })
    for (const table of ['reveals', 'notes', 'arcs', 'plots', 'threads', 'boards']) {
      assert.equal(db.tables.has(table), true, `ensureTables created ${table}`)
    }
    assert.equal(db.roleAdded, true, 'users.role column probed and added')
    const role = await db.prepare('SELECT role FROM users WHERE email = ?').bind('member@example.com').first()
    assert.deepEqual(role, { role: 'viewer' }, 'role probe path reads after the ALTER')
  })
})

// --- Wave B3: related-articles sidebar ---------------------------------------
// Tiny fake tags index in the real generator shape
// ({items:[{tag, count, pages:[{title, path}]}]} — see scripts/generate_tags.py).
// Tag totals: Aelis 3 (elves, magic, aelis-only), Veil 2, Rune 4, Other 4,
// Lone 1 (solo, no co-pages). For Aelis the expected order is
// Veil (2 shared) → Rune (2 shared, more tags) → Other (1 shared).
const RELATED_TAGS_INDEX = {
  source: 'test',
  files_scanned: 6,
  files_with_tags: 5,
  items: [
    { tag: 'elves', count: 4, pages: [
      { title: 'Aelis', path: 'World/History/Characters/Aelis.md' },
      { title: 'Veil', path: 'World/Nations/Veil.md' },
      { title: 'Rune', path: 'World/History/Events/Rune.md' },
      { title: 'Other', path: 'World/History/Events/Other.md' },
    ] },
    { tag: 'magic', count: 3, pages: [
      { title: 'Aelis', path: 'World/History/Characters/Aelis.md' },
      { title: 'Veil', path: 'World/Nations/Veil.md' },
      { title: 'Rune', path: 'World/History/Events/Rune.md' },
    ] },
    { tag: 'aelis-only', count: 1, pages: [{ title: 'Aelis', path: 'World/History/Characters/Aelis.md' }] },
    { tag: 'rune-x', count: 1, pages: [{ title: 'Rune', path: 'World/History/Events/Rune.md' }] },
    { tag: 'rune-y', count: 1, pages: [{ title: 'Rune', path: 'World/History/Events/Rune.md' }] },
    { tag: 'other-x', count: 1, pages: [{ title: 'Other', path: 'World/History/Events/Other.md' }] },
    { tag: 'other-y', count: 1, pages: [{ title: 'Other', path: 'World/History/Events/Other.md' }] },
    { tag: 'other-z', count: 1, pages: [{ title: 'Other', path: 'World/History/Events/Other.md' }] },
    { tag: 'solo', count: 1, pages: [{ title: 'Lone', path: 'World/Nations/Lone.md' }] },
  ],
}

// Test double covering the selectors the worker registers for related pages
// (head/body/article-h1 like the earlier fakes, plus article append).
// Secret selectors are ignored — related fixtures carry no secret blocks.
class FakeRelatedRewriter {
  constructor() { this.rules = [] }
  on(selector, handlers) { this.rules.push([selector, handlers]); return this }
  async transform(response) {
    let html = await response.text()
    for (const [selector, handlers] of this.rules) {
      const handle = handlers.element
      if (!handle) continue
      if (selector === 'head') {
        let out = ''
        handle({ append: fragment => { out += fragment } })
        html = html.replace(/<\/head>/i, `${out}</head>`)
      } else if (selector === 'body') {
        const open = html.match(/<body(\s[^>]*)?>/i)
        assert.ok(open, 'fake rewriter: <body> missing')
        const attrs = parseFakeAttrs(open[0])
        let tail = ''
        handle({
          getAttribute: name => (name in attrs ? attrs[name] : null),
          setAttribute: (name, value) => { attrs[name] = value },
          append: fragment => { tail += fragment },
        })
        html = `${html.slice(0, open.index)}<body${renderFakeAttrs(attrs)}>${html.slice(open.index + open[0].length)}`
        html = html.replace(/<\/body>/i, `${tail}</body>`)
      } else if (selector === 'article h1') {
        const article = html.match(/<article(\s[^>]*)?>/i)
        if (!article) continue
        const rest = html.slice(article.index)
        const h1 = rest.match(/<h1(\s[^>]*)?>/i)
        if (!h1) continue
        const absolute = article.index + h1.index
        const attrs = parseFakeAttrs(h1[0])
        let beforeFragment = ''
        handle({
          getAttribute: name => (name in attrs ? attrs[name] : null),
          setAttribute: (name, value) => { attrs[name] = value },
          before: fragment => { beforeFragment += fragment },
        })
        html = `${html.slice(0, absolute)}${beforeFragment}<h1${renderFakeAttrs(attrs)}>${html.slice(absolute + h1[0].length)}`
      } else if (selector === 'article') {
        if (!/<article(\s[^>]*)?>/i.test(html)) continue
        let tail = ''
        handle({ append: fragment => { tail += fragment } })
        html = html.replace(/<\/article>/i, `${tail}</article>`)
      }
    }
    return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}

async function withRelatedRewriter(fn) {
  const previous = globalThis.HTMLRewriter
  globalThis.HTMLRewriter = FakeRelatedRewriter
  try { await fn() } finally {
    if (previous === undefined) delete globalThis.HTMLRewriter
    else globalThis.HTMLRewriter = previous
  }
}

// Mock ASSETS: serves the fake tags index at /wiki/tags-index.json and a
// generic MkDocs-shaped article everywhere else. Counts index fetches.
function relatedTestEnv({ tagIndex = RELATED_TAGS_INDEX, tagStatus = 200, counter = null } = {}) {
  return {
    JWT_SECRET: SECRET,
    ASSETS: { fetch: async request => {
      const pathname = new URL(request.url).pathname
      if (pathname === '/wiki/tags-index.json') {
        if (counter) counter.tags++
        if (tagStatus !== 200) return new Response('missing', { status: tagStatus })
        return Response.json(tagIndex)
      }
      const title = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || 'Page')
      return new Response(
        `<!DOCTYPE html><html><head><title>${title}</title></head><body dir="ltr"><article class="md-content__inner md-typeset"><h1>${title}</h1><p>Body.</p></article></body></html>`,
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      )
    } },
  }
}

const relatedArticle = (path, token) => new Request(`https://worldofgeor.com${path}`, { headers: { Cookie: `geor_token=${token}` } })

test('related: scoring prefers shared tags, then specificity, capped at five', () => {
  const lookup = __test.buildRelatedLookup(RELATED_TAGS_INDEX.items)
  const related = __test.computeRelated('World/History/Characters/Aelis.md', lookup)
  assert.deepEqual(related.map(entry => entry.title), ['Veil', 'Rune', 'Other'])
  assert.deepEqual(related.map(entry => entry.shared), [2, 2, 1])
  assert.equal(related[0].url, '/wiki/World/Nations/Veil/')
  assert.ok(related.length <= 5)
  assert.deepEqual(__test.computeRelated('World/Nations/Missing.md', lookup), [])
  assert.equal(__test.relatedUrlForPagePath('World/Nations/Veil/index.md'), '/wiki/World/Nations/Veil/')
})

test('related: tagged article shows ordered sidebar, self excluded', async () => {
  await withRelatedRewriter(async () => {
    __test.resetRelatedCache()
    const env = relatedTestEnv()
    const html = await (await worker.fetch(relatedArticle('/wiki/World/History/Characters/Aelis/', await secretsToken('member@example.com')), env, {})).text()
    assert.match(html, /<aside class="geor-related">/)
    assert.match(html, /See also/)
    const veil = html.indexOf('/wiki/World/Nations/Veil/')
    const rune = html.indexOf('/wiki/World/History/Events/Rune/')
    const other = html.indexOf('/wiki/World/History/Events/Other/')
    assert.ok(veil > -1 && rune > -1 && other > -1, 'all three relations linked')
    assert.ok(veil < rune && rune < other, 'shared-count desc, then fewer-tags first')
    assert.equal(html.includes('/wiki/World/History/Characters/Aelis/'), false, 'self excluded')
    const aside = html.slice(html.indexOf('<aside class="geor-related">'), html.indexOf('</aside>'))
    assert.ok((aside.match(/<li>/g) || []).length <= 5, 'sidebar capped at five links')
  })
})

test('related: untagged and non-layout pages render no sidebar', async () => {
  await withRelatedRewriter(async () => {
    __test.resetRelatedCache()
    const counter = { tags: 0 }
    const env = relatedTestEnv({ counter })
    const token = await secretsToken('member@example.com')
    const lone = await (await worker.fetch(relatedArticle('/wiki/World/Nations/Lone/', token), env, {})).text()
    assert.doesNotMatch(lone, /geor-related/, 'solo tag with no co-pages renders nothing')
    const untagged = await (await worker.fetch(relatedArticle('/wiki/World/Nations/Untagged/', token), env, {})).text()
    assert.doesNotMatch(untagged, /geor-related/, 'page absent from the index renders nothing')
    const plain = await (await worker.fetch(relatedArticle('/wiki/World/Locations/Cleton%20Island/', token), env, {})).text()
    assert.doesNotMatch(plain, /geor-related/, 'non-layout pages never get a sidebar')
    assert.equal(counter.tags, 1, 'only the first layout page fetched the index')
  })
})

test('related: tags index is cached across requests', async () => {
  await withRelatedRewriter(async () => {
    __test.resetRelatedCache()
    const counter = { tags: 0 }
    const env = relatedTestEnv({ counter })
    const token = await secretsToken('member@example.com')
    const path = '/wiki/World/History/Characters/Aelis/'
    const first = await (await worker.fetch(relatedArticle(path, token), env, {})).text()
    assert.match(first, /geor-related/)
    const second = await (await worker.fetch(relatedArticle(path, token), env, {})).text()
    assert.match(second, /geor-related/)
    assert.equal(counter.tags, 1, 'index fetched once per isolate, then cached')
  })
})

test('related: missing index omits sidebar silently, gating untouched', async () => {
  await withRelatedRewriter(async () => {
    __test.resetRelatedCache()
    const env = relatedTestEnv({ tagStatus: 404 })
    const html = await (await worker.fetch(relatedArticle('/wiki/World/History/Characters/Aelis/', await secretsToken('member@example.com')), env, {})).text()
    assert.equal(html.includes('geor-related'), false, 'no sidebar without index — and no empty box')
    assert.match(html, /archive-compass\.js/, 'archive shell still applied')
    const gated = await worker.fetch(new Request('https://worldofgeor.com/wiki/World/History/Characters/Aelis/'), env, {})
    assert.equal(gated.status, 302, 'logged-out HTML never reaches the transform')
  })
})

// --- Wave B4b: sticky table-of-contents + single progress mechanism ---------
// MkDocs-verified shape: h2/h3 carry id attributes (e.g. Erisian Empire's
// <h2 id="church-state-relations">); id-less headings fall back to slugs.
const TOC_FIXTURE = '<!DOCTYPE html><html><head><title>Empress</title></head><body dir="ltr"><article class="md-content__inner md-typeset"><h1 id="empress">Empress</h1><h2 id="reign">Reign <a class="headerlink" href="#reign">¶</a></h2><p>Text.</p><h3>Customs</h3><p>More.</p><h2 id="reign">Reign repeated</h2></article></body></html>'
const TOC_BARE = '<!DOCTYPE html><html><head><title>Empress</title></head><body dir="ltr"><article class="md-content__inner md-typeset"><h1 id="empress">Empress</h1><p>No subheads.</p></article></body></html>'

function tocTestEnv(html = TOC_FIXTURE) {
  return {
    JWT_SECRET: SECRET,
    ASSETS: { fetch: async request => {
      if (new URL(request.url).pathname === '/wiki/tags-index.json') return new Response('missing', { status: 404 })
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    } },
  }
}
const tocArticle = (path, token) => new Request(`https://worldofgeor.com${path}`, { headers: { Cookie: `geor_token=${token}` } })

test('toc: helpers collect h2/h3 only, reuse ids, slugify + dedupe the rest', () => {
  assert.equal(__test.slugifyHeadingText('Church-State Relations ¶'), 'church-state-relations')
  assert.equal(__test.slugifyHeadingText(''), 'section')
  assert.deepEqual(
    __test.collectTocEntries('<article><h1>Hero</h1><h2 id="x">Title <a href="#x">&para;</a></h2></article>').map(entry => entry.text),
    ['Title'],
    'entity-encoded headerlinks are stripped from TOC text',
  )
  const entries = __test.collectTocEntries(TOC_FIXTURE)
  assert.deepEqual(entries.map(entry => [entry.level, entry.id, entry.text]), [
    [2, 'reign', 'Reign'],
    [3, 'customs', 'Customs'],
    [2, 'reign-2', 'Reign repeated'],
  ])
  assert.equal(entries[1].needsId, true)
  assert.equal(entries[0].needsId, false)
  assert.deepEqual(__test.collectTocEntries(TOC_BARE), [])
  const nav = __test.tocNavHtml(entries)
  assert.match(nav, /<nav class="geor-toc"/)
  assert.match(nav, /<details class="geor-toc-box" open>/)
  assert.match(nav, /href="#reign-2"/)
  assert.doesNotMatch(nav, /empress/)
})

test('toc: layout page with subheads renders nav, stamped ids, highlight script once', async () => {
  await withRelatedRewriter(async () => {
    const html = await (await worker.fetch(tocArticle('/wiki/World/Nations/Empress/', await secretsToken('member@example.com')), tocTestEnv(), {})).text()
    assert.match(html, /<nav class="geor-toc" aria-label="On this page">/)
    assert.match(html, /<a href="#reign">Reign<\/a>/)
    assert.match(html, /<a href="#customs">Customs<\/a>/)
    assert.match(html, /<a href="#reign-2">Reign repeated<\/a>/)
    assert.doesNotMatch(html, /href="#empress"/, 'article h1 is the hero, never TOC')
    assert.match(html, /<h3 id="customs">Customs<\/h3>/, 'id-less headings get slugified ids')
    assert.match(html, /<h2 id="reign-2">Reign repeated<\/h2>/, 'duplicate ids are deduped onto the element')
    assert.equal((html.match(/data-geor-toc/g) || []).length, 1, 'highlight script present exactly once')
    assert.match(html, /IntersectionObserver/, 'section highlighting observes headings')
    assert.match(html, /aria-current/, 'visible section is marked current')
    assert.doesNotMatch(html, /geor-reading-progress/, 'no second progress bar — compass owns it')
  })
})

test('toc: omitted on subhead-less layout pages and on non-layout pages', async () => {
  await withRelatedRewriter(async () => {
    const token = await secretsToken('member@example.com')
    const bare = await (await worker.fetch(tocArticle('/wiki/World/Nations/Empress/', token), tocTestEnv(TOC_BARE), {})).text()
    assert.doesNotMatch(bare, /geor-toc/, 'empty TOC omits silently')
    assert.match(bare, /article-layouts\.css/, 'layout shell still applied')
    const plain = await (await worker.fetch(tocArticle('/wiki/World/Locations/Cleton%20Island/', token), tocTestEnv(), {})).text()
    assert.doesNotMatch(plain, /geor-toc/, 'non-layout pages never get a TOC')
    assert.doesNotMatch(plain, /data-geor-toc/, 'no highlight script off-layout')
    assert.doesNotMatch(plain, /article-layouts\.css/)
  })
})

test('toc: exactly one progress mechanism — compass bar reused, TOC only highlights', () => {
  const compass = readFileSync(new URL('../public/archive-compass.js', import.meta.url), 'utf8')
  assert.match(compass, /geor-reading-progress/, 'compass renders the site-wide reading-progress bar')
  const workerSource = readFileSync(new URL('../worker.js', import.meta.url), 'utf8')
  assert.doesNotMatch(workerSource, /geor-reading-progress/, 'worker never renders a second bar')
  assert.match(workerSource, /TOC_HIGHLIGHT_SCRIPT/, 'worker ships section highlighting instead')
})

test('toc: rebuilt pages drop stale length/encoding validators', async () => {
  await withRelatedRewriter(async () => {
    const staleEnv = {
      JWT_SECRET: SECRET,
      ASSETS: { fetch: async request => {
        if (new URL(request.url).pathname === '/wiki/tags-index.json') return new Response('missing', { status: 404 })
        return new Response(TOC_FIXTURE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': '12', ETag: '"stale"' } })
      } },
    }
    const res = await worker.fetch(tocArticle('/wiki/World/Nations/Empress/', await secretsToken('member@example.com')), staleEnv, {})
    assert.equal(res.headers.get('content-length'), null, 'stale length dropped on rebuild')
    assert.equal(res.headers.get('etag'), null, 'stale etag dropped on rebuild')
    assert.match(await res.text(), /geor-toc/, 'TOC still rendered')
  })
})
