// Manuscripts (Wave E1) — pure helpers are exported so node --test
// can verify path shaping, content building, and list rendering
// without a browser. Browser rendering only runs when `document` exists.
import { escapeHtml } from './timeline.js'
import { initMentionAutocomplete, paintLinkedFolios } from './mentions.js'
import { initInventoryPanel } from './inventory.js'
import { initManuscriptPresence } from './manuscript-presence.js'
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

export function renderManuscriptItem(file, selected) {
  const path = String(file?.path ?? '')
  const split = splitManuscriptPath(path) || { book: 'BOOK', chapter: path }
  return `<button type="button" data-manuscript-path="${escapeHtml(path)}" aria-pressed="${selected ? 'true' : 'false'}"`
    + ` class="w-full text-left p-4 ${selected ? 'bg-gold/10' : ''}">`
    + `<span class="block text-sm font-semibold text-cream/90 truncate">${escapeHtml(split.chapter)}</span>`
    + `<span class="block text-[10px] tracking-widest text-cream/40 mt-1">${escapeHtml(String(split.book).toUpperCase())}</span>`
    + `</button>`
}

export function renderManuscriptList(files, selectedPath) {
  const list = [...(files ?? [])].sort((a, b) => String(a?.path ?? '').localeCompare(String(b?.path ?? '')))
  if (!list.length) return '<p class="p-5 text-sm text-cream/40">No chapters yet — start the first one.</p>'
  return list.map(file => renderManuscriptItem(file, file?.path === selectedPath)).join('')
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

  const setStatus = message => { if (status) status.textContent = message }
  const draftKey = () => selectedPath
    ? manuscriptDraftKey(selectedPath)
    : `geor:manuscript-draft:new:${bookInput.value.trim()}/${chapterInput.value.trim()}`
  const readDraft = () => { try { return localStorage.getItem(draftKey()) } catch { return null } }
  const writeDraft = value => { try { localStorage.setItem(draftKey(), value) } catch {} }
  const clearDraft = () => { try { localStorage.removeItem(draftKey()) } catch {} }

  const paint = () => {
    list.innerHTML = renderManuscriptList(files, selectedPath)
    list.setAttribute('aria-busy', 'false')
    const books = new Set(files.map(file => splitManuscriptPath(file?.path)?.book).filter(Boolean))
    if (count) count.textContent = files.length
      ? `${files.length} chapter${files.length === 1 ? '' : 's'} · ${books.size} book${books.size === 1 ? '' : 's'} · kept in the archive`
      : 'No chapters yet'
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
      await load()
      paint()
      await paintVersion(selectedPath)
      setStatus(`Saved to the archive · ${String(data.sha || '').slice(0, 7)}.`)
    } catch (error) {
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
}

if (typeof document !== 'undefined') initManuscripts()
