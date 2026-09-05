// Wave H10 — secrets depth: reveal previews, pin badges, tier matrix.
// Leak-proof throughout: every tier assertion that touches hidden bytes
// asserts their ABSENCE for unauthorized viewers, and badge/index helpers
// are asserted to carry counts only (never content).
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import worker, { __test } from '../worker.js'
import { formatSecretBadge, pinSecretCount, secretCountForUrl } from '../public/atlas-chain.js'

const SECRET = 'test-only-secret-that-is-longer-than-32-characters'
const ALPHA = 'S3CR3T-ALPHA-BYTES-aaa111'
const BETA = 'S3CR3T-BETA-BYTES-bbb222'
const GAMMA = 'S3CR3T-GAMMA-BYTES-ccc333'
const GM = 'GM-ONLY-BYTES-ggg444'
const ALL_BYTES = [ALPHA, BETA, GAMMA, GM]

// Three hidden passages plus one owner-only GM note. Flat divs (no
// nesting) like real MkDocs output; hostile ids are added per-test.
function articleHtml(extraDivs = '') {
  return '<!DOCTYPE html><html><head><title>Veil</title></head><body dir="ltr">' +
    '<article class="md-content__inner md-typeset"><h1 id="veil">Veil</h1>' +
    `<div class="geor-secret" data-secret="alpha-key"><p>${ALPHA}</p></div>` +
    `<div class="geor-secret" data-secret="beta-key"><p>${BETA}</p></div>` +
    `<div class="geor-secret" data-secret="gamma-key"><p>${GAMMA}</p></div>` +
    `<div class="geor-secret-gm"><p>${GM}</p></div>` +
    extraDivs +
    '</article></body></html>'
}

function parseAttrs(tag) {
  const attrs = {}
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
  let m
  while ((m = re.exec(tag))) attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? ''
  return attrs
}

function renderAttrs(attrs) {
  return Object.entries(attrs).map(([k, v]) => ` ${k}="${String(v).replace(/"/g, '&quot;')}"`).join('')
}

// Test double covering every selector the shell registers: head, body,
// article h1 (before + after), and the two secret selectors.
class FakeDepthRewriter {
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
        const attrs = parseAttrs(open[0])
        let tail = ''
        handle({
          getAttribute: name => (name in attrs ? attrs[name] : null),
          setAttribute: (name, value) => { attrs[name] = value },
          append: fragment => { tail += fragment },
        })
        html = `${html.slice(0, open.index)}<body${renderAttrs(attrs)}>${html.slice(open.index + open[0].length)}`
        html = html.replace(/<\/body>/i, `${tail}</body>`)
      } else if (selector === 'article h1') {
        const article = html.match(/<article(\s[^>]*)?>/i)
        if (!article) continue
        const rest = html.slice(article.index)
        const h1 = rest.match(/<h1(\s[^>]*)?>/i)
        if (!h1) continue
        const absolute = article.index + h1.index
        const close = html.indexOf('</h1>', absolute)
        if (close < 0) continue
        const attrs = parseAttrs(h1[0])
        let before = ''
        let after = ''
        handle({
          getAttribute: name => (name in attrs ? attrs[name] : null),
          setAttribute: (name, value) => { attrs[name] = value },
          before: fragment => { before += fragment },
          after: fragment => { after = fragment + after },
        })
        const end = close + '</h1>'.length
        html = `${html.slice(0, absolute)}${before}<h1${renderAttrs(attrs)}>${html.slice(absolute + h1[0].length, end)}${after}${html.slice(end)}`
      } else if (selector === 'div.geor-secret' || selector === 'div.geor-secret-gm') {
        const token = selector === 'div.geor-secret' ? 'geor-secret' : 'geor-secret-gm'
        const matches = [...html.matchAll(/<div(\s[^>]*)?>([\s\S]*?)<\/div>/gi)]
          .filter(m => {
            const classes = (parseAttrs(`<div${m[1] || ''}>`).class || '').split(/\s+/).filter(Boolean)
            return token === 'geor-secret'
              ? classes.includes('geor-secret') && !classes.includes('geor-secret-gm')
              : classes.includes('geor-secret-gm')
          })
        for (let i = matches.length - 1; i >= 0; i--) {
          const m = matches[i]
          const start = m.index
          const end = start + m[0].length
          const attrs = parseAttrs(`<div${m[1] || ''}>`)
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
          const replacement = removed ? '' : keepContent ? inner : `<div${renderAttrs(attrs)}>${inner}</div>`
          html = `${html.slice(0, start)}${before}${replacement}${after}${html.slice(end)}`
        }
      }
    }
    return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}

