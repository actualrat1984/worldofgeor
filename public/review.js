// Review queue (Wave H22) — status-grouped view over GET /api/workflow.
// Pure helpers are exported so node --test can verify grouping, honest
// role labels, escaping, and next-step errors without a browser. Browser
// rendering only runs when `document` exists. No redirects: a 401 degrades
// to a sign-in prompt, any other failure degrades its group alone.
import { escapeHtml } from './timeline.js'

export const REVIEW_STATUSES = ['draft', 'review', 'approved', 'published']
export const REVIEW_QUEUE_URL = '/api/workflow'
const REVIEW_NEXT = '/review'

export function signInPrompt() {
  return `<p class="text-xs text-cream/40">Sign in to open the review queue. <a class="text-gold" href="/?next=${encodeURIComponent(REVIEW_NEXT)}">Sign in →</a></p>`
}

export function panelError(message) {
  return `<p class="text-xs text-cream/40">${escapeHtml(message || 'This group is temporarily unavailable.')}</p>`
}

// Honest role labels — derived only from verified access flags, never
// guessed. Unknown access is always the least-privileged label.
export function describeRole(access) {
  if (access?.isOwner === true) return 'owner'
  if (access?.isEditor === true) return 'editor'
  return 'viewer'
}

export function roleBadge(access) {
  const role = describeRole(access)
  if (role === 'owner') return 'Owner — can approve and publish'
  if (role === 'editor') return 'Editor — can file drafts and submit them for review'
  return 'Viewer — read-only'
}

export function groupWorkflowItems(items) {
  const groups = { draft: [], review: [], approved: [], published: [] }
  const list = Array.isArray(items) ? items : []
  for (const item of list) {
    if (item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(groups, item.status)) {
      groups[item.status].push(item)
    }
  }
  return groups
}

export function nextStepFor(status) {
  if (status === 'draft') return 'Next step: submit for review.'
  if (status === 'review') return 'Next step: waiting on the archive owner to approve.'
  if (status === 'approved') return 'Next step: waiting on the archive owner to publish.'
  if (status === 'published') return 'Canon — visible to every member.'
  return 'Unknown state — ask the archive owner.'
}

// Server denials are generic (403, no role enumeration); this maps the
// attempted move to the honest next-step reason shown beside the item.
export function transitionError(from, to) {
  if (to === 'draft') return 'Only the author or the archive owner can send this back to draft.'
  if (from === 'draft' && to === 'review') return 'Only the author, an editor, or the owner can submit for review.'
  if (from === 'review' && to === 'approved') return 'Only the archive owner can approve.'
  if (from === 'approved' && to === 'published') return 'Only the archive owner can publish.'
  return 'That move is not allowed from here.'
}

export function actionsFor(status) {
  if (status === 'draft') return [{ to: 'review', label: 'Submit for review' }]
  if (status === 'review') return [{ to: 'approved', label: 'Approve' }, { to: 'draft', label: 'Send back to draft' }]
  if (status === 'approved') return [{ to: 'published', label: 'Publish' }, { to: 'draft', label: 'Send back to draft' }]
  if (status === 'published') return [{ to: 'draft', label: 'Rework' }]
  return []
}

