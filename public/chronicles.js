// Chronicles (Wave C2) — timeline scrub drives the atlas.
// Pure join helpers are exported so node --test can verify wikiUrl matching
// and the ^/wiki/ link gate without a browser. Reuses dateToScalar,
// isWikiUrl, buildTitleLookup, resolveWikiUrl, renderEventText, escapeHtml
// from ./timeline.js — never duplicates them.
// Browser rendering only runs when `document` exists (see bottom guard).
import {
  buildTitleLookup,
  dateToScalar,
  escapeHtml,
  isWikiUrl,
  renderEventText,
  resolveWikiUrl,
} from './timeline.js'

// Canonical form for wiki-article comparison: decoded, single slashes,
// no trailing slash, lowercased path. Returns null for anything that is
// not a same-site /wiki/ article path (hostile values never match).
export function normalizeWikiUrl(url) {
  if (typeof url !== 'string') return null
  let text = url.trim()
  if (!text.startsWith('/wiki/')) return null
  try { text = decodeURIComponent(text) } catch { return null }
  if (text.includes('\\') || text.includes('..')) return null
  text = text.replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  if (text === '/wiki') return null
  if (!text.startsWith('/wiki/')) return null
  return text.toLowerCase()
}

// Collect the candidate wiki URLs carried by an event. Supports the
// { wikiUrl } / { wikiUrls } / { url } / { urls } shapes; every candidate
// must pass isWikiUrl or it is dropped (never rendered, never matched).
export function eventCandidateUrls(event) {
  if (!event || typeof event !== 'object') return []
  const raw = []
  for (const key of ['wikiUrls', 'wikiUrl', 'urls', 'url']) {
    const value = event[key]
    if (Array.isArray(value)) raw.push(...value)
    else if (value != null) raw.push(value)
  }
  return raw.filter(candidate => isWikiUrl(candidate))
}

// Resolve the [[wikilink]] fragments inside timeline-index event prose to
// validated ^/wiki/ article URLs. Timeline prose keeps unclosed [[Name
// fragments (see scripts/generate_timeline.py strip_links), so both
// [[Name]] and bare [[Name endings are honored. Unknown names resolve to
// nothing — never invented.
export function eventWikiUrls(event, lookup) {
  if (!event || typeof event.event !== 'string') return []
  if (!(lookup instanceof Map) || lookup.size === 0) return []
  const urls = []
  for (const part of event.event.split('[[').slice(1)) {
    const closeAt = part.indexOf(']]')
    const name = (closeAt >= 0 ? part.slice(0, closeAt) : part).replace(/^\*+/, '').trim()
    if (!name) continue
    const url = resolveWikiUrl(name, lookup)
    if (url && isWikiUrl(url) && !urls.includes(url)) urls.push(url)
  }
  // An event may also carry explicit URLs (see eventCandidateUrls).
  for (const candidate of eventCandidateUrls(event)) {
    if (!urls.includes(candidate)) urls.push(candidate)
  }
  return urls
}

// Join one timeline event to its map feature: normalize wiki URLs
// (trailing slash, path case, %20) before compare; first feature match
// wins; null when the event maps nowhere. Never invents coordinates.
export function matchEventToFeature(event, features) {
  const candidates = new Set()
  const lookup = event && typeof event === 'object' && event.__lookup instanceof Map ? event.__lookup : null
  if (lookup && typeof event.event === 'string') {
    // Timeline-index shape: resolve [[wikilink]] prose through the lookup
    // (eventWikiUrls also folds in any explicit candidate URLs).
    for (const url of eventWikiUrls(event, lookup)) {
      const normalized = normalizeWikiUrl(url)
      if (normalized) candidates.add(normalized)
    }
  }
  for (const url of eventCandidateUrls(event)) {
    const normalized = normalizeWikiUrl(url)
    if (normalized) candidates.add(normalized)
  }
  if (candidates.size === 0) return null
  for (const feature of features ?? []) {
    const wikiUrl = feature && typeof feature === 'object' ? feature.wikiUrl : null
    const normalized = normalizeWikiUrl(wikiUrl)
    if (normalized && candidates.has(normalized)) return feature
  }
  return null
}

// Flatten a /api/maps/:slug document (or its .map envelope) to features,
// tagging each with its source slug. Polygon features score their first
// ring point as the fly-to target; features without a usable point or
// without a ^/wiki/ URL still list, never fly.
export function flattenMapFeatures(payload, fallbackSlug = 'world') {
  const document = payload && typeof payload === 'object' && payload.map && typeof payload.map === 'object'
    ? payload.map
    : payload
  if (!document || typeof document !== 'object' || !Array.isArray(document.layers)) return []
  const slug = typeof document.slug === 'string' && document.slug ? document.slug : fallbackSlug
  const out = []
  for (const layer of document.layers) {
    if (!layer || !Array.isArray(layer.features)) continue
    for (const feature of layer.features) {
      if (!feature || typeof feature !== 'object') continue
      out.push({ ...feature, __slug: slug })
    }
  }
  return out
}

