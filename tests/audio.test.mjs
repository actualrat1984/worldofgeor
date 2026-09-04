import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import worker, { __test } from '../worker.js'
import { escapeHtml } from '../public/timeline.js'
import {
  AUDIO_NEXT,
  AUDIO_PROGRESS_KEY,
  TRACKS,
  nextIndex,
  prevIndex,
  readProgress,
  renderNowPlaying,
  renderTrackList,
  sanitizeProgress,
  trackIndexOf,
  trackLabel,
  trackSrc,
  writeProgress,
} from '../public/audio.js'

const SECRET = 'test-only-secret-that-is-longer-than-32-characters'

function memoryStore(initial) {
  const data = new Map(Object.entries(initial ?? {}))
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)) },
  }
}

test('audio manifest: 24 real vault chapters, honest files, gated wiki sources', () => {
  assert.equal(TRACKS.length, 24)
  const files = TRACKS.map(track => track.file)
  assert.equal(new Set(files).size, 24, 'no duplicate files')
  for (const [index, track] of TRACKS.entries()) {
    assert.equal(track.n, index + 1, `chapter order ${track.file}`)
    assert.ok(/^\d{2}_[A-Za-z0-9_]+\.mp3$/.test(track.file), `real filename ${track.file}`)
    assert.ok(typeof track.title === 'string' && track.title.length > 0, `titled ${track.file}`)
    const src = trackSrc(track)
    assert.ok(src.startsWith('/wiki/'), `${track.file} served from the gated wiki tree`)
    assert.ok(src.endsWith(`/${track.file}`), `${track.file} src keeps the real filename`)
    assert.ok(!src.includes("'") && !src.includes(' '), `${track.file} src is URL-safe`)
  }
  assert.equal(trackSrc(null), null)
  assert.equal(trackLabel(TRACKS[0]), '01 — The Glorious Alliance')
  assert.equal(trackLabel(TRACKS[9]), '10 — Kirivis, the Hero No One Knew')
  assert.equal(trackIndexOf(TRACKS, '06_The_Great_Divergence.mp3'), 5)
  assert.equal(trackIndexOf(TRACKS, 'nope.mp3'), -1)
  assert.equal(trackIndexOf(null, '01_Glorious_Alliance.mp3'), -1)
})

test('audio queue: next/prev wrap the 24-chapter playlist, garbage resets', () => {
  assert.equal(nextIndex(0, 24), 1)
  assert.equal(nextIndex(23, 24), 0)
  assert.equal(prevIndex(0, 24), 23)
  assert.equal(prevIndex(5, 24), 4)
  assert.equal(nextIndex(-1, 24), 0)
  assert.equal(prevIndex(99, 24), 0)
  assert.equal(nextIndex(0, 0), -1)
  assert.equal(prevIndex(0, -3), -1)
})

test('audio render: track list escapes hostile titles, marks now playing', () => {
  const html = renderTrackList(TRACKS, '01_Glorious_Alliance.mp3')
  assert.match(html, /data-track="01_Glorious_Alliance\.mp3"/)
  assert.match(html, /aria-current="true"/)
  assert.match(html, /NOW PLAYING/)
  assert.match(html, /CHAPTER 2 OF 24/)
  assert.match(html, /The Glorious Alliance/)
  assert.equal(renderTrackList([], null), '<p class="p-5 text-sm text-cream/40">No chapters in the library yet.</p>')
  const hostile = renderTrackList([{ n: 1, file: 'x.mp3', title: '<img src=x onerror=alert(1)>' }], null)
  assert.doesNotMatch(hostile, /<img src=x/)
  assert.match(hostile, /&lt;img/)
  assert.ok(hostile.includes(escapeHtml('<img src=x onerror=alert(1)>')))
  assert.equal(renderNowPlaying(null, -1, 24), 'Choose a chapter below.')
  assert.equal(renderNowPlaying(TRACKS[0], 0, 24), '01 — The Glorious Alliance · chapter 1 of 24')
})

