// Reader's Primer (Wave F2) — spoiler-gated reading lens over the reveals table.
// Pure helpers are exported so node --test can verify the wiki-link gate and
// the revealed/locked rendering without a browser. No secret content ever
// flows through here: only public spoiler ids (already visible on locked
// cards) and article links. Browser rendering only runs when `document` exists.
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

// Lore-leak gate: only same-site wiki article paths may ever become links.
export function isWikiUrl(url) {
  return typeof url === 'string' && url.startsWith('/wiki/')
}

// Curated "what Arcady may know" reading list. Every path is a real wiki page
// (verified by tests/primer.test.mjs against dist/wiki + public/wiki-index.json);
// entries with unknown paths render as plain text, never as links.
// `secret` names the spoiler id gating that topic (authored as data-secret in
// the article, revealed there or globally by the owner). Entries without a
// secret are open reading.
export const PRIMER_READING = Object.freeze([
  { label: 'Aelis', path: '/wiki/World/History/Characters/Aelis/', secret: 'aelis-true-name' },
  { label: 'Agartha', path: '/wiki/World/History/Characters/Agartha/', secret: 'agartha-what-sleeps' },
  { label: 'Aelante', path: '/wiki/World/Locations/Cities/North Erisdar/Aelante/' },
  { label: 'Dates & Timeline', path: '/wiki/World/Dates/' },
  { label: 'Erisian Empire', path: '/wiki/World/Nations/Central Erisdar/Erisian Empire/', secret: 'erisian-throne-secret' },
])

export function primerItemState(item, revealed) {
  if (!item || typeof item.secret !== 'string' || !item.secret) return 'open'
  const set = revealed instanceof Set ? revealed : new Set(revealed ?? [])
  return set.has(item.secret) ? 'revealed' : 'locked'
}

export function summarizePrimer(items, revealed) {
  const list = Array.isArray(items) ? items : []
  let revealedCount = 0
  let lockedCount = 0
  for (const item of list) {
    const state = primerItemState(item, revealed)
    if (state === 'revealed') revealedCount++
    else if (state === 'locked') lockedCount++
  }
  return { total: list.length, revealed: revealedCount, locked: lockedCount }
}

// Render one entry: escaped label, ^/wiki/ links only, lock + article link for
// sealed topics. Secret bytes can never leak here — this function never
// receives any, and not even the spoiler id is emitted.
export function renderPrimerItem(item, revealed) {
  const label = escapeHtml(item?.label || 'Untitled folio')
  const state = primerItemState(item, revealed)
  const linked = isWikiUrl(item?.path)
    ? `<a href="${escapeHtml(item.path)}">${label}</a>`
    : `<span>${label}</span>`
  if (state === 'revealed') return `<li class="primer-item primer-revealed"><span class="primer-mark" aria-hidden="true">✓</span>${linked}<span class="primer-note">Revealed — the seals are broken</span></li>`
  if (state === 'locked') return `<li class="primer-item primer-locked"><span class="primer-mark" aria-hidden="true">🔒</span>${linked}<span class="primer-note">Sealed — open the article to reveal it there</span></li>`
  return `<li class="primer-item primer-open">${linked}<span class="primer-note">Open reading</span></li>`
}

export function renderPrimerList(items, revealed) {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) return '<p class="primer-empty">No folios on the lectern yet.</p>'
  return `<ul class="primer-list">${list.map(item => renderPrimerItem(item, revealed)).join('')}</ul>`
}

// --- Browser rendering (never runs under node --test) -----------------------
async function initPrimer() {
  const list = document.getElementById('primerList')
  const count = document.getElementById('primerCount')
  const status = document.getElementById('primerStatus')
  const setStatus = text => { if (status) status.textContent = text }
  try {
    const response = await fetch('/api/primer', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    if (response.status === 401) {
      if (list) list.innerHTML = '<p class="primer-empty">Sign in to see what Arcady may know.</p>'
      setStatus('The primer is for members of the archive.')
      return
    }
    if (!response.ok) throw new Error(`primer ${response.status}`)
    const data = await response.json()
    const revealed = Array.isArray(data?.revealed) ? data.revealed : []
    const summary = summarizePrimer(PRIMER_READING, revealed)
    if (list) list.innerHTML = renderPrimerList(PRIMER_READING, revealed)
    if (count) count.textContent = summary.total === 0 ? 'No folios yet' : `${summary.revealed} of ${summary.total} folios unsealed`
    setStatus(summary.locked > 0 ? `${summary.locked} sealed — the articles themselves hold the keys.` : 'Every seal on the lectern is broken.')
  } catch {
    if (list) list.innerHTML = '<p class="primer-empty">The primer could not be opened just now.</p>'
    setStatus('The primer is temporarily unavailable.')
  } finally {
    if (list) list.setAttribute('aria-busy', 'false')
  }
}

if (typeof document !== 'undefined') initPrimer()
