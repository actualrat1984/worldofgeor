// Character Gallery (Wave D3) — pure helpers are exported so node --test
// can verify filtering, card rendering, and the ^/wiki/ link gate
// without a browser. Browser rendering only runs when `document` exists.
import { escapeHtml, isWikiUrl } from './timeline.js'
import { applyCurationFilter, initGalleryCuration } from './gallery-curation.js'

// A missing or blank status means the character walks the world still.
export function entryStatus(entry) {
  const status = typeof entry?.status === 'string' ? entry.status.trim().toLowerCase() : ''
  return status || 'active'
}

// Sorted unique non-empty values of one field across the entries.
export function distinctValues(entries, key) {
  const seen = new Set()
  for (const entry of entries ?? []) {
    const value = typeof entry?.[key] === 'string' ? entry[key].trim() : ''
    if (value && key === 'status') seen.add(value.toLowerCase())
    else if (value) seen.add(value)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

// Filter the gallery: blank selects keep everything, the text query matches
// a case-insensitive substring of the name. Unknown filter keys are ignored.
export function filterGallery(entries, filters = {}) {
  const list = [...(entries ?? [])]
  const house = typeof filters.house === 'string' ? filters.house.trim() : ''
  const species = typeof filters.species === 'string' ? filters.species.trim() : ''
  const nation = typeof filters.nation === 'string' ? filters.nation.trim() : ''
  const status = typeof filters.status === 'string' ? filters.status.trim().toLowerCase() : ''
  const query = typeof filters.query === 'string' ? filters.query.trim().toLowerCase() : ''
  return list.filter(entry => {
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) return false
    if (house && (entry.house ?? '').trim() !== house) return false
    if (species && (entry.species ?? '').trim() !== species) return false
    if (nation && (entry.nation ?? '').trim() !== nation) return false
    if (status && entryStatus(entry) !== status) return false
    if (query && !entry.name.toLowerCase().includes(query)) return false
    return true
  })
}

// Counts header: "N characters · H houses".
export function gallerySummary(entries) {
  const list = [...(entries ?? [])]
  const houses = new Set()
  for (const entry of list) {
    const house = typeof entry?.house === 'string' ? entry.house.trim() : ''
    if (house) houses.add(house)
  }
  const characterWord = list.length === 1 ? 'character' : 'characters'
  const houseWord = houses.size === 1 ? 'house' : 'houses'
  return `${list.length} ${characterWord} · ${houses.size} ${houseWord}`
}

// One character card: a CSS initial-letter avatar, the name (a ^/wiki/ path
// becomes a link, hostile or empty paths render as plain text), and the
// house / species / nation / status folio line.
export function renderGalleryCard(entry) {
  const name = String(entry?.name ?? '')
  const initial = escapeHtml((name.trim()[0] ?? '·').toUpperCase())
  const label = escapeHtml(name)
  const head = isWikiUrl(entry?.path)
    ? `<a href="${escapeHtml(entry.path)}" class="text-gold underline decoration-gold/30 underline-offset-4">${label}</a>`
    : label
  const meta = []
  for (const [key, value] of [['house', entry?.house], ['species', entry?.species], ['nation', entry?.nation]]) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text) meta.push(`<span>${escapeHtml(text)}</span>`)
  }
  const status = entryStatus(entry)
  if (status !== 'active') meta.push(`<span class="text-cream/40 italic">${escapeHtml(status)}</span>`)
  return `<article class="rounded-xl border border-gold/10 bg-ink/60 p-4 flex items-start gap-3" data-character="${escapeHtml(name)}">`
    + `<span aria-hidden="true" class="font-display text-xl font-bold text-gold flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gold/25 bg-gold/10">${initial}</span>`
    + `<div class="min-w-0"><p class="font-display text-base leading-snug">${head}</p>`
    + (meta.length ? `<p class="mt-1 text-xs text-cream/50 flex flex-wrap gap-x-2 gap-y-0.5">${meta.join('')}</p>` : '')
    + `</div></article>`
}

export function renderGallery(entries) {
  const list = [...(entries ?? [])]
  if (!list.length) return '<p class="p-5 text-sm text-cream/40 col-span-full text-center">No souls match these filters.</p>'
  return list.map(renderGalleryCard).join('')
}

// --- Browser rendering (never runs under node --test) -----------------------
async function initGallery() {
  const grid = document.getElementById('galleryGrid')
  if (!grid) return
  const status = document.getElementById('galleryStatus')
  const count = document.getElementById('galleryCount')
  const houseFilter = document.getElementById('houseFilter')
  const speciesFilter = document.getElementById('speciesFilter')
  const nationFilter = document.getElementById('nationFilter')
  const statusFilter = document.getElementById('statusFilter')
  const search = document.getElementById('gallerySearch')
  const tagFilter = document.getElementById('galleryTagFilter')
  const showHidden = document.getElementById('galleryShowHidden')
  let curationApi = null
  try {
    const response = await fetch('/wiki/gallery-index.json', { credentials: 'same-origin' })
    if (response.status === 401) {
      location.href = '/?next=' + encodeURIComponent('/gallery')
      return
    }
    if (!response.ok) throw new Error('The character gallery index could not be opened')
    const data = await response.json()
    const entries = Array.isArray(data?.entries) ? data.entries : []
    const keyLabel = (select, value) => {
      if (select === statusFilter) return value === 'active' ? 'Active' : value.charAt(0).toUpperCase() + value.slice(1)
      return value
    }
    const fill = (select, values, allLabel) => {
      if (!select) return
      select.innerHTML = ''
      const all = document.createElement('option')
      all.value = ''
      all.textContent = allLabel
      select.appendChild(all)
      for (const value of values) {
        const option = document.createElement('option')
        option.value = value
        option.textContent = keyLabel(select, value)
        select.appendChild(option)
      }
    }
    fill(houseFilter, distinctValues(entries, 'house'), 'All houses')
    fill(speciesFilter, distinctValues(entries, 'species'), 'All species')
    fill(nationFilter, distinctValues(entries, 'nation'), 'All nations')
    const render = () => {
      const curation = curationApi?.getCuration?.() ?? { tags: {}, hidden: [] }
      const base = filterGallery(entries, {
        house: houseFilter?.value ?? '',
        species: speciesFilter?.value ?? '',
        nation: nationFilter?.value ?? '',
        status: statusFilter?.value ?? '',
        query: search?.value ?? '',
      })
      const kept = applyCurationFilter(base, curation, {
        tag: tagFilter?.value ?? '',
        includeHidden: showHidden?.checked ?? false,
      })
      curationApi?.setVisible?.(kept.map(entry => entry.name))
      grid.innerHTML = renderGallery(kept)
      curationApi?.decorate?.()
      grid.setAttribute('aria-busy', 'false')
      if (count) count.textContent = gallerySummary(entries)
      if (status) {
        const curated = (curation?.hidden?.length ?? 0) > 0 || Boolean(tagFilter?.value)
        const suffix = curated ? ' — your curation shapes this view' : ''
        status.textContent = kept.length === entries.length
          ? `${gallerySummary(entries)} — every soul of the archive${suffix}`
          : `${kept.length} of ${entries.length} souls match these filters${suffix}`
      }
    }
    for (const control of [houseFilter, speciesFilter, nationFilter, statusFilter, search]) {
      control?.addEventListener(control === search ? 'input' : 'change', render)
    }
    curationApi = initGalleryCuration(grid, { entries, onFilterChange: render })
    render()
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : 'The character gallery could not be opened'
  }
}

if (typeof document !== 'undefined') initGallery()
