// Notebook (Wave E2) — pure helpers are exported so node --test
// can verify checklist shaping and note rendering without a browser.
// Browser rendering only runs when `document` exists.
import { escapeHtml } from './timeline.js'

// Shape one checklist row for the editor: escaped label, stable index.
export function renderChecklistItem(item, index) {
  const text = typeof item?.text === 'string' ? item.text : ''
  const done = Boolean(item?.done)
  return `<li class="flex items-center gap-2" data-check-index="${index}">`
    + `<input type="checkbox" data-check-toggle="${index}"${done ? ' checked' : ''} aria-label="Mark item done" />`
    + `<span class="flex-1 min-w-0 text-sm${done ? ' line-through text-cream/40' : ' text-cream/80'}">${escapeHtml(text)}</span>`
    + `<button type="button" data-check-remove="${index}" class="text-xs text-cream/40" aria-label="Remove item">×</button>`
    + `</li>`
}

export function renderChecklist(checklist) {
  const items = Array.isArray(checklist) ? checklist : []
  if (!items.length) return '<li class="text-xs text-cream/40">No checklist items yet.</li>'
  return items.map((item, index) => renderChecklistItem(item, index)).join('')
}

// One note in the list: escaped title/body excerpt, open-item count.
export function openChecklistCount(checklist) {
  return (Array.isArray(checklist) ? checklist : []).filter(item => !item?.done).length
}

export function renderNoteItem(note, selected) {
  const title = typeof note?.title === 'string' && note.title.trim() ? note.title : 'Untitled note'
  const excerpt = String(note?.body ?? '').slice(0, 140)
  const open = openChecklistCount(note?.checklist)
  const total = Array.isArray(note?.checklist) ? note.checklist.length : 0
  return `<button type="button" data-note-id="${Number(note?.id) || 0}" aria-pressed="${selected ? 'true' : 'false'}"`
    + ` class="w-full text-left p-4 ${selected ? 'bg-gold/10' : ''}">`
    + `<span class="block text-sm font-semibold text-cream/90 truncate">${escapeHtml(title)}</span>`
    + `<span class="block text-xs text-cream/50 mt-1 line-clamp-2">${escapeHtml(excerpt)}</span>`
    + (total ? `<span class="block text-[10px] tracking-widest text-cream/40 mt-2">${open} OF ${total} OPEN</span>` : '')
    + `</button>`
}

export function renderNoteList(notes, selectedId) {
  const list = [...(notes ?? [])]
  if (!list.length) return '<p class="p-5 text-sm text-cream/40">No notes yet — write the first one.</p>'
  return list.map(note => renderNoteItem(note, note?.id === selectedId)).join('')
}

// --- Browser rendering (never runs under node --test) -----------------------
async function requestNotes(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options })
  if (response.status === 401) {
    location.href = '/?next=' + encodeURIComponent('/notebook')
    throw new Error('Sign in to open the notebook')
  }
  if (!response.ok) throw new Error('The notebook is temporarily unavailable')
  return response.json()
}