// Mock D1: reveals + roles + rate limits (mirrors tests/worker.test.mjs).
function makeDepthDb({ roles = {}, seedReveals = [] } = {}) {
  const reveals = new Map(seedReveals.map(([member, id, state]) => [`${member}\0${id}`, state]))
  const limits = new Map()
  return {
    reveals,
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

async function depthToken(email) {
  const now = Math.floor(Date.now() / 1000)
  return __test.signJwt({ email, iss: 'worldofgeor', iat: now, exp: now + 60 }, SECRET)
}

function depthEnv(db, html = articleHtml()) {
  return {
    JWT_SECRET: SECRET,
    DB: db,
    ASSETS: { fetch: async () => new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) },
  }
}

const depthArticle = (token, pathname = '/wiki/World/Nations/Veil/') =>
  new Request(`https://worldofgeor.com${pathname}`, { headers: { Cookie: `geor_token=${token}` } })
const depthPost = (pathname, token, body) => new Request(`https://worldofgeor.com${pathname}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: `geor_token=${token}` } : {}) },
  body: JSON.stringify(body),
})

async function withDepthRewriter(fn) {
  const previous = globalThis.HTMLRewriter
  globalThis.HTMLRewriter = FakeDepthRewriter
  try { await fn() } finally {
    if (previous === undefined) delete globalThis.HTMLRewriter
    else globalThis.HTMLRewriter = previous
  }
}

test('H10: countArticleSecrets is exact and GM-blind', () => {
  assert.deepEqual(__test.countArticleSecrets(articleHtml(), new Set(), false), { total: 3, revealed: 0 })
  assert.deepEqual(
    __test.countArticleSecrets(articleHtml(), new Set(['alpha-key', 'beta-key']), false),
    { total: 3, revealed: 2 },
  )
  // Owner sees every passage; GM notes never inflate the total.
  assert.deepEqual(__test.countArticleSecrets(articleHtml(), new Set(), true), { total: 3, revealed: 3 })
  // Hostile or missing ids still count as passages (they render locked)
  // but can never count as revealed.
  const hostile = articleHtml(
    '<div class="geor-secret" data-secret="Bad_ID!!"><p>x</p></div>' +
    '<div class="geor-secret"><p>y</p></div>',
  )
  assert.deepEqual(
    __test.countArticleSecrets(hostile, new Set(['Bad_ID!!', '']), false),
    { total: 5, revealed: 0 },
  )
  assert.deepEqual(__test.countArticleSecrets(null, null, false), { total: 0, revealed: 0 })
})

test('H10: secretBadgeHtml carries counts, never bytes', () => {
  assert.equal(__test.secretBadgeHtml(3, 1), '<p class="geor-secret-badge">🔒 3 hidden passages (1 revealed)</p>')
  for (const bytes of ALL_BYTES) assert.equal(__test.secretBadgeHtml(3, 1).includes(bytes), false)
})

test('H10: badge counts exact per tier, zero bytes when locked', async () => {
  await withDepthRewriter(async () => {
    const db = makeDepthDb({ roles: { 'member@example.com': 'viewer' } })
    const env = depthEnv(db)
    // Fresh viewer: 3 passages, 0 revealed, zero secret bytes.
    const locked = await (await worker.fetch(depthArticle(await depthToken('member@example.com')), env, {})).text()
    assert.match(locked, /3 hidden passages \(0 revealed\)/)
    for (const bytes of ALL_BYTES) assert.equal(locked.includes(bytes), false)
    // Self-reveal one passage: badge moves to 1, only that body appears.
    const token = await depthToken('member@example.com')
    assert.equal((await worker.fetch(depthPost('/api/secrets/reveal', token, { id: 'beta-key' }), env, {})).status, 200)
    const partial = await (await worker.fetch(depthArticle(token), env, {})).text()
    assert.match(partial, /3 hidden passages \(1 revealed\)/)
    assert.equal(partial.includes(BETA), true)
    assert.equal(partial.includes(ALPHA), false)
    assert.equal(partial.includes(GAMMA), false)
    assert.equal(partial.includes(GM), false)
    // Owner: everything revealed, GM included.
    const owner = await (await worker.fetch(
      depthArticle(await depthToken('owner@example.com'), '/wiki/World/Nations/Veil/'),
      depthEnv(makeDepthDb({ roles: { 'owner@example.com': 'owner' } })), {},
    )).text()
    assert.match(owner, /3 hidden passages \(3 revealed\)/)
    for (const bytes of ALL_BYTES) assert.equal(owner.includes(bytes), true)
  })
})

test('H10: hostile ids fuzz — locked responses carry zero secret bytes', async () => {
  await withDepthRewriter(async () => {
    const hostileDivs =
      '<div class="geor-secret" data-secret=\'x"><script>alert(1)</script>\'><p>inner-a</p></div>' +
      '<div class="geor-secret" data-secret="../evil"><p>inner-b</p></div>' +
      '<div class="geor-secret" data-secret="UPPER CASE"><p>inner-c</p></div>' +
      '<div class="geor-secret" data-secret="__proto__"><p>inner-d</p></div>' +
      `<div class="geor-secret" data-secret="${'k'.repeat(200)}"><p>inner-e</p></div>` +
      '<div class="geor-secret"><p>inner-f</p></div>'
    const html = articleHtml(hostileDivs)
    const env = depthEnv(makeDepthDb({ roles: { 'member@example.com': 'viewer' } }), html)
    const out = await (await worker.fetch(depthArticle(await depthToken('member@example.com')), env, {})).text()
    for (const bytes of ALL_BYTES) assert.equal(out.includes(bytes), false, 'no hidden bytes escape')
    assert.equal(out.includes('alert(1)'), false, 'hostile id never interpolates')
    assert.equal(out.includes('../evil'), false)
    // 3 valid passages + 6 hostile ones all preview as locked counts.
    assert.match(out, /9 hidden passages \(0 revealed\)/)
    // A hostile reveal attempt is rejected, never stored.
    const bad = await worker.fetch(
      depthPost('/api/secrets/reveal', await depthToken('member@example.com'), { id: 'x"><script>' }), env, {})
    assert.equal(bad.status, 400)
  })
})

test('H10: tier matrix — owner / member / global / anon', async () => {
  await withDepthRewriter(async () => {
    const db = makeDepthDb({ roles: { 'member@example.com': 'viewer', 'other@example.com': 'viewer' } })
    const env = depthEnv(db)
    const member = await depthToken('member@example.com')
    const other = await depthToken('other@example.com')
    // Member reveals one for self: visible to self only.
    await worker.fetch(depthPost('/api/secrets/reveal', member, { id: 'alpha-key' }), env, {})
    const mine = await (await worker.fetch(depthArticle(member), env, {})).text()
    assert.equal(mine.includes(ALPHA), true)
    const theirs = await (await worker.fetch(depthArticle(other), env, {})).text()
    assert.equal(theirs.includes(ALPHA), false, 'per-member reveals never cross accounts')
    // Owner reveals globally: every member reads it.
    const admin = await depthToken('ichieisenheart@gmail.com')
    const set = await worker.fetch(depthPost('/api/secrets/set', admin, { id: 'gamma-key', state: 'revealed' }), env, {})
    assert.equal(set.status, 200)
    const global = await (await worker.fetch(depthArticle(other), env, {})).text()
    assert.equal(global.includes(GAMMA), true, 'global reveal opens the passage for all members')
    assert.equal(global.includes(ALPHA), false, 'unrelated passages stay locked')
    // Member global-set attempts are forbidden; anon is gated everywhere.
    assert.equal((await worker.fetch(depthPost('/api/secrets/set', member, { id: 'beta-key', state: 'revealed' }), env, {})).status, 403)
    assert.equal((await worker.fetch(depthPost('/api/secrets/reveal', null, { id: 'beta-key' }), env, {})).status, 401)
    const anon = await worker.fetch(new Request('https://worldofgeor.com/wiki/World/Nations/Veil/'), env, {})
    assert.equal(anon.status, 302)
  })
})

test('H10: pins badge without leaking — counts only, hostile never resolves', () => {
  const index = {
    '/wiki/World/Nations/Dissenbarg/Dissenbarg/': 3,
    '/wiki/World/Nations/Kobre/Kobre/': 1,
    '/evil': 99,
    'javascript:alert(1)': 99,
  }
  assert.equal(secretCountForUrl('/wiki/World/Nations/Dissenbarg/Dissenbarg/', index), 3)
  assert.equal(pinSecretCount({ url: '/wiki/World/Nations/Dissenbarg/Dissenbarg/' }, index), 3)
  assert.equal(pinSecretCount({ url: '/wiki/World/Nations/Kobre/Kobre/' }, index), 1)
  // Hostile pin urls never resolve — even when the index holds such keys.
  for (const bad of ['javascript:alert(1)', 'https://evil.example/wiki/X/', '/evil', '/wiki/../secret', '', null, undefined, 42]) {
    assert.equal(pinSecretCount({ url: bad }, index), 0, String(bad))
    assert.equal(secretCountForUrl(bad, index), 0, String(bad))
  }
  assert.equal(pinSecretCount({}, index), 0)
  assert.equal(pinSecretCount(null, index), 0)
  // Tampered counts fail closed; badge strings are counts-only.
  for (const tampered of ['3', 2.5, -1, NaN, Infinity, [], {}]) {
    assert.equal(secretCountForUrl('/wiki/World/Nations/Dissenbarg/Dissenbarg/', { '/wiki/World/Nations/Dissenbarg/Dissenbarg/': tampered }), 0)
  }
  assert.equal(secretCountForUrl('/wiki/X/', null), 0)
  assert.equal(secretCountForUrl('/wiki/X/', []), 0)
  assert.equal(formatSecretBadge(3), '🔒 3 hidden passages')
  assert.equal(formatSecretBadge(1), '🔒 1 hidden passage')
  assert.equal(formatSecretBadge(0), '')
  for (const bad of [-2, 1.5, '3', null, undefined]) assert.equal(formatSecretBadge(bad), '')
  assert.match(formatSecretBadge(12), /^🔒 12 hidden passages$/)
})

test('H10: generator maps article urls to counts with zero content bytes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'h10-secrets-'))
  const pageA = path.join(tmp, 'A')
  const pageC = path.join(tmp, 'C', 'Sub')
  fs.mkdirSync(pageA, { recursive: true })
  fs.mkdirSync(pageC, { recursive: true })
  const pageABody = `<html><body><div class="geor-secret" data-secret="a1"><p>PAGE-A-HIDDEN-111</p></div>` +
    `<div class='geor-secret' data-secret='a2'><p>PAGE-A-HIDDEN-222</p></div>` +
    `<div class="geor-secret-gm"><p>PAGE-A-GM-333</p></div></body></html>`
  fs.writeFileSync(path.join(pageA, 'index.html'), pageABody)
  fs.mkdirSync(path.join(tmp, 'B'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'B', 'index.html'), '<html><body><p>open lore</p></body></html>')
  fs.writeFileSync(path.join(pageC, 'index.html'),
    `<html><body><div class="geor-secret other" data-secret="c1"><p>PAGE-C-HIDDEN-444</p></div></body></html>`)
  const out = path.join(tmp, 'secrets-index.json')
  const python = process.env.PYTHON || 'python'
  const result = spawnSync(python, [
    path.resolve(import.meta.dirname, '..', 'scripts', 'generate_secrets_index.py'), out, tmp,
  ], { encoding: 'utf-8' })
  assert.equal(result.status, 0, result.stderr)
  const parsed = JSON.parse(fs.readFileSync(out, 'utf-8'))
  assert.deepEqual(parsed, { '/wiki/A/': 2, '/wiki/C/Sub/': 1 })
  const raw = fs.readFileSync(out, 'utf-8')
  for (const bytes of ['PAGE-A-HIDDEN-111', 'PAGE-A-HIDDEN-222', 'PAGE-A-GM-333', 'PAGE-C-HIDDEN-444']) {
    assert.equal(raw.includes(bytes), false, 'index carries counts only')
  }
  fs.rmSync(tmp, { recursive: true, force: true })
})