export function renderQueueItem(item, access) {
  const id = typeof item?.id === 'string' ? item.id : ''
  const title = typeof item?.title === 'string' && item.title.trim() ? item.title : 'Untitled item'
  const status = typeof item?.status === 'string' ? item.status : 'unknown'
  const mine = access?.isAuthor === true || (typeof access?.email === 'string' && access.email !== '' && item?.created_by === access.email)
  const filed = mine ? 'Filed by you' : 'Filed by another member'
  const buttons = actionsFor(status).map(action =>
    `<button type="button" data-review-id="${escapeHtml(id)}" data-review-from="${escapeHtml(status)}" data-review-to="${action.to}" class="text-xs border border-gold/30 text-gold px-3 py-1.5 rounded-full hover:bg-gold/10">${escapeHtml(action.label)}</button>`
  ).join('')
  return `<li class="rounded-xl border border-gold/10 px-4 py-3">`
    + `<span class="block text-sm font-semibold text-cream/90">${escapeHtml(title)}</span>`
    + `<span class="block text-[10px] tracking-widest text-cream/40 mt-1">${escapeHtml(`${status.toUpperCase()} · ${filed.toUpperCase()}`)}</span>`
    + `<span class="block text-xs text-cream/50 mt-1">${escapeHtml(nextStepFor(status))}</span>`
    + (buttons ? `<span class="mt-2 flex gap-2 flex-wrap">${buttons}</span>` : '')
    + `<span class="block text-xs text-red-300/80 mt-1" data-review-error="${escapeHtml(id)}" role="alert" aria-live="polite"></span>`
    + `</li>`
}

export function renderQueueGroup(status, items, access, error) {
  if (error === 'unauthorized') return signInPrompt()
  if (error) return panelError(error)
  const list = Array.isArray(items) ? items : []
  if (!list.length) return `<p class="text-xs text-cream/40">Nothing waiting here.</p>`
  return `<ul class="grid gap-2">${list.map(item => renderQueueItem(item, access)).join('')}</ul>`
}

// --- Browser rendering (never runs under node --test) -----------------------
async function fetchPanel(path) {
  try {
    const response = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    if (response.status === 401) return { error: 'unauthorized' }
    if (!response.ok) return { error: 'This group is temporarily unavailable.' }
    return { data: await response.json() }
  } catch {
    return { error: 'This group is temporarily unavailable.' }
  }
}

async function initReview() {
  const root = document.getElementById('q')
  if (!root) return
  const roleEl = document.getElementById('reviewRole')
  const countEl = document.getElementById('reviewCount')
  const me = await fetchPanel('/api/me')
  const access = me.error ? null : { email: me.data?.user?.email || '' }
  if (roleEl) {
    roleEl.textContent = me.error === 'unauthorized'
      ? 'You are signed out.'
      : (access?.email ? `Signed in as ${access.email} — the owner approves and publishes.` : 'Checking access…')
  }
  const groups = {}
  await Promise.all(REVIEW_STATUSES.map(async status => {
    groups[status] = await fetchPanel(`${REVIEW_QUEUE_URL}?status=${encodeURIComponent(status)}`)
  }))
  let total = 0
  for (const status of REVIEW_STATUSES) {
    const host = document.getElementById(`q-${status}`)
    if (!host) continue
    const panel = groups[status]
    if (panel.error) {
      host.innerHTML = renderQueueGroup(status, [], access, panel.error)
      continue
    }
    const items = Array.isArray(panel.data?.items) ? panel.data.items : []
    total += items.length
    const withSelf = items.map(item => ({ ...item }))
    host.innerHTML = renderQueueGroup(status, withSelf, access, null)
  }
  if (countEl) countEl.textContent = me.error === 'unauthorized' ? 'Sign in to open the queue.' : `${total} item${total === 1 ? '' : 's'} waiting across every state.`
  root.addEventListener('click', async event => {
    const button = event.target?.closest?.('[data-review-id]')
    if (!button) return
    const id = button.getAttribute('data-review-id')
    const from = button.getAttribute('data-review-from')
    const to = button.getAttribute('data-review-to')
    const slot = root.querySelector(`[data-review-error="${CSS.escape(id)}"]`)
    button.disabled = true
    try {
      const response = await fetch(REVIEW_QUEUE_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id, status: to }),
      })
      if (response.ok) {
        window.location.reload()
        return
      }
      const message = response.status === 403 ? transitionError(from, to) : 'That move could not be saved — try again.'
      if (slot) slot.textContent = message
      else window.alert(message)
    } catch {
      if (slot) slot.textContent = 'That move could not be saved — try again.'
    } finally {
      button.disabled = false
    }
  })
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initReview)
}
