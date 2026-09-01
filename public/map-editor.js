const KM_PER_PIXEL = 3.086
const MAPS = {
  world: { slug: 'world', title: 'World Atlas', width: 3840, height: 1920, image: '/world-map.webp', fallback: '/world-map.jpg' },
  grimmel: { slug: 'grimmel', title: 'Grimmel Peninsula', width: 3840, height: 5715, image: '/grimmel-peninsula.webp', fallback: '/grimmel-peninsula.jpg' },
}
const SYMBOLS = { keep: '♜', city: '◆', port: '⚓', ruin: '⌂', star: '✦' }
const DEFAULT_LAYERS = [
  { id: 'political', name: 'Political', visible: true, locked: false, features: [] },
  { id: 'terrain', name: 'Terrain', visible: true, locked: false, features: [] },
  { id: 'culture', name: 'Culture', visible: true, locked: false, features: [] },
]
const $ = selector => document.querySelector(selector)
const $$ = selector => [...document.querySelectorAll(selector)]
const clone = value => JSON.parse(JSON.stringify(value))
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const idFor = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}`
const snapped = latlng => ({ lat: Math.round(latlng.lat), lng: Math.round(latlng.lng) })
const defaultDocument = slug => ({ version: 1, slug, title: MAPS[slug].title, layers: clone(DEFAULT_LAYERS) })

let state = defaultDocument('world')
let activeLayerId = 'political'
let selectedFeatureId = null
let selectedTool = 'select'
let dirty = false
let history = []
let historyIndex = -1
let rendered = new Map()
let overlay = null
let drawingPoints = []
let drawingPreview = null
let toastTimer = null
let wikiIndex = null

const currentConfig = () => MAPS[state.slug]
const activeLayer = () => state.layers.find(layer => layer.id === activeLayerId) || state.layers[0]
function locateFeature(id) {
  for (const layer of state.layers) {
    const index = layer.features.findIndex(feature => feature.id === id)
    if (index >= 0) return { layer, feature: layer.features[index], index }
  }
  return null
}
function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('is-visible')
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2400)
}
function setSaveState(message, tone = '') {
  const el = $('#saveState'); el.textContent = message
  el.style.color = tone === 'error' ? '#efaaa3' : tone === 'saved' ? '#d9b77a' : ''
}
function snapshot(markDirty = true) {
  const encoded = JSON.stringify(state)
  if (history[historyIndex] === encoded) return
  history = history.slice(0, historyIndex + 1); history.push(encoded)
  if (history.length > 60) history.shift()
  historyIndex = history.length - 1; dirty = markDirty; updateHistoryButtons()
  if (dirty) setSaveState('Unsaved changes')
}
function restoreHistory(index) {
  if (index < 0 || index >= history.length) return
  historyIndex = index; state = JSON.parse(history[index]); selectedFeatureId = null; dirty = true
  activeLayerId = state.layers.some(layer => layer.id === activeLayerId) ? activeLayerId : state.layers[0].id
  $('#documentTitle').value = state.title; loadBaseMap(false); renderAll(); updateHistoryButtons(); setSaveState('Unsaved changes')
}
function updateHistoryButtons() { $('#undoBtn').disabled = historyIndex <= 0; $('#redoBtn').disabled = historyIndex >= history.length - 1 }
function commit(message) { snapshot(true); renderAll(); if (message) toast(message) }

const L = globalThis.L
if (!L) {
  setSaveState('Map library unavailable — reload to try again', 'error')
  $('#loadingVeil').innerHTML = '<p>Atlas map library unavailable. Reload this private workroom to try again.</p>'
  $('.studio-shell').setAttribute('aria-busy', 'false')
  throw new Error('Leaflet unavailable')
}
const map = L.map('editorMap', { crs: L.CRS.Simple, minZoom: -2, maxZoom: 4, zoomSnap: .25, zoomDelta: .5, attributionControl: false, doubleClickZoom: false, maxBoundsViscosity: .8 })
L.control.zoom({ position: 'bottomleft' }).addTo(map)
function bounds() { const cfg = currentConfig(); return [[0, 0], [cfg.height, cfg.width]] }
function loadBaseMap(fit = true) {
  const cfg = currentConfig()
  if (overlay) map.removeLayer(overlay)
  map.setMaxBounds(bounds())
  overlay = L.imageOverlay(cfg.image, bounds(), { alt: `${cfg.title} base map`, interactive: false })
  let retried = false
  overlay.on('error', () => { if (!retried) { retried = true; overlay.setUrl(cfg.fallback) } else setSaveState('Base map image unavailable', 'error') }).addTo(map)
  if (fit) map.fitBounds(bounds(), { padding: [12, 12], animate: false })
  $$('.map-choice').forEach(button => { const on = button.dataset.map === state.slug; button.classList.toggle('is-active', on); button.setAttribute('aria-pressed', String(on)) })
}
function clearRendered() { rendered.forEach(layer => map.removeLayer(layer)); rendered.clear() }
function markerIcon(feature) {
  if (feature.type === 'label') return L.divIcon({ className: 'atlas-label', html: `<span style="--label-color:${feature.color}">${escapeHtml(feature.name || 'New label')}</span>`, iconAnchor: [0, 9] })
  return L.divIcon({ className: 'atlas-symbol', html: `<span style="--symbol-color:${feature.color}"><b>${SYMBOLS[feature.icon] || '•'}</b></span>`, iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16] })
}
function popupHtml(feature) {
  const link = feature.wikiUrl ? `<a href="${escapeHtml(feature.wikiUrl)}">Open lore entry →</a>` : ''
  return `<div class="map-popup"><h3>${escapeHtml(feature.name || 'Unnamed feature')}</h3>${feature.note ? `<p>${escapeHtml(feature.note)}</p>` : ''}${link}</div>`
}
function renderFeatures() {
  clearRendered()
  for (const semanticLayer of state.layers) {
    if (!semanticLayer.visible) continue
    for (const feature of semanticLayer.features) {
      let leafletLayer
      if (feature.type === 'polygon') {
        leafletLayer = L.polygon(feature.points.map(point => [point.lat, point.lng]), { color: feature.color, weight: selectedFeatureId === feature.id ? 3 : 1.5, fillColor: feature.color, fillOpacity: selectedFeatureId === feature.id ? .25 : .14, interactive: !semanticLayer.locked })
      } else {
        leafletLayer = L.marker([feature.point.lat, feature.point.lng], { icon: markerIcon(feature), draggable: !semanticLayer.locked, keyboard: true, title: feature.name || feature.type })
        leafletLayer.on('dragend', event => { feature.point = snapped(event.target.getLatLng()); snapshot(true); renderAll(); toast('Position snapped to the atlas scale') })
      }
      leafletLayer.addTo(map)
      if (!semanticLayer.locked) leafletLayer.on('click', event => { L.DomEvent.stopPropagation(event); selectFeature(feature.id) })
      leafletLayer.bindPopup(popupHtml(feature), { maxWidth: 260 }); rendered.set(feature.id, leafletLayer)
    }
  }
}
function renderLayers() {
  const list = $('#layerList')
  list.innerHTML = state.layers.map(layer => `<div class="layer-row${layer.id === activeLayerId ? ' is-active' : ''}" draggable="true" data-layer-id="${escapeHtml(layer.id)}"><button type="button" class="layer-visibility" data-action="visibility" aria-label="${layer.visible ? 'Hide' : 'Show'} ${escapeHtml(layer.name)}">${layer.visible ? '◉' : '○'}</button><button type="button" class="layer-name" data-action="activate" aria-label="Activate ${escapeHtml(layer.name)} layer. Use Alt plus Arrow Up or Arrow Down to reorder.">${escapeHtml(layer.name)}<span class="layer-meta">${layer.features.length} feature${layer.features.length === 1 ? '' : 's'}</span></button><button type="button" class="layer-lock" data-action="lock" aria-label="${layer.locked ? 'Unlock' : 'Lock'} ${escapeHtml(layer.name)}">${layer.locked ? '◆' : '◇'}</button></div>`).join('')
  list.querySelectorAll('.layer-row').forEach(row => {
    row.addEventListener('click', event => {
      const layer = state.layers.find(item => item.id === row.dataset.layerId); if (!layer) return
      const action = event.target.closest('button')?.dataset.action
      if (action === 'visibility') { layer.visible = !layer.visible; commit(`${layer.name} ${layer.visible ? 'shown' : 'hidden'}`) }
      else if (action === 'lock') { layer.locked = !layer.locked; commit(`${layer.name} ${layer.locked ? 'locked' : 'unlocked'}`) }
      else { activeLayerId = layer.id; renderLayers(); renderInspector() }
    })
    row.addEventListener('dragstart', event => { row.classList.add('is-dragging'); event.dataTransfer.setData('text/plain', row.dataset.layerId) })
    row.addEventListener('dragend', () => row.classList.remove('is-dragging'))
    row.addEventListener('dragover', event => event.preventDefault())
    row.addEventListener('drop', event => {
      event.preventDefault(); const from = state.layers.findIndex(item => item.id === event.dataTransfer.getData('text/plain')); const to = state.layers.findIndex(item => item.id === row.dataset.layerId)
      if (from < 0 || to < 0 || from === to) return
      const [moved] = state.layers.splice(from, 1); state.layers.splice(to, 0, moved); commit('Layer order changed')
    })
    row.querySelector('.layer-name').addEventListener('keydown', event => {
      if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
      const from = state.layers.findIndex(item => item.id === row.dataset.layerId)
      const to = event.key === 'ArrowUp' ? from - 1 : from + 1
      if (from < 0 || to < 0 || to >= state.layers.length) return
      event.preventDefault()
      const [moved] = state.layers.splice(from, 1); state.layers.splice(to, 0, moved); commit('Layer order changed')
      requestAnimationFrame(() => list.querySelector(`[data-layer-id="${CSS.escape(moved.id)}"] .layer-name`)?.focus())
    })
  })
}
function renderInspector() {
  const found = locateFeature(selectedFeatureId); $('#emptyInspector').hidden = Boolean(found); $('#featureForm').hidden = !found
  if (!found) return
  const { layer, feature } = found
  $('#featureType').value = feature.type.toUpperCase()
  $('#featureLayer').innerHTML = state.layers.map(item => `<option value="${escapeHtml(item.id)}"${item.id === layer.id ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')
  $('#featureName').value = feature.name; $('#featureWiki').value = feature.wikiUrl; $('#featureNote').value = feature.note; $('#featureColor').value = feature.color; $('#featureIcon').value = feature.icon || 'keep'
  $('#featureIconWrap').hidden = feature.type === 'polygon' || feature.type === 'label'
  for (const id of ['featureLayer', 'featureName', 'featureWiki', 'featureNote', 'featureColor', 'featureIcon', 'deleteFeatureBtn']) $(`#${id}`).disabled = layer.locked
  $('#featureForm').setAttribute('aria-disabled', String(layer.locked))
  const point = feature.point || feature.points[0]
  $('#featureCoordinates').textContent = feature.type === 'polygon' ? `${feature.points.length} vertices` : `X ${point.lng} • Y ${point.lat} • ${Math.round(point.lng * KM_PER_PIXEL).toLocaleString()} km E`
  const link = $('#openWikiBtn'); link.href = feature.wikiUrl || '/wiki/'; link.classList.toggle('is-disabled', !feature.wikiUrl)
}
function renderAll() { renderFeatures(); renderLayers(); renderInspector() }
function selectFeature(id) { selectedFeatureId = id; const found = locateFeature(id); if (found) activeLayerId = found.layer.id; selectTool('select'); renderAll(); rendered.get(id)?.openPopup() }
function cancelPolygon(notify = false) { drawingPoints = []; if (drawingPreview) map.removeLayer(drawingPreview); drawingPreview = null; if (notify) toast('Drawing cancelled') }
function selectTool(tool) {
  selectedTool = tool; cancelPolygon(false)
  $$('.tool-button').forEach(button => { const on = button.dataset.tool === tool; button.classList.toggle('is-active', on); button.setAttribute('aria-pressed', String(on)) })
  $('#editorMap').classList.toggle('drawing-crosshair', tool !== 'select')
  $('#toolHint').textContent = { select: 'Select a feature, drag an unlocked marker, or pan the atlas.', marker: 'Click the map to place a marker.', polygon: 'Click vertices; double-click to close the region. Escape cancels.', label: 'Click the map to place a text label.', icon: 'Choose a symbol, then click the map.' }[tool]
}
function createPointFeature(type, point) {
  const layer = activeLayer(); if (layer.locked) return toast('Unlock the active layer before drawing')
  if (!layer.visible) return toast('Show the active layer before drawing')
  const icon = $('#iconPicker').value; const name = type === 'label' ? 'New label' : type === 'icon' ? `New ${icon}` : 'New marker'
  const feature = { id: idFor(type === 'icon' ? 'marker' : type), type: type === 'icon' ? 'marker' : type, name, note: '', wikiUrl: '', color: '#d9b77a', icon, point }
  layer.features.push(feature); selectedFeatureId = feature.id; selectTool('select'); commit(`${name} placed`); setTimeout(() => $('#featureName').focus(), 0)
}
function addPolygonPoint(point) {
  const layer = activeLayer(); if (layer.locked) return toast('Unlock the active layer before drawing')
  if (!layer.visible) return toast('Show the active layer before drawing')
  drawingPoints.push(point); if (drawingPreview) map.removeLayer(drawingPreview)
  drawingPreview = L.polyline(drawingPoints.map(item => [item.lat, item.lng]), { color: '#d9b77a', dashArray: '5 6', weight: 2 }).addTo(map)
  $('#toolHint').textContent = `${drawingPoints.length} ${drawingPoints.length === 1 ? 'vertex' : 'vertices'} placed. Double-click to finish.`
}
function finishPolygon() {
  if (selectedTool !== 'polygon' || drawingPoints.length < 3) return
  if (activeLayer().locked || !activeLayer().visible) return cancelPolygon(true)
  const points = drawingPoints.filter((point, index, all) => index === 0 || point.lat !== all[index - 1].lat || point.lng !== all[index - 1].lng)
  if (points.length < 3) return toast('A region needs three distinct vertices')
  const feature = { id: idFor('polygon'), type: 'polygon', name: 'New region', note: '', wikiUrl: '', color: '#d9b77a', points }
  activeLayer().features.push(feature); selectedFeatureId = feature.id; cancelPolygon(false); selectTool('select'); commit('Region drawn'); setTimeout(() => $('#featureName').focus(), 0)
}

