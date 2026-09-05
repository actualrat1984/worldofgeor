// First-login tour (Wave H25) — 5-step onboarding overlay for Arcady's first visit.
// Pure step machine is exported so node --test can verify order, back/skip,
// and per-member completion without a browser. Browser mounting only happens
// through startForMember (called by dashboard.html, the only page that loads
// this module): the card is a non-modal corner panel, the page stays fully
// usable behind it, and Esc always dismisses. Text-only rendering — every
// string passes through escapeHtml — and this module performs no network
// calls and defines no API routes.
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

// Five steps: compass → rooms → reveals → primer → first action. Every target
// is a key of the alias map in scripts/check-site.mjs — never invent routes.
export const ONBOARDING_STEPS = Object.freeze([
  { id: 'compass', title: 'Find anything with the compass', body: 'Tap the ⌕ seal in the header, or press Ctrl+K, to search every folio in the archive.', target: '/search' },
  { id: 'rooms', title: 'Learn the rooms of the house', body: 'The Battlestation holds the working rooms — drafts, reviews, and the editorial desk.', target: '/app' },
  { id: 'reveals', title: 'Watch for reveals', body: 'The oracle keeps the tally of what has been unsealed and what still waits for you.', target: '/oracle' },
  { id: 'primer', title: 'Begin with the primer', body: 'A short spoiler-gated reading list of what Arcady may safely know first.', target: '/primer' },
  { id: 'first-action', title: 'Take your first seat at the desk', body: 'The desk is your daily surface — notes, arcs, timeline, and open questions.', target: '/desk' },
])

export const TOUR_ELEMENT_ID = 'georTour'
export const TOUR_HEADING_ID = 'georTourTitle'

// --- Pure step machine (no DOM, no storage) ---------------------------------
export function startTour() {
  return { index: 0, done: false, dismissed: false }
}

function clampIndex(state) {
  const raw = state && Number.isInteger(state.index) ? state.index : 0
  return Math.min(Math.max(raw, 0), ONBOARDING_STEPS.length - 1)
}

export function tourStep(state) {
  if (!state || !Number.isInteger(state.index)) return null
  return ONBOARDING_STEPS[state.index] ?? null
}

export function isLastStep(state) {
  return !!state && state.index === ONBOARDING_STEPS.length - 1
}

export function tourNext(state) {
  const index = clampIndex(state)
  if (index >= ONBOARDING_STEPS.length - 1) return { index, done: true, dismissed: false }
  return { index: index + 1, done: false, dismissed: false }
}

export function tourBack(state) {
  const index = clampIndex(state)
  return { index: Math.max(0, index - 1), done: false, dismissed: false }
}

export function tourSkip(state) {
  return { index: clampIndex(state), done: false, dismissed: true }
}

export function tourComplete(state) {
  return { index: clampIndex(state), done: true, dismissed: false }
}

// --- Member-keyed persistence (device-honest) --------------------------------
export function memberId(member) {
  if (typeof member === 'string') return member.trim().toLowerCase()
  if (member && typeof member === 'object') {
    const raw = member.email ?? member.id ?? member.name
    if (typeof raw === 'string') return raw.trim().toLowerCase()
  }
  return ''
}

export function tourStorageKey(member) {
  return `geor.tour.${memberId(member) || 'guest'}`
}

export function storageSupported(store) {
  if (!store || typeof store.getItem !== 'function' || typeof store.setItem !== 'function') return false
  try {
    store.setItem('__geor_tour_probe__', '1')
    if (typeof store.removeItem === 'function') store.removeItem('__geor_tour_probe__')
    return true
  } catch { return false }
}

// Device-honest: never promise remembrance this device cannot keep.
export function storageLabel(supported) {
  return supported
    ? 'Remember on this device'
    : 'This device cannot remember the tour — it will greet you again next visit'
}

function defaultStore() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage
  } catch { /* private mode or no storage — caller treats as unsupported */ }
  return undefined
}

export function isTourComplete(store, member) {
  const id = memberId(member)
  if (!id || !store || typeof store.getItem !== 'function') return false
  try { return store.getItem(tourStorageKey(id)) === '1' } catch { return false }
}

export function markTourComplete(store, member) {
  const id = memberId(member)
  if (!id || !store || typeof store.setItem !== 'function') return false
  try { store.setItem(tourStorageKey(id), '1'); return true } catch { return false }
}

// First-login trigger: a signed-in member with no prior completion and no
// explicit seen/dismissed flag. `flags.store` overrides the ambient storage
// so tests can pass fakes; browsers fall back to localStorage, guarded.
export function shouldShowTour(member, flags = {}) {
  const id = memberId(member)
  if (!id) return false
  if (flags && (flags.seen === true || flags.completed === true || flags.dismissed === true)) return false
  const store = (flags && flags.store !== undefined) ? flags.store : defaultStore()
  if (isTourComplete(store, id)) return false
  return true
}