test('audio progress: per-member localStorage round-trips, hostile values rejected', () => {
  const store = memoryStore()
  assert.equal(readProgress(store), null)
  assert.equal(writeProgress(store, '06_The_Great_Divergence.mp3', 123.5), true)
  assert.deepEqual(readProgress(store), { file: '06_The_Great_Divergence.mp3', time: 123.5 })
  assert.equal(writeProgress(store, '../evil.mp3', 10), false)
  assert.equal(writeProgress(store, '06_The_Great_Divergence.mp3', -5), false)
  assert.equal(writeProgress(store, '06_The_Great_Divergence.mp3', Number.NaN), false)
  assert.equal(writeProgress(store, '99_Invented_Chapter.mp3', 10), true, 'writes accept any shape')
  assert.equal(readProgress(store), null, 'reads only accept the real 24-chapter manifest')
  assert.equal(sanitizeProgress(null), null)
  assert.equal(sanitizeProgress({ file: 'a/b.mp3', time: 1 }), null)
  assert.equal(sanitizeProgress({ file: 'x.mp3', time: 99999999 }), null)
  assert.equal(readProgress(memoryStore({ [AUDIO_PROGRESS_KEY]: 'not-json' })), null)
  assert.equal(readProgress(null), null)
  assert.equal(AUDIO_NEXT, '/audio')
})

test('audio gate: worker treats page and script as private', () => {
  assert.equal(__test.isPrivatePath('/audio'), true)
  assert.equal(__test.isPrivatePath('/audio/'), true)
  assert.equal(__test.isPrivatePath('/audio.html'), true)
  assert.equal(__test.isPrivatePath('/audio.js'), true)
})

test('audio gating: anon 302, script 401, authed 200', async () => {
  const html = readFileSync(new URL('../public/audio.html', import.meta.url), 'utf8')
  const env = {
    JWT_SECRET: SECRET,
    ASSETS: { fetch: async request => {
      const pathname = new URL(request.url).pathname
      const body = pathname === '/audio.html' ? html : pathname
      return new Response(body, { headers: { 'Content-Type': pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/json' } })
    } },
  }
  for (const path of ['/audio', '/audio/']) {
    const response = await worker.fetch(new Request(`https://worldofgeor.com${path}`, { headers: { Accept: 'text/html' } }), env, {})
    assert.equal(response.status, 302, path)
    assert.match(response.headers.get('location'), /next=%2Faudio/, path)
    assert.equal(response.headers.get('cache-control'), 'no-store', path)
  }
  const gatedScript = await worker.fetch(new Request('https://worldofgeor.com/audio.js', { headers: { 'Sec-Fetch-Dest': 'script' } }), env, {})
  assert.equal(gatedScript.status, 401)
  const now = Math.floor(Date.now() / 1000)
  const token = await __test.signJwt({ email: 'keeper@example.com', iss: 'worldofgeor', iat: now, exp: now + 60 }, SECRET)
  const authed = await worker.fetch(new Request('https://worldofgeor.com/audio', { headers: { Cookie: `geor_token=${token}`, Accept: 'text/html' } }), env, {})
  assert.equal(authed.status, 200)
  assert.equal(authed.headers.get('cache-control'), 'private, no-store')
  const body = await authed.text()
  assert.match(body, /AUDIO LIBRARY/)
  assert.match(body, /id="player"/)
  assert.match(body, /id="trackList"/)
  assert.match(body, /audio\.js/)
})

test('audio shell mounts the player, queue, and progress while staying noindex', () => {
  const html = readFileSync(new URL('../public/audio.html', import.meta.url), 'utf8')
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive" \/>/)
  assert.match(html, /id="player"/)
  assert.match(html, /id="trackList"/)
  assert.match(html, /id="nowPlaying"/)
  assert.match(html, /id="audioCount"/)
  assert.match(html, /id="audioStatus"/)
  assert.match(html, /id="audioPrev"/)
  assert.match(html, /id="audioNext"/)
  assert.match(html, /src="\/audio\.js"/)
  assert.match(html, /src="\/archive-compass\.js"/)
  const script = readFileSync(new URL('../public/audio.js', import.meta.url), 'utf8')
  assert.match(script, /from '\.\/timeline\.js'/)
  assert.match(script, /escapeHtml/)
  assert.match(script, /\/api\/me/)
  assert.match(script, /next=%2Faudio|next=\$\{encodeURIComponent\(AUDIO_NEXT\)\}|AUDIO_NEXT/)
  assert.match(script, /geor_audio_progress_v1/)
  const workerSource = readFileSync(new URL('../worker.js', import.meta.url), 'utf8')
  assert.match(workerSource, /\['\/audio', '\/audio\.html'\]/)
  assert.match(workerSource, /'\/audio\.js'/)
  const compass = readFileSync(new URL('../public/archive-compass.js', import.meta.url), 'utf8')
  assert.match(compass, /url: '\/audio'/)
  const checkSite = readFileSync(new URL('../scripts/check-site.mjs', import.meta.url), 'utf8')
  assert.match(checkSite, /\['\/audio', '\/audio\.html'\]/)
})