map.on('mousemove', event => { const point = snapped(event.latlng); $('#coordinateReadout').textContent = `X ${point.lng.toLocaleString()} • Y ${point.lat.toLocaleString()} • ${(point.lng * KM_PER_PIXEL).toLocaleString(undefined, { maximumFractionDigits: 1 })} km E` })
map.on('click', event => { const point = snapped(event.latlng); if (['marker', 'label', 'icon'].includes(selectedTool)) createPointFeature(selectedTool, point); else if (selectedTool === 'polygon') addPolygonPoint(point); else { selectedFeatureId = null; renderAll() } })
map.on('dblclick', event => { if (selectedTool === 'polygon') { L.DomEvent.stop(event); finishPolygon() } })
$$('.tool-button').forEach(button => button.addEventListener('click', () => selectTool(button.dataset.tool)))
$$('.map-choice').forEach(button => button.addEventListener('click', () => switchMap(button.dataset.map)))
$('#resetViewBtn').addEventListener('click', () => map.fitBounds(bounds(), { padding: [12, 12], animate: false }))
$('#undoBtn').addEventListener('click', () => restoreHistory(historyIndex - 1)); $('#redoBtn').addEventListener('click', () => restoreHistory(historyIndex + 1))
$('#saveBtn').addEventListener('click', saveDocument); $('#exportBtn').addEventListener('click', () => globalThis.exportMapPNG())
$('#documentTitle').addEventListener('change', event => { state.title = event.target.value.trim() || currentConfig().title; event.target.value = state.title; commit('Folio title updated') })
$('#addLayerBtn').addEventListener('click', () => {
  if (state.layers.length >= 12) return toast('The atlas supports up to twelve layers')
  const name = prompt('Name this atlas layer:')?.trim(); if (!name) return
  let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `layer-${state.layers.length + 1}`
  while (state.layers.some(layer => layer.id === id)) id = `${id}-${state.layers.length + 1}`
  state.layers.push({ id, name: name.slice(0, 64), visible: true, locked: false, features: [] }); activeLayerId = id; commit(`${name} layer added`)
})
$('#deleteFeatureBtn').addEventListener('click', () => { const found = locateFeature(selectedFeatureId); if (!found || found.layer.locked || !confirm(`Delete “${found.feature.name || 'this feature'}”?`)) return; found.layer.features.splice(found.index, 1); selectedFeatureId = null; commit('Feature deleted') })
for (const id of ['featureName', 'featureWiki', 'featureNote', 'featureColor', 'featureIcon']) {
  $(`#${id}`).addEventListener('change', event => {
    const found = locateFeature(selectedFeatureId); if (!found || found.layer.locked) return
    const key = { featureName: 'name', featureWiki: 'wikiUrl', featureNote: 'note', featureColor: 'color', featureIcon: 'icon' }[id]
    const value = event.target.value.trim?.() ?? event.target.value
    if (key === 'wikiUrl' && value && (!value.startsWith('/wiki/') || value.includes('..'))) { toast('Wiki links must begin with /wiki/'); event.target.value = found.feature.wikiUrl; return }
    found.feature[key] = value; commit('Feature details updated')
  })
}
$('#featureLayer').addEventListener('change', event => { const found = locateFeature(selectedFeatureId); const target = state.layers.find(layer => layer.id === event.target.value); if (!found || found.layer.locked || !target || target.locked || target === found.layer) { if (found) event.target.value = found.layer.id; return }; found.layer.features.splice(found.index, 1); target.features.push(found.feature); activeLayerId = target.id; commit(`Moved to ${target.name}`) })
$('#featureWiki').addEventListener('input', async event => {
  if (!wikiIndex) { try { const response = await fetch('/wiki-index.json', { credentials: 'same-origin' }); wikiIndex = response.ok ? await response.json() : [] } catch { wikiIndex = [] } }
  const query = event.target.value.toLowerCase().replace('/wiki/', '').trim(); const matches = query.length > 1 ? wikiIndex.filter(item => item.title.toLowerCase().includes(query) || item.url.toLowerCase().includes(query)).slice(0, 12) : []
  $('#wikiSuggestions').innerHTML = matches.map(item => `<option value="${escapeHtml(item.url)}">${escapeHtml(item.title)}</option>`).join('')
})
document.addEventListener('keydown', event => {
  const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable
  if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); restoreHistory(event.shiftKey ? historyIndex + 1 : historyIndex - 1) }
  else if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); restoreHistory(historyIndex + 1) }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!$('#saveBtn').disabled) saveDocument() }
  else if (event.key === 'Escape' && selectedTool !== 'select') { selectTool('select'); toast('Drawing cancelled') }
  else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedFeatureId && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) $('#deleteFeatureBtn').click()
})
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = '' } }); window.addEventListener('resize', () => map.invalidateSize(), { passive: true })

