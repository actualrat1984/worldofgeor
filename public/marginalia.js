// Marginalia (Wave E4) — page-anchored notes surfaced inside the reader.
// Pure render helpers are exported so node --test can verify escaping and
// list shaping without a browser. Browser wiring only runs when `document`
// exists and the archive shell marked this an article page (geor-layout-*
// body class, injected by withPrivateArchiveShell alongside this module).
import { escapeHtml } from './timeline.js'

export const MARGINALIA_BODY_MAX = 5000

// One note in the strip: escaped body, optional anchor chip, and a
// provenance line (own note vs. who shared it). Ids are numeric.
export function renderMarginaliaItem(note) {
  const id = Number(note?.id) || 0
  const body = typeof note?.body === 'string' && note.body ? note.body : 'Empty note'
  const anchor = typeof note?.anchor === 'string' && note.anchor ? note.anchor : ''
  const who = note?.mine
    ? 'Your note'
    : (typeof note?.author === 'string' && note.author ? `Shared by ${note.author}` : 'Shared note')
  const sharedBadge = note && !note.mine ? '<span class="geor-marginalia-badge">SHARED</span>' : ''
  return `<li class="geor-marginalia-note" data-note-id="${id}">`
    + `<p class="geor-marginalia-who">${escapeHtml(who)}${sharedBadge}`
    + (anchor ? ` <span class="geor-marginalia-anchor">⚓ ${escapeHtml(anchor)}</span>` : '')
    + `</p><p class="geor-marginalia-body">${escapeHtml(body)}</p></li>`
}

export function renderMarginaliaList(notes) {
  const list = Array.isArray(notes) ? notes : []
  if (!list.length) return '<p class="geor-marginalia-empty">No marginalia yet — leave the first note in the margin.</p>'
  return `<ol class="geor-marginalia-notes">${list.map(renderMarginaliaItem).join('')}</ol>`
}

if (typeof document !== 'undefined' && typeof location !== 'undefined' && typeof fetch !== 'undefined') {
  try {
    const isArticle = [...(document.body?.classList ?? [])].some(name => name.startsWith('geor-layout-'))
    const article = isArticle ? document.querySelector('article') : null
    if (article && !document.querySelector('.geor-marginalia')) initMarginalia(article)
  } catch { /* reader strip is decorative — never break the article */ }
}

function initMarginalia(article) {
  const page = location.pathname
  const initialAnchor = (() => { try { return decodeURIComponent(location.hash.replace(/^#/, '')).slice(0, 200) } catch { return '' } })()
  const section = document.createElement('section')
  section.className = 'geor-marginalia'
  section.setAttribute('aria-label', 'Marginalia')
  section.innerHTML = '<header><p>MARGINALIA</p><h2>Notes in the margin</h2></header>'
    + '<div class="geor-marginalia-list"><p class="geor-marginalia-empty">Unrolling the margin…</p></div>'
    + '<form class="geor-marginalia-form">'
    + `<textarea name="body" rows="2" maxlength="${MARGINALIA_BODY_MAX}" placeholder="Leave a note on this folio…" aria-label="Note text" required></textarea>`
    + '<div class="geor-marginalia-row">'
    + `<input name="anchor" type="text" maxlength="200" placeholder="Anchor (optional)" aria-label="Anchor" value="${initialAnchor.replace(/"/g, '&quot;')}">`
    + '<label class="geor-marginalia-share"><input name="shared" type="checkbox"> Share with members</label>'
    + '<button type="submit">Leave note</button></div>'
    + '<p class="geor-marginalia-status" role="status" hidden></p></form>'
  article.append(section)
  const list = section.querySelector('.geor-marginalia-list')
  const form = section.querySelector('form')
  const status = section.querySelector('.geor-marginalia-status')
  const say = message => { status.hidden = !message; if (message) status.textContent = message }
  const load = async () => {
    try {
      const response = await fetch(`/api/marginalia?page=${encodeURIComponent(page)}`, { credentials: 'same-origin' })
      if (!response.ok) { list.innerHTML = '<p class="geor-marginalia-empty">The margin is unavailable right now.</p>'; return }
      list.innerHTML = renderMarginaliaList((await response.json()).notes)
    } catch { list.innerHTML = '<p class="geor-marginalia-empty">The margin is unavailable right now.</p>' }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const data = new FormData(form)
    const body = String(data.get('body') ?? '').trim()
    if (!body) { say('Write a note before leaving it.'); return }
    say('')
    const button = form.querySelector('button[type="submit"]')
    button.disabled = true
    try {
      const response = await fetch('/api/marginalia', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page,
          anchor: String(data.get('anchor') ?? ''),
          body,
          shared: data.get('shared') === 'on',
        }),
      })
      if (!response.ok) { say(response.status === 401 ? 'Sign in again to leave notes.' : 'The note could not be saved.'); return }
      form.querySelector('textarea').value = ''
      await load()
    } catch { say('The note could not be saved.') } finally { button.disabled = false }
  })
  load()
}
