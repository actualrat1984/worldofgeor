// Gallery curation (Wave H13) — per-member personal tags and hide-from-my-view
// marks on the read-only character gallery. Storage note (honest, deliberate):
// the gallery index is read-only (no editing, no per-member columns), and
// "tag this character" / "don't show me X" is purely member browsing state, so
// it lives in ONE member-keyed localStorage blob per device — never canon,
// never shared, never synced. Pure helpers are exported so node --test can
// verify scoping, round-trips, partitioning, and escaping without a browser.
// Browser wiring only runs when `document` exists (see initGalleryCuration).
import { escapeHtml } from './timeline.js'
import { currentMemberEmail } from './chapter-meta.js'

export const GALLERY_CURATION_KEY_PREFIX = 'geor:gallery-curation:'
export const CURATION_TAG_MAX = 40
export const CURATION_NAME_MAX = 200
export const CURATION_TAGS_PER_NAME_MAX = 12
export const CURATION_STORAGE_LABEL = 'Your tags & hidden marks — kept on this device only, per member; never the archive.'
export const CURATION_EMPTY_LABEL = 'No personal curation yet — tag or hide characters for your own view.'
export const CURATION_TAG_FILTER_LABEL = 'All my tags'

function cleanMember(value) {
  const member = String(value ?? '').trim().toLowerCase()
  return member || 'local'
}

// A gallery entry name may legitimately contain apostrophes, parentheses,
// em-dashes, and unicode — only HTML-breaking and control characters are out.
export function cleanCurationName(value) {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!name || name.length > CURATION_NAME_MAX) return null
  if (/[<>\u0000-\u001F\u007F]/.test(name)) return null
  return name
}

export function cleanCurationTag(value) {
  if (value == null || value === '') return ''
  const tag = String(value).trim().replace(/\s+/g, ' ')
  return tag.length <= CURATION_TAG_MAX ? tag : ''
}

// One localStorage entry per member — members never read or clobber each
// other's curation.
export function curationKey(member) {
  return `${GALLERY_CURATION_KEY_PREFIX}${cleanMember(member)}`
}

// Parse stored JSON into { tags: { name -> [tag] }, hidden: [name] }.
// Junk rows are dropped; tags dedupe and cap per name.
export function parseCuration(raw) {
  let data = null
  try { data = JSON.parse(String(raw ?? '{}')) } catch { data = null }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { tags: {}, hidden: [] }
  const tags = {}
  if (data.tags && typeof data.tags === 'object' && !Array.isArray(data.tags)) {
    for (const [name, list] of Object.entries(data.tags)) {
      const cleanName = cleanCurationName(name)
      if (!cleanName || !Array.isArray(list)) continue
      const clean = [...new Set(list.map(cleanCurationTag).filter(Boolean))].slice(0, CURATION_TAGS_PER_NAME_MAX)
      if (clean.length) tags[cleanName] = clean
    }
  }
  const hidden = Array.isArray(data.hidden)
    ? [...new Set(data.hidden.map(cleanCurationName).filter(Boolean))]
    : []
  return { tags, hidden }
}

export function serializeCuration(curation) {
  return JSON.stringify({
    tags: curation?.tags ?? {},
    hidden: curation?.hidden ?? [],
  })
}

// Sorted unique tags across the member's curation (for the tag filter select).
export function curationTagValues(curation) {
  const seen = new Set()
  for (const list of Object.values(curation?.tags ?? {})) for (const tag of list ?? []) seen.add(tag)
  return [...seen].sort((a, b) => a.localeCompare(b))
}

// Apply/unapply one tag across a set of names — pure, returns a new object.
export function toggleCurationTags(curation, names, tag) {
  const clean = cleanCurationTag(tag)
  const target = [...new Set((names ?? []).map(cleanCurationName).filter(Boolean))]
  const tags = { ...(curation?.tags ?? {}) }
  if (clean && target.length) {
    for (const name of target) {
      const current = [...(tags[name] ?? [])]
      tags[name] = current.includes(clean) ? current.filter(existing => existing !== clean) : [...current, clean].slice(0, CURATION_TAGS_PER_NAME_MAX)
      if (!tags[name].length) delete tags[name]
    }
  }
  return { tags, hidden: [...(curation?.hidden ?? [])] }
}