async function initNotebook() {
  const list = document.getElementById('noteList')
  const status = document.getElementById('noteStatus')
  const count = document.getElementById('noteCount')
  const search = document.getElementById('noteSearch')
  const form = document.getElementById('noteForm')
  const titleInput = document.getElementById('noteTitle')
  const bodyInput = document.getElementById('noteBody')
  const checkList = document.getElementById('checkList')
  const checkInput = document.getElementById('checkInput')
  if (!list || !form || !titleInput || !bodyInput || !checkList) return

  let notes = []
  let selectedId = null
  let searchTimer = null

  const selected = () => notes.find(note => note?.id === selectedId) || null
  const draftChecklist = () => selected()?.checklist && Array.isArray(selected().checklist) ? [...selected().checklist] : []

  const paint = () => {
    list.innerHTML = renderNoteList(notes, selectedId)
    list.setAttribute('aria-busy', 'false')
    const note = selected()
    titleInput.value = note?.title ?? ''
    bodyInput.value = note?.body ?? ''
    checkList.innerHTML = renderChecklist(note?.checklist ?? draftNewChecklist)
    if (count) count.textContent = notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'} · private to you` : 'No notes yet'
  }

  const setStatus = message => { if (status) status.textContent = message }

  const load = async () => {
    try {
      setStatus('Opening the notebook…')
      const query = search?.value.trim() ? `?q=${encodeURIComponent(search.value.trim().slice(0, 100))}` : ''
      const data = await requestNotes(`/api/notes${query}`)
      notes = Array.isArray(data?.notes) ? data.notes : []
      if (selectedId && !notes.some(note => note?.id === selectedId)) selectedId = notes[0]?.id ?? null
      if (!selectedId) selectedId = notes[0]?.id ?? null
      paint()
      setStatus(notes.length ? '' : 'No notes yet — write the first one.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The notebook could not be opened')
    }
  }

  list.addEventListener('click', event => {
    const button = event.target.closest('[data-note-id]')
    if (!button) return
    selectedId = Number(button.dataset.noteId) || null
    paint()
    setStatus('')
  })

  document.getElementById('noteNew')?.addEventListener('click', () => {
    selectedId = null
    titleInput.value = ''
    bodyInput.value = ''
    checkList.innerHTML = renderChecklist([])
    titleInput.focus()
    setStatus('A fresh page — save it to keep it.')
  })

  search?.addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(load, 250)
  })

  const addCheckItem = () => {
    const text = checkInput.value.trim().slice(0, 200)
    if (!text) return
    const note = selected()
    if (note) note.checklist = [...(note.checklist || []), { text, done: false }]
    else draftNewChecklist.push({ text, done: false })
    checkInput.value = ''
    checkList.innerHTML = renderChecklist(note?.checklist ?? draftNewChecklist)
  }
  let draftNewChecklist = []
  document.getElementById('checkAdd')?.addEventListener('click', addCheckItem)
  checkInput?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addCheckItem() } })

  checkList.addEventListener('click', event => {
    const toggle = event.target.closest('[data-check-toggle]')
    const remove = event.target.closest('[data-check-remove]')
    if (!toggle && !remove) return
    const note = selected()
    const items = note ? [...(note.checklist || [])] : draftNewChecklist
    const index = Number((toggle || remove).dataset[toggle ? 'checkToggle' : 'checkRemove'])
    if (!Number.isInteger(index) || !items[index]) return
    if (toggle) items[index] = { ...items[index], done: !items[index].done }
    else items.splice(index, 1)
    if (note) note.checklist = items
    else draftNewChecklist = items
    checkList.innerHTML = renderChecklist(items)
  })

  checkList.addEventListener('change', event => {
    const toggle = event.target.closest('[data-check-toggle]')
    if (!toggle) return
    const note = selected()
    const items = note ? [...(note.checklist || [])] : draftNewChecklist
    const index = Number(toggle.dataset.checkToggle)
    if (!Number.isInteger(index) || !items[index]) return
    items[index] = { ...items[index], done: toggle.checked }
    if (note) note.checklist = items
    else draftNewChecklist = items
    checkList.innerHTML = renderChecklist(items)
  })

  form.addEventListener('submit', async event => {
    event.preventDefault()
    const note = selected()
    const checklist = note ? (note.checklist || []) : draftNewChecklist
    const payload = { title: titleInput.value, body: bodyInput.value, checklist }
    try {
      setStatus('Saving…')
      const data = note
        ? await requestNotes(`/api/notes/${note.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await requestNotes('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!data?.note) throw new Error('The note could not be saved')
      const saved = data.note
      const at = notes.findIndex(entry => entry?.id === saved.id)
      if (at >= 0) notes[at] = saved
      else notes.unshift(saved)
      selectedId = saved.id
      draftNewChecklist = []
      paint()
      setStatus('Saved.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The note could not be saved')
    }
  })

  document.getElementById('noteDelete')?.addEventListener('click', async () => {
    const note = selected()
    if (!note) { setStatus('Nothing selected to delete.'); return }
    if (!confirm('Delete this note?')) return
    try {
      setStatus('Deleting…')
      await requestNotes(`/api/notes/${note.id}`, { method: 'DELETE' })
      notes = notes.filter(entry => entry?.id !== note.id)
      selectedId = notes[0]?.id ?? null
      draftNewChecklist = []
      paint()
      setStatus('Deleted.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The note could not be deleted')
    }
  })

  await load()
}

if (typeof document !== 'undefined') initNotebook()
