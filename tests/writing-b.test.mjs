// Wave H11b: dual-date chapter meta, POV voice, member-authored audio
// transcripts. The dual-date readings must match the calendar page math
// exactly (same converter, copied — never fetched cross-page); chapter meta
// and transcripts persist per member+chapter in device-local keys (the
// server keeps no date/POV/journal fields and audio ships no transcript
// source, so localStorage is the honest store); nothing is ever
// auto-generated and user text is escaped everywhere.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatNotation,
  georianToEarth,
  toSignedYear,
} from '../public/calendar.js'
import {
  CHAPTER_META_STORAGE_LABEL,
  TRANSCRIPT_BODY_MAX,
  TRANSCRIPT_STORAGE_LABEL,
  chapterMetaKey,
  cleanChapterEra,
  cleanPov,
  cleanTranscriptText,
  cleanVoiceTag,
  dualDateParts,
  parseChapterMeta,
  renderChapterMeta,
  renderDualDate,
  renderTranscript,
  serializeChapterMeta,
  transcriptKey,
} from '../public/chapter-meta.js'
import { TRACKS } from '../public/audio.js'

// --- Dual render matches calendar math on sample dates ----------------------
test('dual render matches calendar math on sample dates', () => {
  for (const raw of ['1', '597', '15,000']) {
    const year = Number(raw.replace(/,/g, ''))
    const parts = dualDateParts(raw)
    assert.equal(parts.ok, true, raw)
    assert.equal(parts.bgd, formatNotation(toSignedYear(year, 'BGD')), `${raw} BGD reading`)
    assert.equal(parts.agd, formatNotation(toSignedYear(year, 'AGD')), `${raw} AGD reading`)
    assert.equal(parts.earthYears, georianToEarth(year), `${raw} Earth equivalent`)
    const html = renderDualDate(raw, '')
    assert.match(html, new RegExp(escapeRegExp(parts.bgd)), `${raw} shows BGD`)
    assert.match(html, new RegExp(escapeRegExp(parts.agd)), `${raw} shows AGD`)
    assert.match(html, /data-era="BGD"/)
    assert.match(html, /data-era="AGD"/)
  }
  assert.equal(dualDateParts('597').bgd, '597 BGD')
  assert.equal(dualDateParts('597').agd, '597 AGD')
  // The kept era is marked, never renamed.
  assert.match(renderDualDate('597', 'AGD'), /data-era="AGD" aria-current="true"/)
  assert.match(renderDualDate('597', 'BGD'), /data-era="BGD" aria-current="true"/)
  assert.doesNotMatch(renderDualDate('597', ''), /aria-current/)
  // Garbage reckons nothing — no invented date.
  for (const bad of ['', '   ', 'letters', '-5', '0', '59.7', null, undefined]) {
    assert.equal(dualDateParts(bad).ok, false, String(bad))
    assert.match(renderDualDate(bad, 'AGD'), /data-dual-date="empty"/)
    assert.doesNotMatch(renderDualDate(bad, 'AGD'), /BGD|AGD/)
  }
  assert.equal(cleanChapterEra('bgd'), 'BGD')
  assert.equal(cleanChapterEra('agd'), 'AGD')
  assert.equal(cleanChapterEra('XYZ'), '')
  assert.equal(cleanChapterEra(''), '')
})

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// --- POV persists per chapter + member ---------------------------------------
test('POV voice persists per chapter and per member', () => {
  const chapter = 'Books/Ember/Arrival.md'
  const keyA = chapterMetaKey('mikhail@example.com', chapter)
  const keyB = chapterMetaKey('ichi@example.com', chapter)
  const keyC = chapterMetaKey('mikhail@example.com', 'Books/Ember/Departure.md')
  assert.ok(keyA && keyB && keyC, 'all three keys exist')
  assert.notEqual(keyA, keyB, 'members never share a meta key')
  assert.notEqual(keyA, keyC, 'chapters never share a meta key')
  assert.match(keyA, /^geor:chapter-meta:mikhail@example\.com:/)
  // Member casing folds — the same member always lands on one key.
  assert.equal(chapterMetaKey('Mikhail@Example.com', chapter), keyA)
  assert.equal(chapterMetaKey('', chapter), `geor:chapter-meta:local:${chapter}`)
  // Hostile paths never become keys.
  for (const bad of ['', '   ', '../secret', 'Books/<b>.md', 'Books/"x".md', 'a'.repeat(501), null, undefined]) {
    assert.equal(chapterMetaKey('m@example.com', bad), null, String(bad))
  }
  // Round-trip through a fake device store.
  const store = new Map()
  const meta = { pov: 'Third', voice: 'Old scout, wry', year: '597', era: 'agd' }
  store.set(keyA, serializeChapterMeta(meta))
  const back = parseChapterMeta(store.get(keyA))
  assert.deepEqual(back, { pov: 'third', voice: 'Old scout, wry', year: '597', era: 'AGD' })
  // Other member / chapter slots stay untouched.
  assert.equal(store.get(keyB), undefined)
  assert.equal(store.get(keyC), undefined)
  // Junk parses back to an empty meta — never invented content.
  assert.deepEqual(parseChapterMeta('not json'), { pov: '', voice: '', year: '', era: '' })
  assert.deepEqual(parseChapterMeta(null), { pov: '', voice: '', year: '', era: '' })
  assert.deepEqual(parseChapterMeta(JSON.stringify({ pov: 'fourth', voice: 42, year: 'letters', era: 'XYZ' })), { pov: '', voice: '42', year: '', era: '' })
  // POV vocabulary is closed; voice tags stay short.
  assert.equal(cleanPov('first'), 'first')
  assert.equal(cleanPov('SECOND'), 'second')
  assert.equal(cleanPov('fourth'), '')
  assert.equal(cleanPov(''), '')
  assert.equal(cleanVoiceTag('  Old   scout  '), 'Old scout')
  assert.equal(cleanVoiceTag(''), '')
  assert.equal(cleanVoiceTag(null), '')
  assert.equal(cleanVoiceTag('x'.repeat(81)), null)
  // Device-local labels stay honest.
  assert.match(CHAPTER_META_STORAGE_LABEL, /this device/i)
  assert.match(renderChapterMeta({ pov: '', voice: '', year: '', era: '' }), /No chapter meta yet/)
})

