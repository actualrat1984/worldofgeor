// Manuscripts (Wave E1) — pure helpers are exported so node --test
// can verify path shaping, content building, and list rendering
// without a browser. Browser rendering only runs when `document` exists.
import { escapeHtml } from './timeline.js'
import { buildDocx, buildEpub, downloadBytes } from './compiler.js'
import { initMentionAutocomplete, paintLinkedFolios } from './mentions.js'
import { initInventoryPanel } from './inventory.js'
import { initManuscriptPresence } from './manuscript-presence.js'
import {
  CONFLICT_BADGE_TEXT,
  CONFLICT_STATUS_TEXT,
  QUEUED_CHIP_TEXT,
  SYNC_FAILED_TEXT,
  clearPathConflicts,
  createIdbAdapter,
  enqueueSave,
  flushOutbox,
  getConflictOutboxCount,
  hasOutboxFailures,
  isNetworkFailure,
  listConflicts,
  listOutbox,
  resolveKeepMine,
  resolveKeepServer,
} from './offline-sync.js'
import {
  CHAPTER_META_STORAGE_LABEL,
  cleanChapterEra,
  cleanPov,
  cleanVoiceTag,
  chapterMetaKey,
  currentMemberEmail,
  parseChapterMeta,
  parseYearNumber,
  renderDualDate,
  serializeChapterMeta,
} from './chapter-meta.js'

export const MANUSCRIPT_ROOT = 'Books'
export const MANUSCRIPT_BODY_MAX = 100000

// Draft autosave key: one localStorage entry per server path.
export function manuscriptDraftKey(path) {
  return `geor:manuscript-draft:${String(path || '')}`
}

export function manuscriptDownloadName(path) {
  const name = String(path || '').split('/').pop() || 'chapter.md'
  return name.endsWith('.md') ? name : `${name}.md`
}

// Mirror of the worker's buildManuscriptContent: title becomes the
// opening `# ` heading so the stored markdown reads on its own.
export function buildManuscriptContent(title, body) {
  const cleanTitle = typeof title === 'string' ? title.trim() : ''
  const text = typeof body === 'string' ? body : ''
  return cleanTitle ? `# ${cleanTitle}\n\n${text}` : text
}

