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
  return `<tr class="gz-row border-b border-gold/5" data-text="${escapeHtml(`${name} ${region} ${status}`.toLowerCase())}"><td class="px-4 py-3">${nameCell}</td><td class="px-4 py-3 text-cream/60">${escapeHtml(region)}</td><td class="px-4 py-3 text-cream/60">${escapeHtml(status)}</td></tr>`
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
    let sortKey = 'name'
    let sortDir = 'asc'
    for (const region of regionsOf(entries)) {
      const option = document.createElement('option')
      option.value = region
      option.textContent = region
      regionSelect?.appendChild(option)
    }
    const render = () => {
      const rows = filterGazetteer(sortGazetteer(entries, sortKey, sortDir), {
        q: filter?.value ?? '',
        region: regionSelect?.value ?? '',
      })
      body.innerHTML = rows.map(renderGazetteerRow).join('') ||
        '<tr><td colspan="3" class="p-5 text-sm text-cream/40">No nations match — the archive holds nothing under that name.</td></tr>'
      body.setAttribute('aria-busy', 'false')
      const query = (filter?.value ?? '').trim()
      if (count) count.textContent = `${entries.length} nations · ${regionsOf(entries).length} regions`
      if (status) status.textContent = (query || regionSelect?.value)
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
    regionSelect?.addEventListener('change', render)
    render()
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : 'The gazetteer could not be opened'
  }
}

if (typeof document !== 'undefined') initGazetteer()