// --- Transcripts persist per chapter + member ---------------------------------
test('transcripts persist per chapter and per member', () => {
  const file = '01_Glorious_Alliance.mp3'
  const keyA = transcriptKey('mikhail@example.com', file)
  const keyB = transcriptKey('ichi@example.com', file)
  const keyC = transcriptKey('mikhail@example.com', '02_The_Shadows_Are_Born.mp3')
  assert.ok(keyA && keyB && keyC)
  assert.notEqual(keyA, keyB, 'members never share a transcript')
  assert.notEqual(keyA, keyC, 'chapters never share a transcript')
  assert.match(keyA, /^geor:transcript:mikhail@example\.com:/)
  // Only real chapter filenames key transcripts — paths and streams cannot.
  for (const bad of ['', 'chapter.txt', '../x.mp3', 'a/b.mp3', 'x\\y.mp3', 'https://evil.example/x.mp3', null, undefined]) {
    assert.equal(transcriptKey('m@example.com', bad), null, String(bad))
  }
  // Round-trip through a fake device store; the cap holds.
  const store = new Map()
  store.set(keyA, 'The alliance held the pass until dawn.')
  assert.equal(cleanTranscriptText(store.get(keyA)), 'The alliance held the pass until dawn.')
  assert.equal(store.get(keyB), undefined)
  assert.equal(cleanTranscriptText(''), '')
  assert.equal(cleanTranscriptText(null), '')
  assert.equal(cleanTranscriptText('x'.repeat(TRANSCRIPT_BODY_MAX)), 'x'.repeat(TRANSCRIPT_BODY_MAX))
  assert.equal(cleanTranscriptText('x'.repeat(TRANSCRIPT_BODY_MAX + 1)), null)
  assert.match(TRANSCRIPT_STORAGE_LABEL, /this device/i)
  assert.match(TRANSCRIPT_STORAGE_LABEL, /never synced to playback/i)
})

// --- No invented transcript text anywhere --------------------------------------
test('no invented transcript text anywhere', () => {
  assert.equal(TRACKS.length, 24, 'the real 24-chapter manifest stands untouched')
  for (const empty of ['', '   ', '\n\t ', null, undefined]) {
    const html = renderTranscript(empty)
    for (const track of TRACKS) {
      assert.doesNotMatch(html, new RegExp(escapeRegExp(track.title)), `empty render invents nothing (${track.title})`)
    }
    assert.doesNotMatch(html, /<audio|<source|data-timing|data-time=/, 'no playback-sync hooks are ever rendered')
    assert.match(html, /nothing is auto-generated/i, 'emptiness is labeled honestly')
  }
  // A kept transcript renders back exactly what the member wrote — nothing more.
  const kept = renderTranscript('Only these words.')
  assert.match(kept, /Only these words\./)
  for (const track of TRACKS) {
    if (track.title === 'Only these words.') continue
    assert.doesNotMatch(kept, new RegExp(escapeRegExp(track.title)))
  }
})

// --- User text is escaped everywhere --------------------------------------------
test('user text is escaped in meta and transcript renders', () => {
  const attack = '<script>alert(1)</script><img src=x onerror=alert(2)>'
  const metaHtml = renderChapterMeta({ pov: 'first', voice: attack, year: '597', era: 'AGD' })
  assert.doesNotMatch(metaHtml, /<script>|<img src=x/)
  assert.match(metaHtml, /&lt;script&gt;/)
  assert.match(metaHtml, /First person/)
  assert.match(metaHtml, /597 AGD/)
  const dualAttack = renderDualDate('<img src=x>', 'AGD"><script>')
  assert.doesNotMatch(dualAttack, /<img src=x|<script>/)
  const tsHtml = renderTranscript(`${attack} & "quoted"`)
  assert.doesNotMatch(tsHtml, /<script>|<img src=x/)
  assert.match(tsHtml, /&lt;script&gt;/)
  assert.match(tsHtml, /&amp;/)
  assert.match(tsHtml, /&quot;/)
  // Round-trip never smuggles markup into keys or stored shape.
  const stored = serializeChapterMeta({ pov: attack, voice: attack, year: attack, era: attack })
  assert.deepEqual(parseChapterMeta(stored), { pov: '', voice: attack.trim().replace(/\s+/g, ' '), year: '', era: '' })
})