// Split stored content back into editor fields (first `# ` line is title).
export function parseManuscriptContent(content) {
  const text = typeof content === 'string' ? content : ''
  const match = text.match(/^#\s+(.+?)\s*\n\n?([\s\S]*)$/)
  if (match) return { title: match[1].slice(0, 200), body: match[2] }
  return { title: '', body: text }
}

// 'Books/Ember/Arrival.md' -> { book: 'Ember', chapter: 'Arrival' }.
export function splitManuscriptPath(path) {
  const parts = String(path || '').split('/')
  if (parts.length !== 3 || parts[0] !== MANUSCRIPT_ROOT || !parts[1] || !parts[2]) return null
  const file = parts[2].endsWith('.md') ? parts[2].slice(0, -3) : parts[2]
  if (!file) return null
  return { book: parts[1], chapter: file }
}

export function renderManuscriptItem(file, selected, queued = false, conflicted = false) {
  const path = String(file?.path ?? '')
  const split = splitManuscriptPath(path) || { book: 'BOOK', chapter: path }
  const badge = conflicted
    ? `<span class="mt-2 inline-flex items-center gap-1.5 rounded-full border border-red-400/40 px-2.5 py-0.5 text-[10px] tracking-widest text-red-200/90">`
      + `<span aria-hidden="true">◈</span><span>${escapeHtml(CONFLICT_BADGE_TEXT)}</span></span>`
    : queued
      ? `<span class="mt-2 inline-flex items-center gap-1.5 rounded-full border border-gold/40 px-2.5 py-0.5 text-[10px] tracking-widest text-gold/90">`
        + `<span aria-hidden="true">◷</span><span>${escapeHtml(QUEUED_CHIP_TEXT)}</span></span>`
      : ''
  return `<button type="button" data-manuscript-path="${escapeHtml(path)}" data-queued="${queued ? 'true' : 'false'}" data-conflicted="${conflicted ? 'true' : 'false'}" aria-pressed="${selected ? 'true' : 'false'}"`
    + ` class="w-full text-left p-4 ${selected ? 'bg-gold/10' : ''}${queued || conflicted ? ' opacity-60' : ''}">`
    + `<span class="block text-sm font-semibold text-cream/90 truncate">${escapeHtml(split.chapter)}</span>`
    + `<span class="block text-[10px] tracking-widest text-cream/40 mt-1">${escapeHtml(String(split.book).toUpperCase())}</span>`
    + badge
    + `</button>`
}

export function renderManuscriptList(files, selectedPath, queued = []) {
  // Queued entries may be plain paths or { path, conflicted } records —
  // conflicted rows carry the needs-your-call badge, never the queued chip.
  const queuedState = new Map()
  for (const item of (queued ?? [])) {
    const path = typeof item === 'string' ? item : item?.path
    if (typeof path !== 'string' || !path) continue
    queuedState.set(path, Boolean(typeof item === 'object' && item?.conflicted))
  }
  const seen = new Set()
  const rows = [...(files ?? [])]
    .sort((a, b) => String(a?.path ?? '').localeCompare(String(b?.path ?? '')))
    .map(file => {
      const path = String(file?.path ?? '')
      seen.add(path)
      const state = queuedState.get(path)
      return renderManuscriptItem(file, file?.path === selectedPath, state !== undefined, state === true)
    })
  // Queued saves for chapters the server hasn't seen yet still render —
  // dimmed with the honest queued chip, never presented as saved.
  for (const path of [...queuedState.keys()].sort((a, b) => a.localeCompare(b))) {
    if (seen.has(path) || !splitManuscriptPath(path)) continue
    const conflicted = queuedState.get(path) === true
    rows.push(renderManuscriptItem({ path }, path === selectedPath, !conflicted, conflicted))
  }
  if (!rows.length) return '<p class="p-5 text-sm text-cream/40">No chapters yet — start the first one.</p>'
  return rows.join('')
}

// H19 Phase 3 — conflict resolution render helpers (pure, node-testable).
// Hostile server text is always escaped at render; labels name the stash,
// never pass as saved; nothing here writes anywhere.
export function renderConflictDiff(mineText, serverText) {
  const mine = typeof mineText === 'string' ? mineText : ''
  const server = typeof serverText === 'string' ? serverText : ''
  return `<div class="grid gap-3 md:grid-cols-2">`
    + `<div><p class="text-[10px] tracking-widest text-cream/40 mb-1">YOUR QUEUED TEXT · NOT YET PUBLISHED</p>`
    + `<pre class="whitespace-pre-wrap text-sm text-cream/90">${escapeHtml(mine)}</pre></div>`
    + `<div><p class="text-[10px] tracking-widest text-cream/40 mb-1">SERVER VERSION · READ-ONLY, NEVER AUTO-SAVED OVER YOURS</p>`
    + `<pre class="whitespace-pre-wrap text-sm text-cream/90">${escapeHtml(server)}</pre></div>`
    + `</div>`
}

export function renderConflictItem(conflict) {
  const id = conflict?.id == null ? '' : String(conflict.id)
  const path = String(conflict?.path ?? '')
  const label = String(conflict?.label ?? (path ? `${path} (unsaved conflict)` : 'unsaved conflict'))
  return `<article data-conflict-id="${escapeHtml(id)}" data-conflict-path="${escapeHtml(path)}" class="rounded-xl border border-red-400/40 p-4">`
    + `<p class="text-sm font-semibold text-cream/90">${escapeHtml(label)}</p>`
    + `<p class="mt-1 text-xs text-red-200/80">${escapeHtml(CONFLICT_BADGE_TEXT)} · nothing was overwritten.</p>`
    + `<div class="mt-3 flex flex-wrap gap-2">`
    + `<button type="button" data-conflict-action="keep-mine" class="text-xs tracking-widest border border-gold/40 text-gold px-4 py-2 rounded-full hover:bg-gold/10 transition">Keep mine</button>`
    + `<button type="button" data-conflict-action="keep-server" class="text-xs tracking-widest border border-cream/30 text-cream/80 px-4 py-2 rounded-full hover:bg-cream/10 transition">Keep server</button>`
    + `<button type="button" data-conflict-action="merge-manually" class="text-xs tracking-widest border border-cream/30 text-cream/80 px-4 py-2 rounded-full hover:bg-cream/10 transition">Compare &amp; merge</button>`
    + `</div></article>`
}

// H19 Phase 2 — compose an outbox additions.save from editor fields.
// Mirrors the worker's manuscriptPath + cleanManuscriptTitle/Body rules so a
// queued save lands on exactly the path an online POST would have written.
// Throws with the worker's copy when the chapter could not be saved online
// either. Title/body caps match /api/manuscripts (100k body); the 900k
// additions limit is enforced again at enqueue time.
export function composeQueuedSave({ book, chapter, title, body }) {
  const cleanSegment = value => {
    if (typeof value !== 'string') return null
    const segment = value.trim()
    if (!segment || segment.length > 80) return null
    if (!/^[A-Za-z0-9._\- ]+$/.test(segment)) return null
    if (segment === '.' || segment === '..' || segment.startsWith('.') || segment.endsWith('.')) return null
    return segment
  }
  const cleanBook = cleanSegment(book)
  const cleanChapter = cleanSegment(chapter)
  if (!cleanBook || !cleanChapter) throw new Error('Valid book and chapter required (A-Z 0-9 . _ - space)')
  const file = cleanChapter.includes('.') ? cleanChapter : `${cleanChapter}.md`
  const path = `${MANUSCRIPT_ROOT}/${cleanBook}/${file}`
  const cleanTitle = title == null ? '' : title
  if (typeof cleanTitle !== 'string') throw new Error('Title within 200 chars and a body within 100k chars required')
  const trimmedTitle = cleanTitle.trim()
  if (trimmedTitle.length > 200) throw new Error('Title within 200 chars and a body within 100k chars required')
  const chapterBody = typeof body === 'string' ? body.trim() : ''
  if (!chapterBody || chapterBody.length > MANUSCRIPT_BODY_MAX) {
    throw new Error('Title within 200 chars and a body within 100k chars required')
  }
  return {
    path,
    content: buildManuscriptContent(trimmedTitle, chapterBody),
    message: `manuscript ${path} via /manuscripts`,
  }
}

// Pending-count suffix for the manuscripts header. Empty when nothing is
// queued — the header only mentions the outbox when it is non-empty.
export function manuscriptPendingSuffix(pending) {
  const count = Math.max(0, Math.floor(Number(pending) || 0))
  return count > 0 ? ` · ${count} queued offline` : ''
}

// --- Browser rendering (never runs under node --test) -----------------------
async function requestManuscripts(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options })
  if (response.status === 401) {
    location.href = '/?next=' + encodeURIComponent('/manuscripts')
    throw new Error('Sign in to open the manuscripts studio')
  }
  if (!response.ok) throw new Error('The manuscripts studio is temporarily unavailable')
  return response.json()
}

