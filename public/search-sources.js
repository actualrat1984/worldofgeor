// Search extra sources (Wave G4) — pure helpers, node-importable, zero
// document access. Scores atlas pins + timeline events with the same
// word-match shape as public/search.js so the browser can merge them.
//
// Wave H8 — typo tolerance lives here so both the wiki scorer
// (scoreEntry) and the pins/events scorer (scoreExtra) share one local,
// dependency-free fuzzy implementation: prefix crumbs first, then
// trigram similarity. No network, no worker, fully offline.
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

export function kindBadge(kind) {
  if (kind === 'pin') return 'PIN'
  if (kind === 'event') return 'EVENT'
  return ''
}

// Lore-leak gate: pins must point at same-site wiki articles, events at /timeline.
export function isExtraUrl(url, kind) {
  if (typeof url !== 'string') return false
  if (kind === 'event') return url === '/timeline'
  return url.startsWith('/wiki/')
}

function tokens(value) { return String(value ?? '').toLowerCase().normalize('NFKD').replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(Boolean) }

// --- Typo tolerance (100% local) -------------------------------------------
// Trigram set for a normalized string. Short strings degrade to the whole
// string so 1–2 character tokens still compare sanely.
export function trigrams(value) {
  const s = String(value ?? '').toLowerCase()
  if (s.length < 3) return new Set([s])
  const out = new Set()
  for (let i = 0; i <= s.length - 3; i++) out.add(s.slice(i, i + 3))
  return out
}

// Dice coefficient over trigram sets: 1 = identical, 0 = nothing shared.
// Transpositions ("grimmle" vs "grimmel") and dropped letters ("grimel"
// vs "grimmel") both stay well above 0.5; unrelated words sit near 0.
export function trigramSimilarity(a, b) {
  const x = String(a ?? '').toLowerCase()
  const y = String(b ?? '').toLowerCase()
  if (!x || !y) return 0
  if (x === y) return 1
  const ax = trigrams(x)
  const by = trigrams(y)
  let shared = 0
  for (const gram of ax) if (by.has(gram)) shared++
  if (!shared) return 0
  return (2 * shared) / (ax.size + by.size)
}

// Best trigram similarity between one query word and a candidate token
// list. Callers check prefix matches first (cheaper + stronger signal)
// and use this as the fuzzy fallback.
export function fuzzyWordScore(word, candidates) {
  const w = String(word ?? '').toLowerCase()
  if (!w || !Array.isArray(candidates) || !candidates.length) return 0
  let best = 0
  for (const raw of candidates) {
    const cand = String(raw ?? '').toLowerCase()
    if (!cand) continue
    if (cand === w) return 1
    const sim = trigramSimilarity(w, cand)
    if (sim > best) best = sim
  }
  return best
}

// Wiki-article scorer shared with public/search.js (single implementation
// so browser ranking and node tests exercise the same code). Exact-token
// scoring is unchanged — fuzzy prefix/trigram points only fill branches
// that previously scored zero, and rescue path misses that previously
// returned -1. Exact queries rank exactly as before, typo'd queries
// degrade gracefully instead of dropping out.
export function scoreEntry(entry, query) {
  if (!entry || typeof entry.title !== 'string' || typeof entry.url !== 'string') return -1
  const title = entry.title.toLowerCase()
  const path = decodeURIComponent(entry.url).toLowerCase()
  const words = tokens(query)
  if (!words.length) return 0
  const normalized = String(query ?? '').trim().toLowerCase()
  let score = title === normalized ? 1000 : title.startsWith(normalized) ? 600 : title.includes(normalized) ? 350 : 0
  const hayTokens = tokens(`${entry.title} ${decodeURIComponent(entry.url)}`)
  for (const word of words) {
    if (title === word) score += 220
    else if (title.startsWith(word)) score += 140
    else if (title.includes(word)) score += 80
    else if (hayTokens.some(tok => tok.startsWith(word))) score += 45
    else {
      const fuzzy = fuzzyWordScore(word, hayTokens)
      if (fuzzy >= 0.3) score += Math.max(6, Math.round(fuzzy * 60))
    }
    if (path.includes(word)) score += 25
    else if (hayTokens.some(tok => tok.startsWith(word) || (tok.length >= 3 && word.length >= 3 && word.startsWith(tok)))) score += 10
    else {
      const fuzzy = fuzzyWordScore(word, hayTokens)
      if (fuzzy >= 0.3) score += Math.max(3, Math.round(fuzzy * 15))
      else return -1
    }
  }
  return score - title.length / 100
}

