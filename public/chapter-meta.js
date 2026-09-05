// Chapter meta (Wave H11b) — dual-date chapter meta, POV voice, and
// member-authored audio transcripts. Storage note (honest, deliberate):
// manuscripts carry no date/POV/journal fields server-side (only
// body+title+book/chapter plus the additions revision history), and audio
// chapters ship no transcript source at all (24 real MP3s, no timing data).
// Both therefore live in member+chapter-keyed localStorage, clearly labeled
// device-local in the UI. Pure helpers are exported so node --test can
// verify era math, scoping, round-trips, and escaping without a browser.
// Browser wiring only runs when `document` exists (see the init functions).
import { escapeHtml } from './timeline.js'

export const CHAPTER_META_KEY_PREFIX = 'geor:chapter-meta:'
export const TRANSCRIPT_KEY_PREFIX = 'geor:transcript:'
export const CHAPTER_META_STORAGE_LABEL = 'Kept on this device only — per member, per chapter.'
export const TRANSCRIPT_STORAGE_LABEL = 'Member-written, kept on this device only — shown as text, never synced to playback.'
export const TRANSCRIPT_BODY_MAX = 20000
export const VOICE_TAG_MAX = 80
export const POV_CHOICES = Object.freeze(['first', 'second', 'third'])
export const POV_LABELS = Object.freeze({ first: 'First person', second: 'Second person', third: 'Third person' })

// --- Era math: exact copy of the calendar page converter (calendar.js) ----
// Copied deliberately — chapter pages must not fetch the calendar page
// cross-page. Any vault change to the factor belongs in both places.
// Vault truth: BGD/AGD divided at Year 0, Ge'orian x 1.42 = Earth years.
export const EARTH_YEAR_FACTOR = 1.42

export function parseYearNumber(raw) {
  if (typeof raw !== 'string') return null
  const text = raw.trim().replace(/,/g, '')
  if (!/^\d+$/.test(text)) return null
  const year = Number(text)
  if (!Number.isSafeInteger(year) || year < 1) return null
  return year
}

export function toSignedYear(year, era) {
  if (!Number.isSafeInteger(year) || year < 1) return null
  if (era === 'AGD') return year
  if (era === 'BGD') return -year
  return null
}

export function formatNotation(scalar) {
  if (scalar === 0) return 'Year 0'
  if (!Number.isSafeInteger(scalar)) return null
  const abs = Math.abs(scalar).toLocaleString('en-US')
  return scalar > 0 ? `${abs} AGD` : `${abs} BGD`
}

export function georianToEarth(years) {
  if (typeof years !== 'number' || !Number.isFinite(years) || years < 0) return null
  return Math.round(years * (EARTH_YEAR_FACTOR * 100)) / 100
}

// --- Dual-date: one reckoning, both era readings side by side -------------
// A bare year number reads in BOTH eras at once (the member then marks
// which era the chapter keeps). Both readings come straight from the
// calendar math above — never hand-rolled.
export function dualDateParts(rawYear) {
  const year = parseYearNumber(rawYear)
  if (year === null) return { ok: false, error: 'Name a whole year of 1 or more — letters and blank reckonings cannot be reckoned.' }
  return { ok: true, year, bgd: formatNotation(-year), agd: formatNotation(year), earthYears: georianToEarth(year) }
}

export function cleanChapterEra(value) {
  const era = String(value ?? '').trim().toUpperCase()
  return era === 'BGD' || era === 'AGD' ? era : ''
}

export function renderDualDate(rawYear, selectedEra) {
  const parts = dualDateParts(rawYear)
  if (!parts.ok) return '<p class="text-xs text-cream/30" data-dual-date="empty">No Ge\u2019or date set — name a whole year to reckon it in both eras.</p>'
  const era = cleanChapterEra(selectedEra)
  const mark = name => (name === era ? ' aria-current="true" class="text-gold font-semibold"' : ' class="text-cream/70"')
  return `<p class="text-xs leading-relaxed" data-dual-date="${parts.year}">`
    + `<span data-era="BGD"${mark('BGD')}>${escapeHtml(parts.bgd)}</span>`
    + `<span aria-hidden="true" class="text-cream/30"> · </span>`
    + `<span data-era="AGD"${mark('AGD')}>${escapeHtml(parts.agd)}</span>`
    + `<span class="block text-cream/30 mt-1">Some ${escapeHtml(parts.earthYears.toLocaleString('en-US'))} Earth years · ${era ? `kept as ${escapeHtml(era)}` : 'no era kept yet'}</span>`
    + `</p>`
}

// --- POV voice ------------------------------------------------------------
export function cleanPov(value) {
  const pov = String(value ?? '').trim().toLowerCase()
  return POV_CHOICES.includes(pov) ? pov : ''
}