function nowTime() {
  try { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
  catch { return '' }
}

async function initManuscripts() {
  const list = document.getElementById('msList')
  const status = document.getElementById('msStatus')
  const count = document.getElementById('msCount')
  const version = document.getElementById('msVersion')
  const form = document.getElementById('msForm')
  const bookInput = document.getElementById('msBook')
  const chapterInput = document.getElementById('msChapter')
  const titleInput = document.getElementById('msTitle')
  const bodyInput = document.getElementById('msBody')
  if (!list || !form || !bookInput || !chapterInput || !titleInput || !bodyInput) return
  // Wave H11b: chapter meta (POV voice + dual BGD/AGD date) lives in
  // member+chapter-keyed localStorage — the server keeps no such fields.
  const povInput = document.getElementById('msPov')
  const voiceInput = document.getElementById('msVoice')
  const yearInput = document.getElementById('msYear')
  const eraInput = document.getElementById('msEra')
  const dualDate = document.getElementById('msDualDate')
  const metaNote = document.getElementById('msMetaNote')
  if (metaNote) metaNote.textContent = `Voice & date stay on saved chapters · ${CHAPTER_META_STORAGE_LABEL}`
  let member = 'local'
  const metaKey = () => (selectedPath ? chapterMetaKey(member, selectedPath) : null)
  const readMeta = () => {
    const key = metaKey()
    if (!key) return { pov: '', voice: '', year: '', era: '' }
    try { return parseChapterMeta(localStorage.getItem(key)) }
    catch { return { pov: '', voice: '', year: '', era: '' } }
  }
  const paintMeta = () => {
    if (!povInput || !voiceInput || !yearInput || !eraInput) return
    const meta = readMeta()
    povInput.value = cleanPov(meta.pov)
    voiceInput.value = meta.voice
    yearInput.value = meta.year
    eraInput.value = cleanChapterEra(meta.era)
    if (dualDate) dualDate.innerHTML = renderDualDate(meta.year, meta.era)
  }
  const writeMeta = () => {
    if (!povInput || !voiceInput || !yearInput || !eraInput) return
    if (dualDate) dualDate.innerHTML = renderDualDate(yearInput.value, eraInput.value)
    const key = metaKey()
    if (!key) return
    const voice = cleanVoiceTag(voiceInput.value)
    if (voice === null) {
      setStatus('Voice tags stay under 80 characters — trim it to keep it.')
      return
    }
    if (yearInput.value.trim() && parseYearNumber(yearInput.value) === null) return
    try {
      localStorage.setItem(key, serializeChapterMeta({
        pov: povInput.value, voice: voiceInput.value, year: yearInput.value, era: eraInput.value,
      }))
    } catch {}
  }
  currentMemberEmail().then(email => { member = email; paintMeta() }).catch(() => {})

  let files = []
  let selectedPath = null
  let saveTimer = null
  let repaintMentions = () => {}
  // H19 Phase 2 — queued offline saves (outbox records) for this studio.
  let queuedRecords = []
  // H19 Phase 3 — conflict stashes awaiting the user's call.
  let conflictRecords = []
  let outboxAdapter = null
  try {
    outboxAdapter = createIdbAdapter()
  } catch { outboxAdapter = null }

  const setStatus = message => { if (status) status.textContent = message }
  const draftKey = () => selectedPath
    ? manuscriptDraftKey(selectedPath)
    : `geor:manuscript-draft:new:${bookInput.value.trim()}/${chapterInput.value.trim()}`
  const readDraft = () => { try { return localStorage.getItem(draftKey()) } catch { return null } }
  const writeDraft = value => { try { localStorage.setItem(draftKey(), value) } catch {} }
  const clearDraft = () => { try { localStorage.removeItem(draftKey()) } catch {} }

  const paint = () => {
    list.innerHTML = renderManuscriptList(files, selectedPath, queuedRecords)
    list.setAttribute('aria-busy', 'false')
    const books = new Set(files.map(file => splitManuscriptPath(file?.path)?.book).filter(Boolean))
    const base = files.length
      ? `${files.length} chapter${files.length === 1 ? '' : 's'} · ${books.size} book${books.size === 1 ? '' : 's'} · kept in the archive`
      : 'No chapters yet'
    const pending = queuedRecords.filter(record => !record?.conflicted).length
    if (count) count.textContent = `${base}${manuscriptPendingSuffix(pending)}`
  }

  // Re-read the outbox and repaint chips + header count. Never throws —
  // the studio stays usable when IndexedDB is unavailable.
  // H19 Phase 3 — the conflict section is created after the list when the
  // page has none, so no markup change is required. Stashes render with
  // keep-mine / keep-server / merge-manually actions; server text is
  // always escaped and nothing is ever auto-overwritten.
  let conflictBox = null
  try { conflictBox = document.getElementById('msConflicts') } catch { conflictBox = null }
  if (!conflictBox && list?.parentNode) {
    conflictBox = document.createElement('section')
    conflictBox.id = 'msConflicts'
    conflictBox.setAttribute('aria-live', 'polite')
    list.parentNode.insertBefore(conflictBox, list.nextSibling)
  }

  const paintConflicts = () => {
    if (!conflictBox) return
    if (!conflictRecords.length) { conflictBox.innerHTML = ''; return }
    const plural = conflictRecords.length === 1 ? '' : 's'
    conflictBox.innerHTML = `<h2 class="mt-4 text-xs tracking-widest text-red-200/90">${conflictRecords.length} chapter${plural} need${plural ? '' : 's'} your call — nothing was overwritten.</h2>`
      + conflictRecords.map(renderConflictItem).join('')
  }

  const refreshQueue = async () => {
    try {
      queuedRecords = outboxAdapter ? await listOutbox(outboxAdapter) : []
    } catch { queuedRecords = [] }
    paint()
    try {
      conflictRecords = outboxAdapter ? await listConflicts(outboxAdapter) : []
    } catch { conflictRecords = [] }
    paintConflicts()
  }

  // Flush queued saves in FIFO order, then reconcile the list. Status only
  // changes when the flush did something worth reporting.
  const flushQueued = async () => {
    await refreshQueue()
    if (!outboxAdapter) return
    let summary
    try {
      summary = await flushOutbox(outboxAdapter)
    } catch { return }
    if (summary.stopped === 'unauthorized') {
      location.href = '/?next=' + encodeURIComponent('/manuscripts')
      return
    }
    const activity = summary.sent > 0 || summary.failed > 0 || summary.conflicts > 0 || summary.stopped
    if (summary.sent > 0) await load()
    if (activity) await refreshQueue()
    else return
    if (summary.stopped === 'network' || summary.stopped === 'offline') {
      setStatus('Connection lost — queued saves stay on this device and will retry.')
    } else if (hasOutboxFailures(queuedRecords)) {
      setStatus(SYNC_FAILED_TEXT)
    } else if (summary.sent > 0 && !queuedRecords.some(record => !record?.conflicted)) {
      setStatus('Caught up — queued saves are published.')
    }
    if (summary.conflicts > 0) {
      const plural = summary.conflicts === 1 ? '' : 's'
      setStatus(`${summary.conflicts} conflict${plural} kept — ${CONFLICT_STATUS_TEXT}.`)
    }
  }

  // Queue the editor contents instead of POSTing. The draft stays local;
  // nothing here is presented as saved.
  const queueOfflineSave = async payload => {
    let composed
    try {
      composed = composeQueuedSave(payload)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'That chapter could not be queued')
      return
    }
    if (!outboxAdapter) {
      setStatus('This device cannot queue offline saves — reconnect and save again.')
      return
    }
    try {
      await enqueueSave(outboxAdapter, composed)
      selectedPath = composed.path
      await refreshQueue()
      const pending = queuedRecords.filter(record => !record?.conflicted).length
      setStatus(`${QUEUED_CHIP_TEXT}${manuscriptPendingSuffix(pending)} · will publish when you reconnect.`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'That chapter could not be queued')
    }
  }

  const paintVersion = async path => {
    if (!version) return
    if (!path) { version.textContent = 'A new chapter — save it to begin its versions.'; return }
    version.textContent = 'Reading the archive versions…'
    try {
      const data = await requestManuscripts(`/api/additions/history?path=${encodeURIComponent(path)}`)
      const revisions = Array.isArray(data?.revisions) ? data.revisions : []
      if (!revisions.length) { version.textContent = 'Saved once — no earlier versions yet.'; return }
      const latest = revisions[0]
      const date = latest?.date ? latest.date.slice(0, 10) : 'undated'
      version.textContent = `Server version ${revisions.length} · latest ${date} · earlier versions live in the additions history.`
    } catch { version.textContent = 'Archive versions are unavailable right now.' }
  }

  const openPath = async path => {
    const split = splitManuscriptPath(path)
    if (!split) return
    try {
      setStatus('Opening the chapter…')
      const data = await requestManuscripts(`/api/manuscripts?book=${encodeURIComponent(split.book)}&chapter=${encodeURIComponent(split.chapter)}`)
      selectedPath = data?.path || path
      const parsed = parseManuscriptContent(data?.content ?? '')
      bookInput.value = split.book
      chapterInput.value = split.chapter
      const draft = readDraft()
      if (draft != null && draft !== buildManuscriptContent(parsed.title, parsed.body)) {
        const saved = parseManuscriptContent(draft)
        titleInput.value = saved.title || parsed.title
        bodyInput.value = saved.body
        setStatus('Restored your unsaved draft — save to keep it on the server.')
      } else {
        titleInput.value = parsed.title
        bodyInput.value = parsed.body
        setStatus('')
      }
      paint()
      repaintMentions()
      paintMeta()
      presence?.open(selectedPath)
      await paintVersion(selectedPath)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The chapter could not be opened')
    }
  }

  const load = async () => {
    try {
      setStatus('Opening the studio…')
      const data = await requestManuscripts('/api/manuscripts')
      files = Array.isArray(data?.files) ? data.files : []
      if (selectedPath && !files.some(file => file?.path === selectedPath)) selectedPath = null
      paint()
      setStatus(files.length ? '' : 'No chapters yet — start the first one.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The studio could not be opened')
    }
  }

  const queueAutosave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      writeDraft(buildManuscriptContent(titleInput.value, bodyInput.value))
      setStatus(`Draft autosaved ${nowTime()} · not yet on the server.`)
    }, 800)
  }

  list.addEventListener('click', event => {
    const button = event.target.closest('[data-manuscript-path]')
    if (!button) return
    void openPath(button.dataset.manuscriptPath)
  })

  // H19 Phase 3 — resolution actions. The live server copy comes from the
  // same /api/manuscripts shape openPath uses (content for the side-by-side
  // diff, sha as keep-mine's fresh base) and the side-by-side diff reuses
  // /api/additions/history data shapes — no new endpoints. Nothing here
  // writes to the server except keep-mine's user-chosen re-enqueue flush.
  const serverChapter = async path => {
    const split = splitManuscriptPath(path)
    if (!split) return null
    try {
      return await requestManuscripts(`/api/manuscripts?book=${encodeURIComponent(split.book)}&chapter=${encodeURIComponent(split.chapter)}`)
    } catch { return null }
  }

  const onConflictAction = async (action, conflictId, path) => {
    if (!outboxAdapter) {
      setStatus('This device cannot resolve conflicts — reconnect and try again.')
      return
    }
    const id = typeof conflictId === 'string' && /^\d+$/.test(conflictId) ? Number(conflictId) : conflictId
    if (id == null || id === '') return
    const stash = conflictRecords.find(record => String(record?.id) === String(id))
    try {
      if (action === 'keep-mine') {
        setStatus('Keeping your version — grounding it on the latest server copy…')
        const server = await serverChapter(path)
        const fresh = server && typeof server.sha === 'string' && server.sha ? server.sha : null
        await resolveKeepMine(outboxAdapter, id, fresh ? { freshBaseSha: fresh } : {})
        await flushQueued()
        setStatus('Your version is grounded on the latest server copy and will publish.')
      } else if (action === 'keep-server') {
        await resolveKeepServer(outboxAdapter, id)
        await load()
        await refreshQueue()
        setStatus('Server version kept — your queued text for that chapter was dropped.')
      } else if (action === 'merge-manually') {
        if (!stash) {
          setStatus('That conflict is already resolved.')
          await refreshQueue()
          return
        }
        const server = await serverChapter(path)
        const serverText = typeof server?.content === 'string' ? server.content : ''
        const split = splitManuscriptPath(path)
        if (split) {
          const parsed = parseManuscriptContent(stash.content ?? '')
          selectedPath = path
          bookInput.value = split.book
          chapterInput.value = split.chapter
          titleInput.value = parsed.title
          bodyInput.value = parsed.body
          paint()
          repaintMentions()
        }
        const article = conflictBox?.querySelector(`[data-conflict-id="${String(id).replace(/"/g, '')}"]`)
        if (article && !article.querySelector('[data-conflict-diff]')) {
          const diff = document.createElement('div')
          diff.setAttribute('data-conflict-diff', 'true')
          diff.innerHTML = renderConflictDiff(stash.content ?? '', serverText)
          article.appendChild(diff)
        }
        setStatus('Both versions are in front of you — edit, save, and the conflict clears.')
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'That conflict could not be resolved')
    }
  }

  conflictBox?.addEventListener('click', event => {
    const button = event.target.closest('[data-conflict-action]')
    if (!button || !conflictBox.contains(button)) return
    const article = button.closest('[data-conflict-id]')
    void onConflictAction(button.dataset.conflictAction, article?.dataset.conflictId, article?.dataset.conflictPath)
  })

  document.getElementById('msNew')?.addEventListener('click', () => {
    selectedPath = null
    presence?.close()
    bookInput.value = ''
    chapterInput.value = ''
    titleInput.value = ''
    bodyInput.value = ''
    paint()
    void paintVersion(null)
    paintMeta()
    repaintMentions()
    bookInput.focus()
    setStatus('A fresh chapter — save it to keep it in the archive.')
  })

  for (const input of [titleInput, bodyInput]) input.addEventListener('input', queueAutosave)
  for (const input of [povInput, voiceInput, yearInput, eraInput]) {
    input?.addEventListener('input', writeMeta)
    input?.addEventListener('change', writeMeta)
  }

  // Wave H11a: @mention autocomplete from the gated wiki index, with the
  // linked-folios line repainted as the chapter text changes; inventories
  // attach per-member packs to entity folios (device-local, honestly labeled).
  const mentionsLine = document.getElementById('msMentions')
  let mentionLookup = new Map()
  repaintMentions = () => paintLinkedFolios(mentionsLine, bodyInput.value, mentionLookup)
  initMentionAutocomplete(bodyInput, { onChange: lookup => {
    if (lookup instanceof Map) mentionLookup = lookup
    paintLinkedFolios(mentionsLine, bodyInput.value, mentionLookup)
  } })
  bodyInput.addEventListener('input', () => paintLinkedFolios(mentionsLine, bodyInput.value, mentionLookup))
  initInventoryPanel(document.getElementById('invPanel'))
  const presence = initManuscriptPresence(list, document.getElementById('msPresenceNote'))

  form.addEventListener('submit', async event => {
    event.preventDefault()
    const payload = {
      book: bookInput.value,
      chapter: chapterInput.value,
      title: titleInput.value,
      body: bodyInput.value,
    }
    if (bodyInput.value.trim().length > MANUSCRIPT_BODY_MAX) {
      setStatus('That chapter is over the 100k character cap — trim it before saving.')
      return
    }
    // Offline: queue instead of POSTing — the save is labeled queued,
    // never presented as published.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await queueOfflineSave(payload)
      return
    }
    try {
      setStatus('Saving to the archive…')
      const data = await requestManuscripts('/api/manuscripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!data?.ok || !data?.path) throw new Error('The chapter could not be saved')
      selectedPath = data.path
      clearDraft()
      // H19 Phase 3 — a normal save of merged content spends this path's
      // conflict state; the stash and conflicted source are dropped.
      try { if (outboxAdapter) await clearPathConflicts(outboxAdapter, data.path) } catch {}
      await load()
      paint()
      await paintVersion(selectedPath)
      setStatus(`Saved to the archive · ${String(data.sha || '').slice(0, 7)}.`)
    } catch (error) {
      // The network dropped mid-save: keep it locally and say so honestly.
      if (isNetworkFailure(error)) {
        await queueOfflineSave(payload)
        return
      }
      setStatus(error instanceof Error ? error.message : 'The chapter could not be saved')
    }
  })

  document.getElementById('msDownload')?.addEventListener('click', () => {
    const content = buildManuscriptContent(titleInput.value, bodyInput.value)
    const name = selectedPath
      ? manuscriptDownloadName(selectedPath)
      : manuscriptDownloadName(`${chapterInput.value.trim() || 'chapter'}.md`)
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setStatus(`Downloaded ${name}.`)
  })

  document.getElementById('msDownloadDocx')?.addEventListener('click', () => {
    const base = (selectedPath
      ? manuscriptDownloadName(selectedPath)
      : manuscriptDownloadName(`${chapterInput.value.trim() || 'chapter'}.md`)).replace(/\.md$/, '')
    const file = `${base}.docx`
    const ok = downloadBytes(
      buildDocx(titleInput.value, bodyInput.value),
      file,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    setStatus(ok ? `Exported ${file} on this device — no server involved.` : 'Export needs this device browser — downloads are unavailable here.')
  })

  document.getElementById('msDownloadEpub')?.addEventListener('click', () => {
    const base = (selectedPath
      ? manuscriptDownloadName(selectedPath)
      : manuscriptDownloadName(`${chapterInput.value.trim() || 'chapter'}.md`)).replace(/\.md$/, '')
    const file = `${base}.epub`
    const ok = downloadBytes(
      buildEpub(titleInput.value, bodyInput.value, bookInput.value),
      file,
      'application/epub+zip',
    )
    setStatus(ok ? `Exported ${file} on this device — no server involved.` : 'Export needs this device browser — downloads are unavailable here.')
  })

  document.getElementById('msPrint')?.addEventListener('click', () => {
    const sheet = document.getElementById('printSheet')
    if (sheet) {
      const parsed = parseManuscriptContent(buildManuscriptContent(titleInput.value, bodyInput.value))
      sheet.innerHTML = `<h1>${escapeHtml(parsed.title || chapterInput.value.trim() || 'Untitled chapter')}</h1>`
        + `<p class="print-meta">${escapeHtml(bookInput.value.trim())} · World of Ge'or manuscript</p>`
        + `<div class="print-body">${escapeHtml(parsed.body)}</div>`
    }
    window.print()
  })

  await load()
  await flushQueued()
  try {
    window.addEventListener('online', () => { void flushQueued() })
  } catch {}
}

if (typeof document !== 'undefined') initManuscripts()