export function scoreExtra(entry, query) {
  if (!entry || typeof entry.title !== 'string' || typeof entry.url !== 'string') return -1
  if (!isExtraUrl(entry.url, entry.kind)) return -1
  const title = entry.title.toLowerCase()
  const path = decodeURIComponent(entry.url).toLowerCase()
  const words = tokens(query)
  if (!words.length) return 0
  const normalized = String(query ?? '').trim().toLowerCase()
  let score = title === normalized ? 1000 : title.startsWith(normalized) ? 600 : title.includes(normalized) ? 350 : 0
  const hayTokens = tokens(`${entry.title} ${entry.detail ?? ''} ${decodeURIComponent(entry.url)}`)
  for (const word of words) {
    if (title === word) score += 220
    else if (title.startsWith(word)) score += 140
    else if (title.includes(word)) score += 80
    else if (hayTokens.some(tok => tok.startsWith(word))) score += 45
    else {
      const fuzzy = fuzzyWordScore(word, hayTokens)
      if (fuzzy >= 0.3) score += Math.max(6, Math.round(fuzzy * 60))
    }
    const haystack = `${title} ${(entry.detail ?? '').toLowerCase()} ${path}`
    if (haystack.includes(word)) score += 25
    else if (hayTokens.some(tok => tok.startsWith(word) || (tok.length >= 3 && word.length >= 3 && word.startsWith(tok)))) score += 10
    else {
      const fuzzy = fuzzyWordScore(word, hayTokens)
      if (fuzzy >= 0.3) score += Math.max(3, Math.round(fuzzy * 15))
      else return -1
    }
  }
  // Pins outrank events on ties: exact places beat passing mentions.
  if (entry.kind === 'pin') score += 10
  return score - title.length / 100
}

// Closest-title suggestion for the zero-result "Did you mean X?" state.
// Ranks every entry by whole-query trigram similarity blended with the
// best per-word prefix/trigram match, so mangled queries ("Grimmle
// Peninsulla") still resolve to the right folio. Returns null when
// nothing is close enough to suggest honestly.
export function closestTitle(query, entries) {
  const q = String(query ?? '').trim().toLowerCase()
  if (q.length < 2 || !Array.isArray(entries) || !entries.length) return null
  const qWords = tokens(q)
  if (!qWords.length) return null
  let best = null
  let bestScore = -1
  for (const entry of entries) {
    if (!entry || typeof entry.title !== 'string' || typeof entry.url !== 'string') continue
    const title = entry.title.toLowerCase()
    const titleToks = tokens(entry.title)
    let tokBest = 0
    for (const w of qWords) {
      for (const t of titleToks) {
        if (t.startsWith(w) || w.startsWith(t)) {
          if (0.85 > tokBest) tokBest = 0.85
        } else {
          const sim = trigramSimilarity(w, t)
          if (sim > tokBest) tokBest = sim
        }
      }
    }
    const whole = trigramSimilarity(q, title)
    const score = Math.max(whole, tokBest * 0.95) + (title.includes(q) ? 0.1 : 0)
    if (score > bestScore) { bestScore = score; best = entry }
  }
  if (!best || bestScore < 0.25) return null
  return { title: best.title, url: best.url, score: bestScore }
}

// Score extra rows against the query. `index` (wiki entries) is used only to
// drop pins that duplicate a wiki article already in the main index by URL,
// so merged results never show the same article twice.
export function mergeExtra(index, extra, query) {
  const normalized = String(query ?? '').trim().toLowerCase()
  if (normalized.length < 2) return []
  if (!Array.isArray(extra) || !extra.length) return []
  const indexed = new Set((Array.isArray(index) ? index : []).map(item => item?.url).filter(Boolean))
  return extra
    .filter(entry => !(entry && entry.kind === 'pin' && indexed.has(entry.url)))
    .map(entry => ({ ...entry, score: scoreExtra(entry, normalized) }))
    .filter(entry => entry.score >= 0)
    .sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title)))
}