// Hide (or reveal) a set of names — reversible by design.
export function hideCurationNames(curation, names, hide = true) {
  const target = new Set((names ?? []).map(cleanCurationName).filter(Boolean))
  const hidden = new Set(curation?.hidden ?? [])
  for (const name of target) (hide ? hidden.add(name) : hidden.delete(name))
  return { tags: { ...(curation?.tags ?? {}) }, hidden: [...hidden] }
}

// Drop tags (and optionally hide flags) from a set of names.
export function clearCurationNames(curation, names, clearHidden = false) {
  const target = new Set((names ?? []).map(cleanCurationName).filter(Boolean))
  const tags = { ...(curation?.tags ?? {}) }
  for (const name of target) delete tags[name]
  let hidden = [...(curation?.hidden ?? [])]
  if (clearHidden) hidden = hidden.filter(name => !target.has(name))
  return { tags, hidden }
}

// Every live entry name — the select-all partition of the archive.
export function selectAllNames(entries) {
  return [...new Set((entries ?? []).map(entry => cleanCurationName(entry?.name)).filter(Boolean))]
}

// Filter entries through the member's curation: hidden entries never show
// (unless includeHidden), and an optional personal tag keeps only entries
// carrying it. Pure — never mutates the input list.
export function applyCurationFilter(entries, curation, filters = {}) {
  const hidden = new Set(curation?.hidden ?? [])
  const tag = typeof filters?.tag === 'string' ? filters.tag.trim() : ''
  const includeHidden = filters?.includeHidden === true
  return (entries ?? []).filter(entry => {
    const name = typeof entry?.name === 'string' ? entry.name.trim() : ''
    if (!name) return false
    if (!includeHidden && hidden.has(name)) return false
    if (tag && !(curation?.tags?.[name] ?? []).includes(tag)) return false
    return true
  })
}

export function renderCurationSummary(curation) {
  const hiddenCount = (curation?.hidden ?? []).length
  const tagRows = curation?.tags ?? {}
  const tagNames = Object.keys(tagRows)
  const tagged = tagNames.reduce((sum, name) => sum + tagRows[name].length, 0)
  if (!hiddenCount && !tagNames.length) return `<p class="text-xs text-cream/40">${escapeHtml(CURATION_EMPTY_LABEL)}</p>`
  const parts = []
  if (tagged) parts.push(`${tagged} tag${tagged === 1 ? '' : 's'} on ${tagNames.length} character${tagNames.length === 1 ? '' : 's'}`)
  if (hiddenCount) parts.push(`${hiddenCount} hidden from your view`)
  return `<p class="text-xs text-cream/50">${escapeHtml(parts.join(' · '))} — ${escapeHtml(CURATION_STORAGE_LABEL)}</p>`
}

