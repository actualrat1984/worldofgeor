// Entity inventories (Wave H11a) — structured item lists attachable to a
// folio, per member. Storage note (honest, deliberate): the D1 `notes`
// table (member_email, page, anchor, body, shared) exposes only GET/POST
// for marginalia — no update/delete route and no quantity columns — so an
// add/remove inventory with quantities cannot round-trip there without a
// migration (forbidden this wave). Inventories therefore live in
// member+entity-keyed localStorage, clearly labeled device-local in the UI.
// Pure helpers are exported so node --test can verify scoping, round-trip,
// and escaping without a browser.
import { escapeHtml } from './timeline.js'

export const INVENTORY_KEY_PREFIX = 'geor:inventory:'
export const INVENTORY_ITEM_MAX = 200
export const INVENTORY_NAME_MAX = 120
export const INVENTORY_NOTE_MAX = 500
export const INVENTORY_QTY_MAX = 9999
export const INVENTORY_STORAGE_LABEL = 'Kept on this device only — per member, per folio.'

// Only real archive folios: a /wiki/ path, or a full URL whose path is one.
export function cleanInventoryEntity(value) {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  let path = raw
  if (/^https?:\/\//i.test(raw)) {
    try { path = new URL(raw).pathname } catch { return null }
  }
  if (!path.startsWith('/wiki/') || path.includes('..') || /[<>"']/.test(path)) return null
  return path.length <= 500 ? path : null
}

function cleanMember(value) {
  const member = String(value ?? '').trim().toLowerCase()
  return member || 'local'
}

// One localStorage entry per member+entity — members never see or clobber
// each other's lists, and each folio carries its own.
export function inventoryKey(member, entity) {
  const path = cleanInventoryEntity(entity)
  if (!path) return null
  return `${INVENTORY_KEY_PREFIX}${cleanMember(member)}:${path}`
}

export function makeInventoryId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function cleanInventoryItemName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ')
  return name && name.length <= INVENTORY_NAME_MAX ? name : null
}

export function cleanInventoryQty(value) {
  const qty = Number(value)
  return Number.isInteger(qty) && qty >= 1 && qty <= INVENTORY_QTY_MAX ? qty : null
}

export function cleanInventoryNote(value) {
  if (value == null || value === '') return ''
  const note = String(value).trim()
  return note.length <= INVENTORY_NOTE_MAX ? note : null
}

function cleanInventoryId(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,64}$/i.test(value) ? value : null
}

// Parse stored JSON back into a safe list: junk entries are dropped, the
// list is capped, quantities fall back to 1 when malformed-but-present.
export function parseInventory(raw) {
  let data
  try { data = JSON.parse(String(raw ?? '[]')) } catch { return [] }
  if (!Array.isArray(data)) return []
  const out = []
  for (const row of data.slice(0, INVENTORY_ITEM_MAX)) {
    const name = cleanInventoryItemName(row?.name)
    const id = cleanInventoryId(row?.id) ?? makeInventoryId()
    if (!name) continue
    const qty = cleanInventoryQty(row?.qty) ?? 1
    const note = cleanInventoryNote(row?.note) ?? ''
    out.push({ id, name, qty, note })
  }
  return out
}

export function serializeInventory(list) {
  return JSON.stringify((list ?? []).slice(0, INVENTORY_ITEM_MAX))
}

export function addInventoryItem(list, input) {
  const current = [...(list ?? [])]
  if (current.length >= INVENTORY_ITEM_MAX) return { error: 'That pack is full (200 items).' }
  const name = cleanInventoryItemName(input?.name)
  if (!name) return { error: 'Name the item first.' }
  const qty = cleanInventoryQty(input?.qty ?? 1)
  if (qty === null) return { error: 'Quantity must be a whole number from 1 to 9999.' }
  const note = cleanInventoryNote(input?.note ?? '')
  if (note === null) return { error: 'Notes stay under 500 characters.' }
  const item = { id: cleanInventoryId(input?.id) ?? makeInventoryId(), name, qty, note }
  return { list: [...current, item], item }
}