// Pixel-space fly-to target for a feature on the world substrate
// (MAP_DIMENSIONS world 3840x1920, mirrored by the atlas viewer).
// Returns [lat, lng] or null when the feature carries no usable point.
export function featureLatLng(feature) {
  if (!feature || typeof feature !== 'object') return null
  const point = feature.point && typeof feature.point === 'object'
    ? feature.point
    : Array.isArray(feature.points) && feature.points.length > 0 ? feature.points[0] : null
  if (!point || typeof point !== 'object') return null
  const lat = Number(point.lat)
  const lng = Number(point.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return [lat, lng]
}

// --- Browser rendering (never runs under node --test) -----------------------
async function initChronicles() {
  const scrub = document.getElementById('chronScrub')
  const card = document.getElementById('chronCard')
  const status = document.getElementById('chronStatus')
  const count = document.getElementById('chronCount')
  const mapEl = document.getElementById('chronMap')
  const mapStatus = document.getElementById('chronMapStatus')
  const prev = document.getElementById('chronPrev')
  const next = document.getElementById('chronNext')
  const unmappedEl = document.getElementById('chronUnmapped')
  if (!scrub || !card || !mapEl) return
  const setStatus = message => { if (status) status.textContent = message }

  let events = []
  let lookup = new Map()
  let features = []
  let joined = []
  try {
    const [timelineResponse, wikiResponse, mapResponse] = await Promise.all([
      fetch('/wiki/timeline-index.json', { credentials: 'same-origin' }),
      fetch('/wiki-index.json', { credentials: 'same-origin' }),
      fetch('/api/maps/world', { credentials: 'same-origin', headers: { Accept: 'application/json' } }),
    ])
    if (timelineResponse.status === 401 || wikiResponse.status === 401 || mapResponse.status === 401) {
      location.href = '/?next=' + encodeURIComponent('/chronicles')
      return
    }
    if (!timelineResponse.ok) throw new Error('The timeline index could not be opened')
    if (!wikiResponse.ok) throw new Error('The archive index could not be opened')
    const data = await timelineResponse.json()
    const wikiIndex = await wikiResponse.json()
    lookup = buildTitleLookup(Array.isArray(wikiIndex) ? wikiIndex : [])
    events = [...(data.events ?? [])].sort((a, b) => dateToScalar(a.date) - dateToScalar(b.date))
    if (mapResponse.ok) {
      try { features = flattenMapFeatures(await mapResponse.json(), 'world') } catch { features = [] }
    }
    joined = events.map(event => {
      const urls = eventWikiUrls({ ...event, __lookup: lookup }, lookup)
      const feature = matchEventToFeature({ ...event, __lookup: lookup, wikiUrls: urls }, features)
      return { event, urls, feature }
    })
  } catch (error) {
    setStatus('Chronicles unavailable')
    card.innerHTML = `<div class="ch-error" role="alert">${escapeHtml(error instanceof Error ? error.message : 'The chronicles could not be opened')}</div>`
    return
  }

  const mapped = joined.filter(item => item.feature).length
  if (count) count.textContent = `${events.length} events · ${mapped} mapped · ${events.length - mapped} unmapped`
  setStatus(`${events.length} events ready — scrub to walk them`)

  // --- Leaflet map: same substrate as the atlas viewer (CRS.Simple over
  // the 3840x1920 world image, webp with jpg fallback). No second stack.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const WORLD = { w: 3840, h: 1920, url: '/world-map.webp', fallback: '/world-map.jpg' }
  let map = null
  let markers = []
  let overlay = null
  const boundsFor = () => [[0, 0], [WORLD.h, WORLD.w]]
  if (typeof L !== 'undefined') {
    map = L.map(mapEl, { crs: L.CRS.Simple, minZoom: -2, maxZoom: 4, zoomSnap: 0.25, zoomDelta: 0.5, attributionControl: true, keyboard: false, maxBoundsViscosity: 0.7 })
    map.setMaxBounds(boundsFor())
    map.fitBounds(boundsFor(), { padding: [12, 12], animate: false })
    const show = L.imageOverlay(WORLD.url, boundsFor(), { interactive: false, alt: 'World map of Ge\u2019or — political, 597 AGD' })
    let fellBack = false
    show.on('error', () => {
      if (!fellBack) { fellBack = true; show.setUrl(WORLD.fallback) }
      else if (mapStatus) mapStatus.textContent = 'The world image could not be loaded — the event ledger below still walks.'
    })
    overlay = show.addTo(map)
    void overlay
    markers = joined.filter(item => item.feature && featureLatLng(item.feature)).map(item => {
      const marker = L.marker(featureLatLng(item.feature), {
        title: item.event.date || 'dated event',
        alt: item.event.date || 'dated event',
        keyboard: true,
        icon: L.divIcon({ className: 'atlas-marker-shell', html: '<span class="atlas-marker" aria-hidden="true"></span>', iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -12] }),
      }).addTo(map)
      const link = item.urls.find(candidate => isWikiUrl(candidate))
      marker.bindPopup(
        `<div class="atlas-popup"><div class="text-[10px] tracking-[0.22em] text-gold">${escapeHtml(String(item.event.date || 'UNDATED').toUpperCase())}</div>` +
        `<p class="text-xs leading-5 mt-2">${escapeHtml(String(item.event.event || '').slice(0, 220))}</p>` +
        (link ? `<a class="inline-block mt-3" href="${escapeHtml(link)}">Open lore entry →</a>` : '') + '</div>',
        { maxWidth: 280, closeButton: true },
      )
      return { item, marker }
    })
    if (mapStatus) mapStatus.textContent = `World folio loaded with ${markers.length} event pins.`
    window.addEventListener('resize', () => map.invalidateSize(), { passive: true })
  } else {
    mapEl.innerHTML = '<div class="h-full grid place-items-center p-8 text-center"><div><p class="font-display text-sm tracking-widest text-gold">MAP LIBRARY UNAVAILABLE</p><p class="text-sm text-cream/55 mt-2">Reload the chronicles to try the folio again — the event ledger below still walks.</p></div></div>'
    if (mapStatus) mapStatus.textContent = 'The interactive map library could not be loaded.'
  }

  const renderCard = index => {
    const item = joined[index]
    if (!item) return
    const { event, urls, feature } = item
    const target = feature ? featureLatLng(feature) : null
    const loreLink = urls.find(candidate => isWikiUrl(candidate))
    card.innerHTML =
      `<p class="ch-card-date">${escapeHtml(event.date || 'undated')}<span class="tl-era-tag">${escapeHtml(event.era || '')}</span>` +
      (feature
        ? '<span class="ch-badge ch-badge-mapped">◉ mapped</span>'
        : '<span class="ch-badge ch-badge-unmapped">○ unmapped — no map coordinates</span>') + '</p>' +
      `<p class="tl-text">${renderEventText(event.event, lookup)}</p>` +
      (feature && feature.name ? `<p class="ch-card-place">📍 ${escapeHtml(feature.name)}${target ? ` · ${target[0]}, ${target[1]} px` : ''}</p>` : '') +
      (loreLink ? `<a class="ch-card-link" href="${escapeHtml(loreLink)}">Open lore entry →</a>` : '')
    card.dataset.index = String(index)
    const label = `${event.date || 'undated'} — ${String(event.event || '').slice(0, 80)}`
    setStatus(`Event ${index + 1} of ${joined.length}: ${label}${feature ? '' : ' (unmapped)'}`)
    if (map && target) {
      map.flyTo(target, Math.max(map.getZoom(), 0.5), { duration: reduceMotion ? 0 : 0.9 })
      const pin = markers.find(entry => entry.item === item)
      if (pin) pin.marker.openPopup()
    }
    const params = new URLSearchParams(location.search)
    params.set('event', String(index))
    history.replaceState(null, '', `${location.pathname}?${params.toString()}`)
  }

  scrub.min = '0'
  scrub.max = String(Math.max(0, joined.length - 1))
  scrub.step = '1'
  const initial = Number(new URLSearchParams(location.search).get('event'))
  let current = Number.isInteger(initial) && initial >= 0 && initial < joined.length ? initial : 0
  scrub.value = String(current)
  scrub.setAttribute('aria-valuetext', joined[current] ? String(joined[current].event.date || '') : '')
  scrub.addEventListener('input', () => {
    current = Number(scrub.value)
    scrub.setAttribute('aria-valuetext', joined[current] ? String(joined[current].event.date || '') : '')
    renderCard(current)
  })
  prev?.addEventListener('click', () => {
    current = (current - 1 + joined.length) % joined.length
    scrub.value = String(current)
    renderCard(current)
  })
  next?.addEventListener('click', () => {
    current = (current + 1) % joined.length
    scrub.value = String(current)
    renderCard(current)
  })
  document.addEventListener('keydown', event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
    if (event.key === 'ArrowLeft') { event.preventDefault(); prev?.click() }
    else if (event.key === 'ArrowRight') { event.preventDefault(); next?.click() }
  })

  // Unmapped events are listed honestly — never invented coordinates.
  if (unmappedEl) {
    const unmapped = joined.map((item, index) => ({ ...item, index })).filter(item => !item.feature)
    unmappedEl.innerHTML = unmapped.length === 0
      ? '<p class="tl-empty">Every event is mapped — the scrubber flies to each one.</p>'
      : `<p class="ch-unmapped-note">${unmapped.length} of ${joined.length} events carry no map coordinates yet. They walk in the scrubber all the same — the map simply holds its place.</p>` +
        unmapped.map(item =>
          `<button type="button" class="ch-unmapped-row" data-event="${item.index}">` +
          `<span class="ch-unmapped-date">${escapeHtml(item.event.date || 'undated')}</span>` +
          `<span class="ch-unmapped-text">${escapeHtml(String(item.event.event || '').slice(0, 140))}</span></button>`,
        ).join('')
    unmappedEl.querySelectorAll('[data-event]').forEach(button => button.addEventListener('click', () => {
      current = Number(button.dataset.event)
      scrub.value = String(current)
      renderCard(current)
      card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' })
    }))
  }

  renderCard(current)
}

if (typeof document !== 'undefined' && typeof fetch !== 'undefined') {
  initChronicles()
}