async function switchMap(slug) { if (!MAPS[slug] || slug === state.slug) return; if (dirty && !confirm('Leave this folio with unsaved changes?')) return; await loadDocument(slug) }
async function loadDocument(slug) {
  setSaveState(`Opening ${MAPS[slug].title}…`); $('#loadingVeil').classList.remove('is-hidden')
  try {
    const response = await fetch(`/api/maps/${slug}`, { credentials: 'same-origin' }); if (response.status === 401) { location.href = `/?next=${encodeURIComponent('/map-editor')}`; return }
    const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || 'Map could not be loaded')
    state = payload.map || defaultDocument(slug); activeLayerId = state.layers[0].id; selectedFeatureId = null; dirty = false; history = [JSON.stringify(state)]; historyIndex = 0
    $('#documentTitle').value = state.title; loadBaseMap(true); renderAll(); updateHistoryButtons(); setSaveState(payload.updatedAt ? `Saved ${new Date(payload.updatedAt).toLocaleString()}` : 'New folio — not yet saved', payload.updatedAt ? 'saved' : '')
  } catch (error) { setSaveState(error.message, 'error'); toast(error.message) } finally { $('#loadingVeil').classList.add('is-hidden'); $('.studio-shell').setAttribute('aria-busy', 'false'); setTimeout(() => map.invalidateSize(), 50) }
}
async function saveDocument() {
  const button = $('#saveBtn'); button.disabled = true; button.setAttribute('aria-busy', 'true'); setSaveState('Sealing changes…')
  try {
    const response = await fetch(`/api/maps/${state.slug}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ map: state }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || 'Save failed')
    dirty = false; setSaveState(`Saved ${new Date(payload.updatedAt).toLocaleString()}`, 'saved'); toast('Atlas folio saved to the private archive')
  } catch (error) { setSaveState(error.message, 'error'); toast(error.message) } finally { button.disabled = false; button.removeAttribute('aria-busy') }
}
async function loadExportImage(config) {
  for (const url of [config.image, config.fallback]) { try { const image = new Image(); image.decoding = 'async'; image.src = url; await image.decode(); return image } catch {} }
  throw new Error('Base map image unavailable')
}
async function exportMapPNG() {
  setSaveState('Preparing PNG…')
  try {
    const cfg = currentConfig(); const image = await loadExportImage(cfg); const canvas = document.createElement('canvas'); canvas.width = cfg.width; canvas.height = cfg.height; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, cfg.width, cfg.height)
    for (const layer of state.layers) { if (!layer.visible) continue; for (const feature of layer.features) {
      context.save(); context.strokeStyle = feature.color; context.fillStyle = `${feature.color}35`; context.lineWidth = 3
      if (feature.type === 'polygon') { context.beginPath(); feature.points.forEach((point, index) => { const x = point.lng; const y = cfg.height - point.lat; if (index) context.lineTo(x, y); else context.moveTo(x, y) }); context.closePath(); context.fill(); context.stroke() }
      else if (feature.type === 'label') { context.fillStyle = feature.color; context.font = '600 24px serif'; context.shadowColor = '#000'; context.shadowBlur = 5; context.fillText(feature.name || 'Label', feature.point.lng, cfg.height - feature.point.lat) }
      else { const x = feature.point.lng; const y = cfg.height - feature.point.lat; context.beginPath(); context.arc(x, y, 10, 0, Math.PI * 2); context.fillStyle = '#101211'; context.fill(); context.stroke(); context.fillStyle = feature.color; context.font = '600 18px serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(SYMBOLS[feature.icon] || '•', x, y) }
      context.restore()
    }}
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('PNG export failed')
    const link = document.createElement('a'); link.download = `geor-${state.slug}-${new Date().toISOString().slice(0, 10)}.png`; link.href = URL.createObjectURL(blob); link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1500)
    setSaveState(dirty ? 'Unsaved changes' : 'Saved', dirty ? '' : 'saved'); toast('PNG export prepared'); return blob
  } catch (error) { setSaveState(error.message, 'error'); toast(error.message); throw error }
}
globalThis.exportMapPNG = exportMapPNG
try { const me = await fetch('/api/me', { credentials: 'same-origin' }); if (!me.ok) location.href = `/?next=${encodeURIComponent('/map-editor')}`; else await loadDocument(new URLSearchParams(location.search).get('map') === 'grimmel' ? 'grimmel' : 'world') }
catch { setSaveState('Archive connection unavailable', 'error'); $('#loadingVeil').classList.add('is-hidden') }
