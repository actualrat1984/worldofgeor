// Manuscripts @mentions (Wave H11a) — entity autocomplete from the gated
// wiki index plus folio link rendering. Pure helpers are exported so
// node --test can verify gating, matching, insertion, and link safety
// without a browser. Browser wiring only runs when `document` exists.
import { escapeHtml } from './timeline.js'

// The index is a private asset (worker PRIVATE_ASSET_PATHS): anonymous
// fetches are rejected, so this fetch MUST stay same-origin with the
// session cookie — never a public or cross-origin URL.
export const WIKI_INDEX_URL = '/wiki-index.json'
export const MENTION_FETCH_INIT = { credentials: 'same-origin', headers: { Accept: 'application/json' } }
export const MENTION_QUERY_MAX = 60
export const MENTION_SUGGEST_MAX = 8

const MENTION_CHAR = /[A-Za-zÀ-ÖØ-öø-ÿ'’\- ]/

// Mirror of archive-compass safeWikiEntry: only real /wiki/ folios pass,
// so a mention can never link anywhere the archive does not already serve.
export function safeMentionEntry(item) {
  const url = typeof item?.url === 'string' ? item.url : ''
  const title = typeof item?.title === 'string' ? item.title.trim().slice(0, 180) : ''
  if (!title || !url.startsWith('/wiki/') || url.includes('"') || url.includes('<')) return null
  return { title, url }
}

// Gated load: same-origin credentials, JSON accept (anon → worker 401).
// fetchImpl is injectable so tests can assert the gated contract.
export async function loadMentionIndex(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(WIKI_INDEX_URL, { ...MENTION_FETCH_INIT, headers: { ...MENTION_FETCH_INIT.headers } })
  if (!response?.ok) throw new Error('The deeper index is temporarily unavailable')
  const data = await response.json()
  if (!Array.isArray(data)) throw new Error('The deeper index is temporarily unavailable')
  return data.map(safeMentionEntry).filter(Boolean)
}

// Ranked autocomplete: title-prefix first, then substring, capped.
export function matchMentionCandidates(index, query, limit = MENTION_SUGGEST_MAX) {
  const clean = String(query ?? '').trim().toLowerCase()
  if (!clean) return []
  const scored = []
  for (const entry of index ?? []) {
    if (!entry?.title || !entry?.url) continue
    const title = entry.title.toLowerCase()
    if (title.startsWith(clean)) scored.push({ entry, rank: 2 })
    else if (title.includes(clean)) scored.push({ entry, rank: 1 })
  }
  scored.sort((a, b) => b.rank - a.rank || a.entry.title.localeCompare(b.entry.title))
  return scored.slice(0, Math.max(0, limit)).map(item => item.entry)
}

// Find the @query directly before caret: the @ must open the token
// (start of text or whitespace before it), otherwise null — so email
// addresses and mid-word @ signs never trigger the completer.
export function extractMentionQuery(text, caret) {
  const value = String(text ?? '')
  const pos = Math.max(0, Math.min(Number.isFinite(caret) ? caret : value.length, value.length))
  let i = pos
  while (i > 0 && MENTION_CHAR.test(value[i - 1])) i--
  if (i === 0 || value[i - 1] !== '@') return null
  if (i - 2 >= 0 && !/[\s\n([{"']/.test(value[i - 2])) return null
  const query = value.slice(i, pos)
  if (!query.trim() || query.length > MENTION_QUERY_MAX) return null
  return { query, start: i - 1, end: pos }
}

// Replace the live @query with the picked title plus a trailing space.
export function insertMention(text, caret, title) {
  const value = String(text ?? '')
  const clean = String(title ?? '').trim()
  if (!clean) return null
  const token = extractMentionQuery(value, caret)
  if (!token) return null
  const replacement = `@${clean} `
  return { text: value.slice(0, token.start) + replacement + value.slice(token.end), caret: token.start + replacement.length }
}

// Exact (case-insensitive) title → real folio URL. First index entry wins.
export function buildMentionLookup(index) {
  const lookup = new Map()
  for (const entry of index ?? []) {
    if (!entry?.title || !entry?.url) continue
    const key = entry.title.trim().toLowerCase()
    if (key && !lookup.has(key)) lookup.set(key, entry.url)
  }
  return lookup
}

const MENTION_TOKEN = /@([A-Za-zÀ-ÖØ-öø-ÿ'’\- ]{1,60})/g

// Render body text as HTML: @Names that exactly match a real index title
// become links to that folio; unknown names stay plain text — never
// invented links. The token greedily takes following words, then backs off
// to the longest leading run that exactly matches a real title, so
// '@Aelante near the gate' links Aelante and leaves the prose plain.
// Everything is escaped first, so user text cannot inject.
export function linkifyMentions(text, lookup) {
  const value = String(text ?? '')
  const map = lookup instanceof Map ? lookup : new Map()
  let out = ''
  let last = 0
  MENTION_TOKEN.lastIndex = 0
  let match
  while ((match = MENTION_TOKEN.exec(value)) !== null) {
    const full = match[0]
    const body = full.slice(1).replace(/\s+$/, '')
    const tail = full.slice(1 + body.length)
    const words = body.split(/ +/).filter(Boolean)
    let linked = null
    for (let count = words.length; count >= 1; count--) {
      const candidate = words.slice(0, count).join(' ')
      const url = map.get(candidate.toLowerCase())
      if (url) { linked = { candidate, url, rest: body.slice(candidate.length) }; break }
    }
    out += escapeHtml(value.slice(last, match.index))
    if (linked) {
      out += `<a href="${escapeHtml(linked.url)}">@${escapeHtml(linked.candidate)}</a>${escapeHtml(linked.rest + tail)}`
    } else {
      out += escapeHtml(full)
    }
    last = match.index + full.length
  }
  return out + escapeHtml(value.slice(last))
}

export function renderMentionSuggestions(candidates, activeIndex = 0) {
  const list = [...(candidates ?? [])].slice(0, MENTION_SUGGEST_MAX)
  if (!list.length) return ''
  return list.map((entry, index) => `<button type="button" role="option" data-mention-index="${index}" aria-selected="${index === activeIndex ? 'true' : 'false'}"`
    + ` class="w-full text-left px-4 py-2.5 ${index === activeIndex ? 'bg-gold/15' : ''}">`
    + `<span class="block text-sm font-semibold text-cream/90">${escapeHtml(entry.title)}</span>`
    + `<span class="block text-[10px] tracking-widest text-cream/40 mt-0.5">${escapeHtml(decodeURIComponent(entry.url).replace(/^\/wiki\//, '').replace(/\/$/, '').replaceAll('/', ' › '))}</span>`
    + `</button>`).join('')
}

// --- Browser wiring (never runs under node --test) --------------------------

export function initMentionAutocomplete(textarea, options = {}) {
  if (typeof document === 'undefined' || !textarea) return null
  const { onChange = null, max = MENTION_SUGGEST_MAX } = options
  let index = []
  let lookup = new Map()
  let open = false
  let active = 0
  let candidates = []

  const box = document.createElement('div')
  box.className = 'rounded-xl border border-gold/20 bg-ink mt-2 overflow-hidden hidden'
  box.setAttribute('role', 'listbox')
  box.setAttribute('aria-label', 'Folio mentions')
  textarea.insertAdjacentElement('afterend', box)

  const close = () => { open = false; active = 0; candidates = []; box.classList.add('hidden'); box.innerHTML = '' }
  const paint = () => {
    box.innerHTML = renderMentionSuggestions(candidates, active)
    box.classList.toggle('hidden', !open || !candidates.length)
  }
  const pick = title => {
    const result = insertMention(textarea.value, textarea.selectionStart ?? textarea.value.length, title)
    if (!result) { close(); return }
    textarea.value = result.text
    textarea.setSelectionRange(result.caret, result.caret)
    textarea.focus()
    close()
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  }

  box.addEventListener('click', event => {
    const button = event.target.closest('[data-mention-index]')
    if (!button) return
    const entry = candidates[Number(button.dataset.mentionIndex)]
    if (entry) pick(entry.title)
  })
  textarea.addEventListener('input', () => {
    const caret = textarea.selectionStart ?? textarea.value.length
    const token = extractMentionQuery(textarea.value, caret)
    if (!token || !index.length) { close(); onChange?.(lookup); return }
    candidates = matchMentionCandidates(index, token.query, max)
    open = candidates.length > 0
    active = 0
    paint()
    onChange?.(lookup)
  })
  textarea.addEventListener('keydown', event => {
    if (!open || !candidates.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length
      paint()
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      const entry = candidates[active]
      if (entry) { event.preventDefault(); pick(entry.title) }
    } else if (event.key === 'Escape') { close() }
  })
  textarea.addEventListener('blur', () => setTimeout(close, 150))

  loadMentionIndex().then(entries => { index = entries; lookup = buildMentionLookup(entries); onChange?.(lookup) }).catch(() => { index = [] })
  return { close, getLookup: () => lookup }
}

export function paintLinkedFolios(container, text, lookup) {
  if (!container) return
  const html = linkifyMentions(text, lookup)
  const hasLink = html.includes('<a href=')
  container.innerHTML = hasLink ? html : '<span class="text-cream/30">Type @ and a folio name — matches link here.</span>'
}