// --- Browser wiring (never runs under node --test) --------------------------
export function initGalleryCuration(grid, options = {}) {
  if (typeof document === 'undefined' || !grid) return null
  const toolbar = document.getElementById('galleryCurationToolbar')
  const note = document.getElementById('galleryCurationNote')
  const tagFilter = document.getElementById('galleryTagFilter')
  const showHiddenBox = document.getElementById('galleryShowHidden')
  const onFilterChange = options.onFilterChange || (() => {})
  const liveEntries = Array.isArray(options.entries) ? options.entries : []

  let member = 'local'
  let curation = { tags: {}, hidden: [] }
  const selected = new Set()
  let visibleNames = []

  const key = () => curationKey(member)
  const read = () => { try { return parseCuration(localStorage.getItem(key())) } catch { return { tags: {}, hidden: [] } } }
  const write = () => { try { localStorage.setItem(key(), serializeCuration(curation)) } catch {} }
  const refreshTagFilter = () => {
    if (!tagFilter) return
    const current = tagFilter.value
    tagFilter.innerHTML = ''
    const all = document.createElement('option')
    all.value = ''
    all.textContent = CURATION_TAG_FILTER_LABEL
    tagFilter.appendChild(all)
    for (const tag of curationTagValues(curation)) {
      const option = document.createElement('option')
      option.value = tag
      option.textContent = tag
      tagFilter.appendChild(option)
    }
    tagFilter.value = current && curationTagValues(curation).includes(current) ? current : ''
  }
  const paintSelection = () => {
    if (!toolbar) return
    const count = toolbar.querySelector('[data-curation-selection]')
    if (count) count.textContent = selected.size ? `${selected.size} selected` : 'Nothing selected'
  }
  const refresh = () => {
    write()
    refreshTagFilter()
    if (note) note.innerHTML = renderCurationSummary(curation)
    onFilterChange()
  }

  const decorate = () => {
    if (typeof document === 'undefined') return
    for (const article of grid.querySelectorAll('[data-character]')) {
      const name = article.dataset.character
      const checked = selected.has(name)
      const label = document.createElement('label')
      label.className = 'flex items-center gap-2 shrink-0'
      label.innerHTML = `<input type="checkbox" data-curation-select="${escapeHtml(name)}" ${checked ? 'checked' : ''} aria-label="Select ${escapeHtml(name)} for curation">`
      article.prepend(label)
      const hidden = (curation?.hidden ?? []).includes(name)
      if (hidden) {
        const badge = document.createElement('span')
        badge.className = 'text-[9px] tracking-widest text-cream/40 border border-cream/15 rounded-full px-2 py-0.5 shrink-0'
        badge.textContent = 'HIDDEN FROM YOUR VIEW'
        article.appendChild(badge)
      }
    }
  }

  const setVisible = names => { visibleNames = [...(names ?? [])] }

  if (toolbar) {
    const tagInput = toolbar.querySelector('[data-curation-tag]')
    toolbar.querySelector('[data-curation-select-all]')?.addEventListener('click', () => {
      selected.clear()
      for (const name of visibleNames) selected.add(name)
      paintSelection()
      decorate()
    })
    toolbar.querySelector('[data-curation-clear]')?.addEventListener('click', () => {
      selected.clear()
      paintSelection()
      decorate()
    })
    toolbar.querySelector('[data-curation-hide]')?.addEventListener('click', () => {
      if (!selected.size) { if (note) note.textContent = CURATION_EMPTY_LABEL; return }
      curation = hideCurationNames(curation, [...selected], true)
      selected.clear()
      refresh()
    })
    toolbar.querySelector('[data-curation-unhide]')?.addEventListener('click', () => {
      if (!selected.size) return
      curation = hideCurationNames(curation, [...selected], false)
      selected.clear()
      refresh()
    })
    toolbar.querySelector('[data-curation-clear-tags]')?.addEventListener('click', () => {
      if (!selected.size) return
      curation = clearCurationNames(curation, [...selected], false)
      refresh()
    })
    tagInput?.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      applyTag()
    })
    const applyTag = () => {
      const tag = cleanCurationTag(tagInput?.value ?? '')
      if (!tag) { if (note) note.textContent = 'Name the tag first.'; return }
      const names = selected.size ? [...selected] : visibleNames
      curation = toggleCurationTags(curation, names, tag)
      tagInput.value = ''
      refresh()
    }
    toolbar.querySelector('[data-curation-apply]')?.addEventListener('click', applyTag)
    tagFilter?.addEventListener('change', onFilterChange)
    showHiddenBox?.addEventListener('change', onFilterChange)
    grid.addEventListener('change', event => {
      const box = event.target.closest('[data-curation-select]')
      if (!box) return
      const name = box.dataset.curationSelect
      if (box.checked) selected.add(name)
      else selected.delete(name)
      paintSelection()
    })
  }

  currentMemberEmail().then(email => {
    member = email
    curation = read()
    selected.clear()
    refreshTagFilter()
    if (note) note.innerHTML = renderCurationSummary(curation)
    onFilterChange()
  }).catch(() => {})

  return { getCuration: () => curation, setVisible, decorate, refresh }
}