export function removeInventoryItem(list, id) {
  const key = cleanInventoryId(id)
  if (!key) return [...(list ?? [])]
  return (list ?? []).filter(item => item?.id !== key)
}

export function renderInventoryList(list) {
  const items = [...(list ?? [])]
  if (!items.length) return '<p class="p-4 text-sm text-cream/40">No items packed for this folio yet.</p>'
  return items.map(item => `<div class="flex items-start gap-3 p-4" data-inventory-id="${escapeHtml(item.id)}">`
    + `<span class="text-xs font-semibold text-gold border border-gold/30 rounded-full px-2.5 py-1 whitespace-nowrap" aria-label="Quantity ${escapeHtml(String(item.qty))}">×${escapeHtml(String(item.qty))}</span>`
    + `<span class="flex-1 min-w-0"><span class="block text-sm font-semibold text-cream/90">${escapeHtml(item.name)}</span>`
    + (item.note ? `<span class="block text-xs text-cream/50 mt-1">${escapeHtml(item.note)}</span>` : '')
    + `</span><button type="button" data-inventory-remove="${escapeHtml(item.id)}" class="text-xs text-cream/40 hover:text-cream/80 px-2 py-1" aria-label="Remove ${escapeHtml(item.name)}">REMOVE</button>`
    + `</div>`).join('')
}

// --- Browser wiring (never runs under node --test) --------------------------

export function initInventoryPanel(root) {
  if (typeof document === 'undefined' || !root) return null
  const entityInput = root.querySelector('[data-inventory-entity]')
  const nameInput = root.querySelector('[data-inventory-name]')
  const qtyInput = root.querySelector('[data-inventory-qty]')
  const noteInput = root.querySelector('[data-inventory-note]')
  const list = root.querySelector('[data-inventory-list]')
  const status = root.querySelector('[data-inventory-status]')
  const count = root.querySelector('[data-inventory-count]')
  if (!entityInput || !nameInput || !qtyInput || !list) return null

  let member = 'local'
  let items = []
  const setStatus = message => { if (status) status.textContent = message }
  const key = () => inventoryKey(member, entityInput.value)
  const read = () => { try { return parseInventory(localStorage.getItem(key())) } catch { return [] } }
  const write = () => { try { localStorage.setItem(key(), serializeInventory(items)) } catch {} }
  const paint = () => {
    list.innerHTML = renderInventoryList(items)
    if (count) count.textContent = items.length ? `${items.length} item${items.length === 1 ? '' : 's'} · ${INVENTORY_STORAGE_LABEL}` : INVENTORY_STORAGE_LABEL
  }
  const open = () => {
    const storageKey = key()
    if (!storageKey) { items = []; paint(); setStatus('Enter a real /wiki/ folio URL to open its pack.'); return }
    items = read()
    paint()
    setStatus(items.length ? '' : 'An empty pack for this folio — add the first item.')
  }

  fetch('/api/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(response => response.ok ? response.json() : null)
    .then(data => { if (data?.email) member = String(data.email) })
    .catch(() => {})
    .finally(open)

  let entityTimer = null
  entityInput.addEventListener('input', () => { clearTimeout(entityTimer); entityTimer = setTimeout(open, 400) })
  root.querySelector('[data-inventory-add]')?.addEventListener('click', () => {
    if (!key()) { setStatus('Enter a real /wiki/ folio URL first — packs attach to folios, not thin air.'); return }
    const result = addInventoryItem(items, { name: nameInput.value, qty: qtyInput.value, note: noteInput?.value ?? '' })
    if (result.error) { setStatus(result.error); return }
    items = result.list
    write(); paint()
    nameInput.value = ''; qtyInput.value = '1'; if (noteInput) noteInput.value = ''
    setStatus(`Packed ${result.item.name}.`)
    nameInput.focus()
  })
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-inventory-remove]')
    if (!button) return
    const target = items.find(item => item.id === button.dataset.inventoryRemove)
    items = removeInventoryItem(items, button.dataset.inventoryRemove)
    write(); paint()
    setStatus(target ? `Removed ${target.name}.` : '')
  })
  return { open }
}
