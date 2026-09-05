// System Statblocks (Wave F5) — three homebrew templates rendered from
// wiki data: magic ranks, species traits, and currencies. Pure helpers
// are exported so node --test can verify templates, filtering, and the
// ^/wiki/ link gate without a browser. Browser rendering only runs when
// `document` exists.
import { escapeHtml, isWikiUrl } from './timeline.js'

export const STATBLOCK_TEMPLATES = ['magic-ranks', 'species-traits', 'currencies']

export const STATBLOCK_TITLES = {
  'magic-ranks': 'Magic Ranks',
  'species-traits': 'Species Traits',
  'currencies': 'Currencies',
}

// Active template: the requested id when known, else the first template.
export function activeTemplate(template) {
  return STATBLOCK_TEMPLATES.includes(template) ? template : STATBLOCK_TEMPLATES[0]
}

// Entries of one template. Magic ranks keep source (tier) order; other
// templates sort by name. Unknown templates keep nothing.
export function templateEntries(entries, template) {
  const id = activeTemplate(template)
  const kept = [...(entries ?? [])]
    .filter(entry => entry?.template === id && typeof entry?.name === 'string' && entry.name.trim())
  if (id !== 'magic-ranks') kept.sort((a, b) => a.name.localeCompare(b.name))
  return kept
}

// Filter one template's entries: blank query keeps everything,
// otherwise a case-insensitive substring of the name. Unknown keys ignored.
export function filterStatblocks(entries, filters = {}) {
  const list = templateEntries(entries, filters.template)
  const query = typeof filters.query === 'string' ? filters.query.trim().toLowerCase() : ''
  if (!query) return list
  return list.filter(entry => entry.name.toLowerCase().includes(query))
}

// Counts header: "7 blocks · Magic Ranks".
export function statblocksSummary(entries, template) {
  const list = templateEntries(entries, template)
  const blockWord = list.length === 1 ? 'block' : 'blocks'
  return `${list.length} ${blockWord} · ${STATBLOCK_TITLES[activeTemplate(template)]}`
}

// One statblock card: the name (a ^/wiki/ path becomes a link,
// hostile or empty paths render as plain text) over label/value rows.
// Unresolvable rows render as plain text, never invented links.
export function renderStatblockCard(entry) {
  const name = String(entry?.name ?? '')
  const label = escapeHtml(name)
  const head = isWikiUrl(entry?.path)
    ? `<a href="${escapeHtml(entry.path)}" class="text-gold underline decoration-gold/30 underline-offset-4">${label}</a>`
    : label
  const rows = []
  for (const trait of entry?.traits ?? []) {
    const traitLabel = typeof trait?.label === 'string' ? trait.label.trim() : ''
    const value = typeof trait?.value === 'string' ? trait.value.trim() : ''
    if (!traitLabel || !value) continue
    rows.push(`<div class="flex gap-2 text-xs leading-relaxed"><dt class="shrink-0 w-20 text-gold/80 tracking-wide">${escapeHtml(traitLabel)}</dt><dd class="text-cream/70">${escapeHtml(value)}</dd></div>`)
  }
  return `<article class="rounded-xl border border-gold/10 bg-ink/60 p-4" data-statblock="${escapeHtml(name)}">`
    + `<h3 class="font-display text-base leading-snug">${head}</h3>`
    + (rows.length ? `<dl class="mt-3 grid gap-1.5">${rows.join('')}</dl>` : '')
    + `</article>`
}

export function renderStatblocks(entries) {
  const list = [...(entries ?? [])]
  if (!list.length) return '<p class="p-5 text-sm text-cream/40 col-span-full text-center">No blocks match this folio.</p>'
  return list.map(renderStatblockCard).join('')
}

// --- Browser rendering (never runs under node --test) -----------------------
async function initStatblocks() {
  const grid = document.getElementById('statblocksGrid')
  if (!grid) return
  const status = document.getElementById('statblocksStatus')
  const count = document.getElementById('statblocksCount')
  const search = document.getElementById('statblocksSearch')
  const tabs = [...document.querySelectorAll('[data-template]')]
  let template = activeTemplate(tabs.find(tab => tab.getAttribute('aria-pressed') === 'true')?.dataset.template)
  try {
    const response = await fetch('/wiki/statblocks-index.json', { credentials: 'same-origin' })
    if (response.status === 401) {
      location.href = '/?next=' + encodeURIComponent('/statblocks')
      return
    }
    if (!response.ok) throw new Error('The statblock folio could not be opened')
    const data = await response.json()
    const entries = Array.isArray(data?.entries) ? data.entries : []
    const paintTabs = () => {
      for (const tab of tabs) {
        const on = tab.dataset.template === template
        tab.setAttribute('aria-pressed', on ? 'true' : 'false')
        tab.className = 'flex-1 min-w-[160px] rounded-xl border px-4 py-3 text-sm '
          + (on ? 'border-gold/60 bg-gold/10 text-gold font-semibold' : 'border-gold/15 bg-ink text-cream/60')
      }
    }
    const render = () => {
      const kept = filterStatblocks(entries, { template, query: search?.value ?? '' })
      grid.innerHTML = renderStatblocks(kept)
      grid.setAttribute('aria-busy', 'false')
      if (count) count.textContent = statblocksSummary(entries, template)
      if (status) {
        status.textContent = kept.length === templateEntries(entries, template).length
          ? `${statblocksSummary(entries, template)} — every block of the folio`
          : `${kept.length} of ${templateEntries(entries, template).length} blocks match this search`
      }
    }
    for (const tab of tabs) {
      tab.addEventListener('click', () => { template = activeTemplate(tab.dataset.template); paintTabs(); render() })
    }
    search?.addEventListener('input', render)
    paintTabs()
    render()
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : 'The statblock folio could not be opened'
  }
}

if (typeof document !== 'undefined') initStatblocks()
