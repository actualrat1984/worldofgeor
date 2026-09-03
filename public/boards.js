// Whiteboards (Wave E3) — pure helpers are exported so node --test
// can verify board shaping and rendering without a browser.
// Browser rendering only runs when `document` exists.
import { escapeHtml } from './timeline.js'

// Card footprint on the canvas (must match public/boards.html CSS width).
export const BOARD_CARD_WIDTH = 220
export const BOARD_CARD_HEIGHT = 120

function newId(prefix) {
  try {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID().slice(0, 8)}`
  } catch { /* fall through to the counter fallback */ }
  return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

// Shape a fresh card at world coords; id overridable for tests.
export function shapeNewCard(x, y, id) {
  return {
    id: typeof id === 'string' && id ? id : newId('card'),
    x: Number.isFinite(Number(x)) ? Number(x) : 0,
    y: Number.isFinite(Number(y)) ? Number(y) : 0,
    title: '',
    body: '',
    wiki: '',
  }
}

export function shapeNewArrow(from, to, id) {
  return { id: typeof id === 'string' && id ? id : newId('arrow'), from, to }
}

// One board in the sidebar: escaped title, live card/arrow counts.
export function renderBoardItem(board, selected) {
  const title = typeof board?.title === 'string' && board.title.trim() ? board.title : 'Untitled board'
  const cards = Number(board?.cardCount) || 0
  const arrows = Number(board?.arrowCount) || 0
  return `<button type="button" data-board-id="${escapeHtml(String(board?.id ?? ''))}" aria-pressed="${selected ? 'true' : 'false'}"`
    + ` class="w-full text-left p-4 ${selected ? 'bg-gold/10' : ''}">`
    + `<span class="block text-sm font-semibold text-cream/90 truncate">${escapeHtml(title)}</span>`
    + `<span class="block text-[10px] tracking-widest text-cream/40 mt-2">${cards} CARDS · ${arrows} ARROWS</span>`
    + `</button>`
}

export function renderBoardList(boards, selectedId) {
  const list = [...(boards ?? [])]
  if (!list.length) return '<p class="p-5 text-sm text-cream/40">No whiteboards yet — start the first plot.</p>'
  return list.map(board => renderBoardItem(board, board?.id === selectedId)).join('')
}

// One card on the canvas: escaped text, positioned at world coords.
export function renderCard(card, selected) {
  const title = typeof card?.title === 'string' && card.title.trim() ? card.title : 'Untitled card'
  const excerpt = String(card?.body ?? '').slice(0, 120)
  const wiki = typeof card?.wiki === 'string' ? card.wiki : ''
  const x = Number(card?.x) || 0
  const y = Number(card?.y) || 0
  return `<div class="board-card${selected ? ' selected' : ''} rounded-xl border border-gold/20 bg-ink/90 p-3" data-card-id="${escapeHtml(String(card?.id ?? ''))}"`
    + ` style="transform: translate(${x}px, ${y}px)">`
    + `<p class="text-sm font-semibold text-cream/90 truncate">${escapeHtml(title)}</p>`
    + (excerpt ? `<p class="text-xs text-cream/50 mt-1 line-clamp-2">${escapeHtml(excerpt)}</p>` : '')
    + (wiki ? `<a href="${escapeHtml(wiki)}" class="block text-[11px] text-gold mt-2 truncate" data-wiki-link>🔗 ${escapeHtml(wiki)}</a>` : '')
    + `</div>`
}

// Arrow endpoints in world coords (card top-left anchors; the browser
// offsets to card centers when drawing). Null when an end is missing.
export function arrowEndpoints(arrow, byId) {
  const get = id => (typeof byId?.get === 'function' ? byId.get(id) : byId?.[id])
  const from = get(arrow?.from)
  const to = get(arrow?.to)
  if (!from || !to) return null
  const coords = point => ({ x: Number(point?.x) || 0, y: Number(point?.y) || 0 })
  const a = coords(from)
  const b = coords(to)
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
}

// One arrow row: escaped endpoint titles, delete affordance.
export function renderArrowItem(arrow, byId, index) {
  const get = id => (typeof byId?.get === 'function' ? byId.get(id) : byId?.[id])
  const name = id => {
    const card = get(id)
    const title = typeof card?.title === 'string' && card.title.trim() ? card.title : 'Untitled card'
    return escapeHtml(title)
  }
  return `<li class="flex items-center gap-2 text-xs text-cream/60" data-arrow-row="${index}">`
    + `<span class="flex-1 min-w-0 truncate">${name(arrow?.from)} → ${name(arrow?.to)}</span>`
    + `<button type="button" data-arrow-remove="${escapeHtml(String(arrow?.id ?? ''))}" class="text-xs text-cream/40" aria-label="Remove arrow">×</button>`
    + `</li>`
}

export function renderArrowList(arrows, byId) {
  const list = Array.isArray(arrows) ? arrows : []
  if (!list.length) return '<li class="text-xs text-cream/40">No arrows yet — toggle LINK and click two cards.</li>'
  return list.map((arrow, index) => renderArrowItem(arrow, byId, index)).join('')
}

// --- Browser rendering (never runs under node --test) -----------------------
async function requestBoards(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options })
  if (response.status === 401) {
    location.href = '/?next=' + encodeURIComponent('/boards')
    throw new Error('Sign in to open the whiteboards')
  }
  if (!response.ok) throw new Error('The whiteboards are temporarily unavailable')
  return response.json()
}

async function initBoards() {
  const list = document.getElementById('boardList')
  const status = document.getElementById('boardStatus')
  const count = document.getElementById('boardCount')
  const viewport = document.getElementById('boardViewport')
  const world = document.getElementById('boardWorld')
  const arrowLayer = document.getElementById('arrowLayer')
  const cardLayer = document.getElementById('cardLayer')
  const titleInput = document.getElementById('boardTitleInput')
  const cardTitle = document.getElementById('cardTitle')
  const cardBody = document.getElementById('cardBody')
  const cardWiki = document.getElementById('cardWiki')
  const arrowList = document.getElementById('arrowList')
  const linkButton = document.getElementById('linkMode')
  if (!list || !viewport || !world || !cardLayer || !arrowLayer) return

  let boards = []
  let boardId = null
  let cards = []
  let arrows = []
  let selectedCardId = null
  let linkFrom = null
  let linking = false
  let saveTimer = null
  let dirty = false
  const cam = { x: 60, y: 40, k: 1 }

  const byId = () => new Map(cards.map(card => [card?.id, card]))
  const selected = () => cards.find(card => card?.id === selectedCardId) || null
  const setStatus = message => { if (status) status.textContent = message }
  const paintCount = () => {
    if (count) count.textContent = boards.length
      ? `${boards.length} board${boards.length === 1 ? '' : 's'} · private to you`
      : 'No whiteboards yet'
  }

  const applyCam = () => {
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`
  }

  const paintArrows = () => {
    const map = byId()
    const lines = []
    for (const arrow of arrows) {
      const ends = arrowEndpoints(arrow, map)
      if (!ends) continue
      const x1 = ends.x1 + BOARD_CARD_WIDTH / 2
      const y1 = ends.y1 + BOARD_CARD_HEIGHT / 2
      const x2 = ends.x2 + BOARD_CARD_WIDTH / 2
      const y2 = ends.y2 + BOARD_CARD_HEIGHT / 2
      lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(217,183,122,.7)" stroke-width="${2 / cam.k}" marker-end="url(#boardArrowHead)" />`)
    }
    arrowLayer.setAttribute('width', '10')
    arrowLayer.setAttribute('height', '10')
    arrowLayer.innerHTML = `<defs><marker id="boardArrowHead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="none" stroke="rgba(217,183,122,.9)" stroke-width="1.5" /></marker></defs>` + lines.join('')
  }

  const paint = () => {
    list.innerHTML = renderBoardList(boards, boardId)
    list.setAttribute('aria-busy', 'false')
    cardLayer.innerHTML = cards.map(card => renderCard(card, card?.id === selectedCardId)).join('')
    arrowList.innerHTML = renderArrowList(arrows, byId())
    paintArrows()
    const card = selected()
    if (cardTitle) cardTitle.value = card?.title ?? ''
    if (cardBody) cardBody.value = card?.body ?? ''
    if (cardWiki) cardWiki.value = card?.wiki ?? ''
    paintCount()
  }

  const currentTitle = () => boards.find(board => board?.id === boardId)?.title ?? ''
  const syncTitleInput = () => { if (titleInput && document.activeElement !== titleInput) titleInput.value = currentTitle() }

  const doSave = async () => {
    if (!boardId || !dirty) return
    dirty = false
    try {
      setStatus('Saving…')
      const data = await requestBoards(`/api/boards/${encodeURIComponent(boardId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: currentTitle(), cards, arrows }),
      })
      if (data?.board) {
        const at = boards.findIndex(board => board?.id === boardId)
        if (at >= 0) boards[at] = { ...boards[at], title: data.board.title, cardCount: cards.length, arrowCount: arrows.length }
        syncTitleInput()
        paintCount()
        list.innerHTML = renderBoardList(boards, boardId)
      }
      setStatus(`Saved · ${new Date().toLocaleTimeString()}`)
    } catch (error) {
      dirty = true
      setStatus(error instanceof Error ? error.message : 'The whiteboard could not be saved')
    }
  }

  const scheduleSave = () => {
    dirty = true
    setStatus('Unsaved changes…')
    clearTimeout(saveTimer)
    saveTimer = setTimeout(doSave, 800)
  }

  const loadBoard = async id => {
    boardId = id
    selectedCardId = null
    linkFrom = null
    try {
      setStatus('Opening the whiteboard…')
      const data = await requestBoards(`/api/boards/${encodeURIComponent(id)}`)
      cards = Array.isArray(data?.board?.cards) ? data.board.cards : []
      arrows = Array.isArray(data?.board?.arrows) ? data.board.arrows : []
      dirty = false
      syncTitleInput()
      paint()
      setStatus(cards.length ? '' : 'An empty canvas — add the first card.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The whiteboard could not be opened')
    }
  }

  const loadList = async () => {
    try {
      setStatus('Opening the whiteboards…')
      const data = await requestBoards('/api/boards')
      boards = Array.isArray(data?.boards) ? data.boards : []
      if (boardId && !boards.some(board => board?.id === boardId)) boardId = boards[0]?.id ?? null
      if (!boardId) boardId = boards[0]?.id ?? null
      paintCount()
      if (boardId) await loadBoard(boardId)
      else {
        list.innerHTML = renderBoardList(boards, null)
        list.setAttribute('aria-busy', 'false')
        setStatus('No whiteboards yet — start the first plot.')
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The whiteboards could not be opened')
    }
  }

  const toWorld = event => {
    const rect = viewport.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left - cam.x) / cam.k,
      y: (event.clientY - rect.top - cam.y) / cam.k,
    }
  }

  // Pan the canvas by dragging empty space; cards stop propagation.
  let pan = null
  viewport.addEventListener('pointerdown', event => {
    if (event.target.closest('.board-card') || event.target.closest('a')) return
    pan = { x: event.clientX, y: event.clientY, camX: cam.x, camY: cam.y }
    viewport.classList.add('panning')
    viewport.setPointerCapture(event.pointerId)
  })
  viewport.addEventListener('pointermove', event => {
    if (!pan) return
    cam.x = pan.camX + (event.clientX - pan.x)
    cam.y = pan.camY + (event.clientY - pan.y)
    applyCam()
  })
  const endPan = () => { pan = null; viewport.classList.remove('panning') }
  viewport.addEventListener('pointerup', endPan)
  viewport.addEventListener('pointercancel', endPan)

  viewport.addEventListener('wheel', event => {
    event.preventDefault()
    const before = toWorld(event)
    cam.k = Math.min(2, Math.max(0.25, cam.k * (event.deltaY < 0 ? 1.1 : 1 / 1.1)))
    const rect = viewport.getBoundingClientRect()
    cam.x = event.clientX - rect.left - before.x * cam.k
    cam.y = event.clientY - rect.top - before.y * cam.k
    applyCam()
    paintArrows()
  }, { passive: false })

  // Card drag + link-mode clicks, delegated from the card layer.
  let drag = null
  cardLayer.addEventListener('pointerdown', event => {
    if (event.target.closest('a')) return
    const node = event.target.closest('[data-card-id]')
    if (!node) return
    const id = node.dataset.cardId
    if (linking) {
      event.stopPropagation()
      if (!linkFrom) {
        linkFrom = id
        setStatus('Link from one card — now click its target.')
      } else if (linkFrom !== id) {
        if (!arrows.some(arrow => arrow?.from === linkFrom && arrow?.to === id)) {
          arrows.push(shapeNewArrow(linkFrom, id))
          scheduleSave()
          paint()
        }
        linkFrom = null
        setStatus('')
      }
      return
    }
    event.stopPropagation()
    selectedCardId = id
    const card = selected()
    const point = toWorld(event)
    drag = { id, dx: point.x - (Number(card?.x) || 0), dy: point.y - (Number(card?.y) || 0), moved: false }
    cardLayer.setPointerCapture(event.pointerId)
    paint()
  })
  cardLayer.addEventListener('pointermove', event => {
    if (!drag) return
    const card = cards.find(entry => entry?.id === drag.id)
    if (!card) return
    const point = toWorld(event)
    card.x = Math.round((point.x - drag.dx) * 100) / 100
    card.y = Math.round((point.y - drag.dy) * 100) / 100
    drag.moved = true
    const node = cardLayer.querySelector(`[data-card-id="${CSS.escape(drag.id)}"]`)
    if (node) node.style.transform = `translate(${card.x}px, ${card.y}px)`
    paintArrows()
  })
  const endDrag = () => {
    if (drag?.moved) scheduleSave()
    drag = null
  }
  cardLayer.addEventListener('pointerup', endDrag)
  cardLayer.addEventListener('pointercancel', endDrag)

  list.addEventListener('click', event => {
    const button = event.target.closest('[data-board-id]')
    if (!button) return
    if (dirty) { void doSave() }
    void loadBoard(button.dataset.boardId)
  })

  document.getElementById('boardNew')?.addEventListener('click', async () => {
    const title = (titleInput?.value ?? '').trim() || 'Untitled board'
    try {
      setStatus('Starting a new board…')
      const data = await requestBoards('/api/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.slice(0, 200) }),
      })
      if (!data?.board) throw new Error('The whiteboard could not be saved')
      boards.unshift({ id: data.board.id, title: data.board.title, cardCount: 0, arrowCount: 0, updated_at: data.board.updated_at })
      await loadBoard(data.board.id)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The whiteboard could not be saved')
    }
  })

  document.getElementById('addCard')?.addEventListener('click', () => {
    if (!boardId) { setStatus('Open a board first.'); return }
    const rect = viewport.getBoundingClientRect()
    const center = {
      x: Math.round(((rect.width / 2 - cam.x) / cam.k - BOARD_CARD_WIDTH / 2) * 100) / 100,
      y: Math.round(((rect.height / 2 - cam.y) / cam.k - BOARD_CARD_HEIGHT / 2) * 100) / 100,
    }
    const card = shapeNewCard(center.x, center.y)
    cards.push(card)
    selectedCardId = card.id
    scheduleSave()
    paint()
    cardTitle?.focus()
  })

  linkButton?.addEventListener('click', () => {
    linking = !linking
    linkFrom = null
    linkButton.setAttribute('aria-pressed', linking ? 'true' : 'false')
    linkButton.textContent = linking ? 'LINK: ON' : 'LINK: OFF'
    setStatus(linking ? 'Link mode — click a source card, then its target.' : '')
  })

  document.getElementById('boardSave')?.addEventListener('click', () => { void doSave() })

  document.getElementById('boardDelete')?.addEventListener('click', async () => {
    if (!boardId) { setStatus('Nothing selected to delete.'); return }
    if (!confirm('Delete this whiteboard and all its cards?')) return
    try {
      setStatus('Deleting…')
      await requestBoards(`/api/boards/${encodeURIComponent(boardId)}`, { method: 'DELETE' })
      boards = boards.filter(board => board?.id !== boardId)
      boardId = boards[0]?.id ?? null
      cards = []
      arrows = []
      selectedCardId = null
      dirty = false
      if (boardId) await loadBoard(boardId)
      else { paint(); syncTitleInput(); setStatus('Deleted.') }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The whiteboard could not be deleted')
    }
  })

  titleInput?.addEventListener('change', () => {
    const board = boards.find(entry => entry?.id === boardId)
    if (!board) return
    const title = titleInput.value.trim().slice(0, 200)
    if (!title || title === board.title) { syncTitleInput(); return }
    board.title = title
    list.innerHTML = renderBoardList(boards, boardId)
    scheduleSave()
  })

  const editorChanged = () => {
    const card = selected()
    if (!card) return
    card.title = cardTitle?.value ?? ''
    card.body = cardBody?.value ?? ''
    card.wiki = cardWiki?.value ?? ''
    cardLayer.innerHTML = cards.map(entry => renderCard(entry, entry?.id === selectedCardId)).join('')
    paintArrows()
    scheduleSave()
  }
  let editorTimer = null
  const editorDebounced = () => { clearTimeout(editorTimer); editorTimer = setTimeout(editorChanged, 500) }
  cardTitle?.addEventListener('input', editorDebounced)
  cardBody?.addEventListener('input', editorDebounced)
  cardWiki?.addEventListener('input', editorDebounced)

  document.getElementById('cardDelete')?.addEventListener('click', () => {
    const card = selected()
    if (!card) { setStatus('No card selected.'); return }
    cards = cards.filter(entry => entry?.id !== card.id)
    arrows = arrows.filter(arrow => arrow?.from !== card.id && arrow?.to !== card.id)
    selectedCardId = null
    scheduleSave()
    paint()
  })

  arrowList?.addEventListener('click', event => {
    const button = event.target.closest('[data-arrow-remove]')
    if (!button) return
    arrows = arrows.filter(arrow => arrow?.id !== button.dataset.arrowRemove)
    scheduleSave()
    paint()
  })

  window.addEventListener('beforeunload', event => {
    if (dirty) event.preventDefault()
  })

  applyCam()
  await loadList()
}

if (typeof document !== 'undefined') initBoards()