// --- Overlay render (escaped strings only, never raw copy) --------------------
export function renderTourCard(step, index = 0, total = ONBOARDING_STEPS.length) {
  const safe = step && typeof step === 'object' ? step : {}
  const count = Number.isInteger(total) && total > 0 ? total : ONBOARDING_STEPS.length
  const current = Number.isInteger(index) ? Math.min(Math.max(index, 0), count - 1) : 0
  const title = escapeHtml(safe.title || 'Welcome to the archive')
  const body = escapeHtml(safe.body || '')
  const target = escapeHtml(safe.target || '/')
  const first = current === 0
  const last = current === count - 1
  const back = first
    ? ''
    : '<button type="button" data-tour-action="back" class="text-xs border border-gold/20 px-4 py-1.5 rounded-full hover:bg-gold/10">← Back</button>'
  const forward = last
    ? '<button type="button" data-tour-action="done" class="text-xs bg-gold text-ink px-4 py-1.5 rounded-full font-semibold">Finish the tour</button>'
    : '<button type="button" data-tour-action="next" class="text-xs bg-gold text-ink px-4 py-1.5 rounded-full font-semibold">Next →</button>'
  return `<div class="rounded-2xl border border-gold/25 bg-ink/95 backdrop-blur p-5 shadow-2xl" style="pointer-events:auto;" aria-live="polite">`
    + `<div class="flex items-start justify-between gap-3"><p class="text-tiny tracking-[.24em] text-gold">FIRST VISIT · STEP ${current + 1} OF ${count}</p>`
    + '<button type="button" data-tour-action="skip" aria-label="Skip tour" class="shrink-0 text-xs text-cream/45 hover:text-cream px-2 py-1">✕</button></div>'
    + `<h2 id="${TOUR_HEADING_ID}" tabindex="-1" class="font-display text-18 mt-1">${title}</h2>`
    + `<p class="text-sm text-cream/60 mt-1">${body}</p>`
    + `<a href="${target}" class="inline-block mt-3 text-xs border border-gold/25 text-gold rounded-full px-4 py-1.5 hover:bg-gold/10">Open this room →</a>`
    + `<div class="flex items-center gap-2 mt-4 flex-wrap">${back}${forward}<button type="button" data-tour-action="skip" class="text-xs text-cream/45 hover:text-cream px-3 py-1.5">Skip tour</button></div>`
    + `<p class="text-tiny text-cream/40 mt-3" data-tour-memory></p></div>`
}

// --- Browser mount (never runs under node --test) ------------------------------
export function mountTour(member, options = {}) {
  const doc = options.document ?? (typeof document !== 'undefined' ? document : undefined)
  if (!doc || typeof doc.createElement !== 'function' || typeof doc.getElementById !== 'function') return null
  if (!shouldShowTour(member, options)) return null
  const existing = doc.getElementById(TOUR_ELEMENT_ID)
  if (existing) return existing
  const store = options.store !== undefined ? options.store : defaultStore()
  let state = startTour()
  const wrap = doc.createElement('div')
  wrap.id = TOUR_ELEMENT_ID
  wrap.setAttribute('role', 'dialog')
  wrap.setAttribute('aria-label', 'First visit tour')
  // Non-modal on purpose: no backdrop, wrapper ignores pointer events so the
  // page behind stays fully usable; only the card itself takes clicks.
  wrap.setAttribute('style', 'position:fixed;right:1rem;bottom:1rem;z-index:80;max-width:min(22rem,calc(100vw - 2rem));pointer-events:none;')
  const onKey = event => {
    if (event && event.key === 'Escape') {
      if (typeof event.preventDefault === 'function') event.preventDefault()
      dismiss(false)
    }
  }
  const dismiss = persist => {
    if (persist) markTourComplete(store, member)
    doc.removeEventListener('keydown', onKey)
    wrap.remove()
    if (typeof options.onDone === 'function') options.onDone({ persisted: persist })
  }
  const wire = () => {
    const note = wrap.querySelector('[data-tour-memory]')
    if (note) note.textContent = storageLabel(storageSupported(store))
  }
  const paint = () => {
    const step = tourStep(state)
    if (!step) { dismiss(false); return }
    wrap.innerHTML = renderTourCard(step, state.index, ONBOARDING_STEPS.length)
    wire()
    // Focus trap-lite: move focus to the heading on every step change so
    // keyboard and screen-reader users track the tour. Esc always skips.
    const heading = doc.getElementById(TOUR_HEADING_ID)
    if (heading && typeof heading.focus === 'function') {
      try { heading.focus({ preventScroll: true }) } catch { heading.focus() }
    }
  }
  wrap.addEventListener('click', event => {
    const target = event && event.target && typeof event.target.closest === 'function'
      ? event.target.closest('[data-tour-action]')
      : null
    const action = target ? target.getAttribute('data-tour-action') : null
    if (!action || action === 'open') return
    if (action === 'next') {
      state = tourNext(state)
      if (state.done) dismiss(true)
      else paint()
    } else if (action === 'back') {
      state = tourBack(state)
      paint()
    } else if (action === 'done') {
      state = tourComplete(state)
      dismiss(true)
    } else if (action === 'skip') {
      state = tourSkip(state)
      dismiss(false)
    }
  })
  doc.addEventListener('keydown', onKey)
  const parent = doc.body || doc.documentElement
  parent.appendChild(wrap)
  paint()
  return wrap
}

export function startForMember(member, options = {}) {
  if (!shouldShowTour(member, options)) return null
  return mountTour(member, options)
}

if (typeof window !== 'undefined' && window && typeof window === 'object') {
  window.GeorOnboarding = { startForMember, mountTour, shouldShowTour }
}