export function cleanVoiceTag(value) {
  if (value == null || value === '') return ''
  const tag = String(value).trim().replace(/\s+/g, ' ')
  if (!tag) return ''
  return tag.length <= VOICE_TAG_MAX ? tag : null
}

export function povLabel(pov) {
  return POV_LABELS[pov] ?? ''
}

// --- Member + chapter scoping ----------------------------------------------
function cleanMember(value) {
  const member = String(value ?? '').trim().toLowerCase()
  return member || 'local'
}

function cleanChapterPath(value) {
  if (typeof value !== 'string') return null
  const path = value.trim()
  if (!path || path.length > 500 || path.includes('..') || /[<>\"']/.test(path)) return null
  return path
}

export function chapterMetaKey(member, chapterPath) {
  const path = cleanChapterPath(chapterPath)
  if (!path) return null
  return `${CHAPTER_META_KEY_PREFIX}${cleanMember(member)}:${path}`
}

// --- Chapter meta round-trip -----------------------------------------------
export function parseChapterMeta(raw) {
  let data = null
  try { data = JSON.parse(String(raw ?? '')) } catch { data = null }
  if (!data || typeof data !== 'object') return { pov: '', voice: '', year: '', era: '' }
  const year = parseYearNumber(typeof data.year === 'string' ? data.year : String(data.year ?? ''))
  return {
    pov: cleanPov(data.pov),
    voice: cleanVoiceTag(data.voice) ?? '',
    year: year === null ? '' : String(year),
    era: cleanChapterEra(data.era),
  }
}

export function serializeChapterMeta(meta) {
  return JSON.stringify({
    pov: cleanPov(meta?.pov),
    voice: cleanVoiceTag(meta?.voice) ?? '',
    year: parseYearNumber(typeof meta?.year === 'string' ? meta.year : String(meta?.year ?? '')) ?? '',
    era: cleanChapterEra(meta?.era),
  })
}

export function renderChapterMeta(meta) {
  const pov = cleanPov(meta?.pov)
  const voice = cleanVoiceTag(meta?.voice) ?? ''
  const parts = dualDateParts(typeof meta?.year === 'string' ? meta.year : String(meta?.year ?? ''))
  const era = cleanChapterEra(meta?.era)
  if (!pov && !voice && !parts.ok) {
    return '<p class="text-xs text-cream/30">No chapter meta yet — voice and date stay with this chapter on this device.</p>'
  }
  let html = '<div class="text-xs leading-relaxed text-cream/60">'
  if (pov) html += `<p>Voice · <span class="text-cream/85">${escapeHtml(povLabel(pov))}</span></p>`
  if (voice) html += `<p>Tag · <span class="text-cream/85">${escapeHtml(voice)}</span></p>`
  if (parts.ok) {
    html += `<p>Date · <span class="text-cream/85">${escapeHtml(era === 'BGD' ? parts.bgd : era === 'AGD' ? parts.agd : `${parts.bgd} · ${parts.agd}`)}</span></p>`
  }
  html += `<p class="text-cream/30 mt-1">${escapeHtml(CHAPTER_META_STORAGE_LABEL)}</p></div>`
  return html
}

// --- Member-authored audio transcripts --------------------------------------
// No timing data exists for any chapter, so transcripts are display-only
// prose: the player never follows the text and the text never follows the
// player. Nothing is ever auto-generated — empty stays empty.
export function cleanTranscriptFile(value) {
  if (typeof value !== 'string') return null
  const file = value.trim()
  if (!file || !file.endsWith('.mp3') || file.includes('/') || file.includes('\\') || file.includes('..')) return null
  return file
}

export function transcriptKey(member, file) {
  const clean = cleanTranscriptFile(file)
  if (!clean) return null
  return `${TRANSCRIPT_KEY_PREFIX}${cleanMember(member)}:${clean}`
}

export function cleanTranscriptText(value) {
  if (value == null || value === '') return ''
  const text = String(value)
  if (!text) return ''
  return text.length <= TRANSCRIPT_BODY_MAX ? text : null
}

export function renderTranscript(text) {
  const body = String(text ?? '')
  if (!body.trim()) {
    return '<p class="text-sm text-cream/40">No transcript yet — members write it here; nothing is auto-generated and playback does not follow the text.</p>'
  }
  return `<div class="text-sm text-cream/80 leading-relaxed whitespace-pre-wrap">${escapeHtml(body)}</div>`
}

// --- Browser wiring (never runs under node --test) --------------------------
export function currentMemberEmail() {
  return fetch('/api/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(response => (response.ok ? response.json() : null))
    .then(data => (typeof data?.email === 'string' && data.email.trim() ? data.email.trim() : 'local'))
    .catch(() => 'local')
}
