// Gazetteer of Nations (Wave C3b) — pure helpers are exported so node --test
// can verify sorting, filtering, and the ^/wiki/ link gate without a browser.
// Browser rendering only runs when `document` exists (see bottom guard).
import { escapeHtml, isWikiUrl } from './timeline.js'

export const GAZETTEER_COLUMNS = Object.freeze(['name', 'region', 'status'])

// Sorted unique region names for the <select> filter. Empty regions omitted.
export function regionsOf(entries) {
  const seen = new Set()
  for (const entry of entries ?? []) {
    const region = typeof entry?.region === 'string' ? entry.region.trim() : ''
    if (region) seen.add(region)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

// Sort a copy of the entries by column (name/region/status), case-insensitive.
// Unknown keys fall back to name; direction is 'asc' or 'desc'.
export function sortGazetteer(entries, key = 'name', dir = 'asc') {
  const column = GAZETTEER_COLUMNS.includes(key) ? key : 'name'
  const sign = dir === 'desc' ? -1 : 1
  return [...(entries ?? [])].sort((a, b) => {
    const left = String(a?.[column] ?? '').toLowerCase()
    const right = String(b?.[column] ?? '').toLowerCase()
    if (left === right) return String(a?.name ?? '').toLowerCase() < String(b?.name ?? '').toLowerCase() ? -1 * sign : 1 * sign
    return (left < right ? -1 : 1) * sign
  })
}

// Filter entries: q matches name/region/status substring (case-insensitive),
// region must equal the entry's region exactly. Empty filters match all.
export function filterGazetteer(entries, { q = '', region = '' } = {}) {
  const query = String(q ?? '').trim().toLowerCase()
  const wantRegion = String(region ?? '')
  return (entries ?? []).filter(entry => {
    if (wantRegion && entry?.region !== wantRegion) return false
    if (!query) return true
    return [entry?.name, entry?.region, entry?.status]
      .some(value => String(value ?? '').toLowerCase().includes(query))
  })
}

// One table row. Names with a ^/wiki/ path become links; hostile or empty
// paths render as plain text — never an off-site href.
export function renderGazetteerRow(entry) {
  const name = String(entry?.name ?? '')
  const region = String(entry?.region ?? '')
  const status = String(entry?.status ?? '')
  const path = typeof entry?.path === 'string' ? entry.path : ''
  const nameCell = isWikiUrl(path)
    ? `<a href="${escapeHtml(path)}">${escapeHtml(name)}</a>`
    : escapeHtml(name)
  return `<tr class="gz-row border-b border-gold/5" data-text="${escapeHtml(`${name} ${region} ${status}`.toLowerCase())}" data-name="${escapeHtml(name)}" data-region="${escapeHtml(region)}"><td class="px-4 py-3">${nameCell}</td><td class="px-4 py-3 text-cream/60">${escapeHtml(region)}</td><td class="px-4 py-3 text-cream/60">${escapeHtml(status)}</td></tr>`
}

// --- Region-nested browsing (H12c) ------------------------------------------
// Nesting = region grouping only (region → entries). The index carries no
// parent/child links, so parents are never invented — regions come from data.

// Exact entry counts per region, sorted by region name. Sums to entries.length.
export function regionCounts(entries) {
  const counts = new Map()
  for (const entry of entries ?? []) {
    const region = typeof entry?.region === 'string' ? entry.region.trim() : ''
    if (!region) continue
    counts.set(region, (counts.get(region) ?? 0) + 1)
  }
  return [...counts].map(([region, count]) => ({ region, count }))
    .sort((a, b) => a.region.localeCompare(b.region))
}

// Entries of one region (exact match). Unknown regions render [] upstream.
export function entriesInRegion(entries, region) {
  const want = String(region ?? '')
  if (!want) return []
  return (entries ?? []).filter(entry => entry?.region === want)
}

// Exact name lookup. Unknown names → undefined (honest empty state upstream).
export function findGazetteerEntry(entries, name) {
  const want = String(name ?? '')
  if (!want) return undefined
  return (entries ?? []).find(entry => entry?.name === want)
}

// Breadcrumbs: All regions › {region} › {entry}. Ancestors are working in-app
// links (data-crumb). The entry segment links to its wiki folio ONLY when its
// path passes isWikiUrl — otherwise plain text. Never invented URLs.
export function renderBreadcrumbs({ view = 'regions', region = '', entry = null } = {}) {
  const root = view === 'regions'
    ? '<span aria-current="page">All regions</span>'
    : '<a href="#" data-crumb="regions">All regions</a>'
  if (view === 'regions') return `<nav aria-label="Breadcrumb" class="gz-crumbs">${root}</nav>`
  const safeRegion = String(region ?? '')
  const regionSeg = (view === 'region' || !entry)
    ? `<span aria-current="page">${escapeHtml(safeRegion)}</span>`
    : `<a href="#" data-crumb="region" data-region="${escapeHtml(safeRegion)}">${escapeHtml(safeRegion)}</a>`
  let html = `<nav aria-label="Breadcrumb" class="gz-crumbs">${root} <span aria-hidden="true">›</span> ${regionSeg}`
  if (view === 'entry' && entry) {
    const name = String(entry?.name ?? '')
    const path = typeof entry?.path === 'string' ? entry.path : ''
    const entrySeg = isWikiUrl(path)
      ? `<a href="${escapeHtml(path)}">${escapeHtml(name)}</a>`
      : `<span aria-current="page">${escapeHtml(name)}</span>`
    html += ` <span aria-hidden="true">›</span> ${entrySeg}`
  }
  return `${html}</nav>`
}

// Region index: one button per region with its exact live count.
// Buttons carry data-region (in-app drill-down), never an href.
export function renderRegionIndex(counts, { q = '' } = {}) {
  const query = String(q ?? '').trim().toLowerCase()
  const rows = (counts ?? []).filter(({ region }) => !query || String(region).toLowerCase().includes(query))
  if (!rows.length) return '<p class="p-5 text-sm text-cream/40">No regions match — the archive holds nothing under that name.</p>'
  return `<ul class="gz-regions">` + rows.map(({ region, count }) =>
    `<li class="border-b border-gold/5"><button type="button" data-region="${escapeHtml(region)}" class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gold/5"><span>${escapeHtml(region)}</span><span class="text-xs text-cream/40">${count} ${count === 1 ? 'nation' : 'nations'}</span></button></li>`
  ).join('') + '</ul>'
}

// Entry detail panel: region, status, tags as escaped chips, plus a
// 'subdivision' badge when tags include 'subdivision'. Folio link only for
// ^/wiki/ paths; falsy entries render an honest empty state.
export function renderEntryDetail(entry) {
  if (!entry || typeof entry?.name !== 'string' || !entry.name) {
    return '<p class="p-5 text-sm text-cream/40">No such entry — the archive holds nothing under that name.</p>'
  }
  const name = String(entry.name)
  const region = String(entry.region ?? '')
  const status = String(entry.status ?? '')
  const path = typeof entry.path === 'string' ? entry.path : ''
  const tags = Array.isArray(entry.tags) ? entry.tags.map(tag => String(tag)) : []
  const isSub = tags.some(tag => tag.toLowerCase() === 'subdivision')
  const chips = tags.map(tag => `<span class="rounded-full border border-gold/20 px-3 py-1 text-xs text-cream/70">${escapeHtml(tag)}</span>`).join('')
  const badge = isSub ? '<span class="rounded-full bg-gold/15 px-3 py-1 text-xs font-semibold text-gold">subdivision</span>' : ''
  const folio = isWikiUrl(path) ? `<a href="${escapeHtml(path)}" class="inline-flex mt-4 border border-gold/25 text-gold rounded-full px-5 py-2 text-xs tracking-widest">OPEN ARCHIVE FOLIO</a>` : ''
  return `<article class="gz-detail rounded-xl border border-gold/10 p-5"><h3 class="font-display text-xl font-bold">${escapeHtml(name)}</h3>` +
    `<p class="mt-2 flex items-center gap-2 flex-wrap">${badge}<span class="text-xs text-cream/40">${escapeHtml(region)}${status ? ` · ${escapeHtml(status)}` : ''}</span></p>` +
    (chips ? `<p class="mt-3 flex items-center gap-2 flex-wrap">${chips}</p>` : '') +
    (folio ? `<p>${folio}</p>` : '') + '</article>'
}

// --- Browser rendering (never runs under node --test) -----------------------
async function initGazetteer() {
  const body = document.getElementById('gazetteerSections')
  const status = document.getElementById('gazetteerStatus')
  const count = document.getElementById('gazetteerCount')
  const filter = document.getElementById('gazetteerFilter')
  const regionSelect = document.getElementById('regionFilter')
  const table = document.getElementById('gazetteerTable')
  if (!body || !table) return
  try {
    const response = await fetch('/wiki/gazetteer-index.json', { credentials: 'same-origin' })
    if (response.status === 401) {
      location.href = '/?next=' + encodeURIComponent('/gazetteer')
      return
    }
    if (!response.ok) throw new Error('The gazetteer index could not be opened')
    const data = await response.json()
    const entries = Array.isArray(data?.entries) ? data.entries : []
    const counts = regionCounts(entries)
    const knownRegions = new Set(counts.map(({ region }) => region))
    let sortKey = 'name'
    let sortDir = 'asc'
    let view = 'regions'
    let activeRegion = ''
    let activeEntry = ''
    const crumbs = document.getElementById('gazetteerCrumbs')
    const regionIndex = document.getElementById('regionIndex')
    const detail = document.getElementById('entryDetail')
    for (const region of regionsOf(entries)) {
      const option = document.createElement('option')
      option.value = region
      option.textContent = region
      regionSelect?.appendChild(option)
    }
    const showRegions = () => { view = 'regions'; activeRegion = ''; activeEntry = ''; if (regionSelect) regionSelect.value = ''; render() }
    const showRegion = (region) => { view = 'region'; activeRegion = String(region ?? ''); activeEntry = ''; if (regionSelect) regionSelect.value = knownRegions.has(activeRegion) ? activeRegion : ''; render() }
    const showEntry = (region, name) => { view = 'entry'; activeRegion = String(region ?? ''); activeEntry = String(name ?? ''); render() }
    const render = () => {
      const query = (filter?.value ?? '').trim()
      const entry = view === 'entry' ? findGazetteerEntry(entries, activeEntry) : null
      if (crumbs) crumbs.innerHTML = renderBreadcrumbs({ view, region: activeRegion, entry })
      if (regionIndex) {
        if (view === 'regions') {
          regionIndex.hidden = false
          regionIndex.innerHTML = renderRegionIndex(counts, { q: query })
        } else regionIndex.hidden = true
      }
      let rows
      let emptyMessage = '<tr><td colspan="3" class="p-5 text-sm text-cream/40">No nations match — the archive holds nothing under that name.</td></tr>'
      if (view === 'regions') {
        rows = filterGazetteer(sortGazetteer(entries, sortKey, sortDir), { q: query, region: '' })
      } else if (!knownRegions.has(activeRegion)) {
        rows = []
        emptyMessage = '<tr><td colspan="3" class="p-5 text-sm text-cream/40">No such region — the archive holds nothing under that name.</td></tr>'
      } else {
        rows = filterGazetteer(sortGazetteer(entriesInRegion(entries, activeRegion), sortKey, sortDir), { q: query, region: '' })
      }
      body.innerHTML = rows.map(renderGazetteerRow).join('') || emptyMessage
      body.setAttribute('aria-busy', 'false')
      if (detail) {
        if (view === 'entry') {
          detail.hidden = false
          detail.innerHTML = renderEntryDetail(entry && (!activeRegion || entry.region === activeRegion) ? entry : undefined)
        } else { detail.hidden = true; detail.innerHTML = '' }
      }
      if (count) count.textContent = `${entries.length} nations · ${counts.length} regions`
      if (status) status.textContent = (query || activeRegion)
        ? `${rows.length} of ${entries.length} nations match`
        : `${entries.length} nations ready`
    }
    table.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => {
      const key = button.dataset.sort
      if (key === sortKey) sortDir = sortDir === 'asc' ? 'desc' : 'asc'
      else { sortKey = key; sortDir = 'asc' }
      render()
    }))
    filter?.addEventListener('input', render)
    regionSelect?.addEventListener('change', () => {
      if (regionSelect.value) showRegion(regionSelect.value)
      else showRegions()
    })
    regionIndex?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-region]')
      if (!button || !regionIndex.contains(button)) return
      showRegion(button.dataset.region ?? '')
    })
    crumbs?.addEventListener('click', (event) => {
      const link = event.target.closest('[data-crumb]')
      if (!link || !crumbs.contains(link)) return
      event.preventDefault()
      if (link.dataset.crumb === 'region') showRegion(link.dataset.region ?? '')
      else showRegions()
    })
    body.addEventListener('click', (event) => {
      if (event.target.closest('a')) return
      const row = event.target.closest('tr.gz-row')
      if (!row || !body.contains(row)) return
      showEntry(row.dataset.region ?? '', row.dataset.name ?? '')
    })
    render()
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : 'The gazetteer could not be opened'
  }
}

if (typeof document !== 'undefined') initGazetteer()
