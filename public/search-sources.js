// Search extra sources (Wave G4) — pure helpers, node-importable, zero
// document access. Scores atlas pins + timeline events with the same
// word-match shape as public/search.js so the browser can merge them.
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

export function scoreExtra(entry, query) {
  if (!entry || typeof entry.title !== 'string' || typeof entry.url !== 'string') return -1
  if (!isExtraUrl(entry.url, entry.kind)) return -1
  const title = entry.title.toLowerCase()
  const path = decodeURIComponent(entry.url).toLowerCase()
  const words = tokens(query)
  if (!words.length) return 0
  const normalized = String(query ?? '').trim().toLowerCase()
  let score = title === normalized ? 1000 : title.startsWith(normalized) ? 600 : title.includes(normalized) ? 350 : 0
  for (const word of words) {
    if (title === word) score += 220
    else if (title.startsWith(word)) score += 140
    else if (title.includes(word)) score += 80
    const haystack = `${title} ${(entry.detail ?? '').toLowerCase()} ${path}`
    if (haystack.includes(word)) score += 25
    else return -1
  }
  // Pins outrank events on ties: exact places beat passing mentions.
  if (entry.kind === 'pin') score += 10
  return score - title.length / 100
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
