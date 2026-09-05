import { kindBadge, mergeExtra } from './search-sources.js'

const input = document.getElementById('archiveSearch')
const results = document.getElementById('searchResults')
const status = document.getElementById('searchStatus')
const empty = document.getElementById('searchEmpty')
const recentSection = document.getElementById('recentSection')
const recentEl = document.getElementById('recentSearches')
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char])
let index = []
let extraIndex = []
let activeFilter = 'all'
let selected = -1
let visibleResults = []
let timer = null
let syncedBookmarks = new Set()

function categoryFor(url) {
  if (url === '/timeline') return 'History'
  const parts = url.split('/').filter(Boolean)
  if (parts.includes('Nations')) return 'Nations'
  if (parts.includes('Species') || parts.includes('Races')) return 'Species'
  if (parts.includes('History') || parts.includes('Timeline') || parts.includes('Ages')) return 'History'
  if (parts.includes('Systems')) return 'Systems'
  if (parts.includes('Locations') || parts.includes('Continents') || parts.includes('Seas')) return 'Locations'
  return parts[2] || 'Archive'
}
function tokens(value) { return value.toLowerCase().normalize('NFKD').replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(Boolean) }
function scoreEntry(entry, query) {
  const title = entry.title.toLowerCase(); const path = decodeURIComponent(entry.url).toLowerCase(); const words = tokens(query)
  if (!words.length) return 0
  let score = title === query ? 1000 : title.startsWith(query) ? 600 : title.includes(query) ? 350 : 0
  for (const word of words) { if (title === word) score += 220; else if (title.startsWith(word)) score += 140; else if (title.includes(word)) score += 80; if (path.includes(word)) score += 25; else return -1 }
  return score - title.length / 100
}
function highlight(title, query) {
  const words = tokens(query).sort((a,b) => b.length-a.length).slice(0,5)
  if (!words.length) return escapeHtml(title)
  const pattern = new RegExp(`(${words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})`, 'ig')
  return escapeHtml(title).replace(pattern, '<mark>$1</mark>')
}
function saveRecent(query) {
  const clean = query.trim(); if (clean.length < 2) return
  const recent = [clean, ...readRecent().filter(item => item.toLowerCase() !== clean.toLowerCase())].slice(0,6)
  localStorage.setItem('geor_recent_searches', JSON.stringify(recent)); renderRecent()
}
function readRecent() { try { const value = JSON.parse(localStorage.getItem('geor_recent_searches') || '[]'); return Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0,6) : [] } catch { return [] } }
function renderRecent() {
  const recent = readRecent(); recentSection.classList.toggle('hidden', !recent.length || input.value.trim().length > 0)
  recentEl.innerHTML = recent.map(item => `<button type="button" class="rounded-full border border-gold/15 bg-cream/[.025] px-3 py-2 text-xs text-cream/65 hover:border-gold/35" data-recent="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('')
  recentEl.querySelectorAll('[data-recent]').forEach(button => button.addEventListener('click', () => { input.value = button.dataset.recent; runSearch(); input.focus() }))
}
function setSelected(next) {
  const rows = [...results.querySelectorAll('[data-result]')]
  if (!rows.length) return
  selected = (next + rows.length) % rows.length
  rows.forEach((row, i) => row.setAttribute('aria-selected', String(i === selected)))
  rows[selected].scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
}
function renderSearch(query) {
  const normalized = query.trim().toLowerCase(); selected = -1
  const bookmarks = new Set([...syncedBookmarks, ...(()=>{ try { const value=JSON.parse(localStorage.getItem('geor_archive_bookmarks_v1')||'[]'); return Array.isArray(value)?value.map(item=>item?.url).filter(Boolean):[] } catch { return [] } })()])
  if (normalized.length < 2 && activeFilter !== 'saved') { visibleResults = []; results.innerHTML = ''; empty.classList.add('hidden'); status.textContent = `${(index.length + extraIndex.length).toLocaleString()} entries ready`; renderRecent(); return }
  visibleResults = [...index.map(entry => ({ ...entry, category: categoryFor(entry.url), score: normalized.length >= 2 ? scoreEntry(entry, normalized) : 0 })), ...mergeExtra(index, extraIndex, normalized).map(entry => ({ ...entry, category: categoryFor(entry.url) }))].filter(entry => entry.score >= 0 && (activeFilter === 'all' || activeFilter === 'saved' ? activeFilter !== 'saved' || bookmarks.has(entry.url) : entry.category === activeFilter)).sort((a,b) => b.score-a.score || a.title.localeCompare(b.title)).slice(0,60)
  status.textContent = `${visibleResults.length}${visibleResults.length === 60 ? '+' : ''} result${visibleResults.length === 1 ? '' : 's'}`
  empty.classList.toggle('hidden', visibleResults.length > 0); recentSection.classList.add('hidden')
  results.innerHTML = visibleResults.map((entry, i) => `<a data-result="${i}" aria-selected="false" href="${escapeHtml(entry.url)}" class="result-row group grid sm:grid-cols-[1fr_auto] gap-2 rounded-xl border border-gold/10 bg-cream/[.025] p-4 hover:border-gold/35 transition"><div class="min-w-0"><div class="flex items-center gap-2"><span class="text-[9px] tracking-[.2em] text-gold">${escapeHtml(entry.category.toUpperCase())}</span>${entry.kind ? `<span class=\"text-[9px] tracking-[.2em] text-cream/60 border border-gold/20 rounded-full px-2 py-0.5\">${escapeHtml(kindBadge(entry.kind))}</span>` : ''}</div><h2 class="font-display text-base mt-1">${highlight(entry.title, normalized)}</h2><p class="archive-path text-xs text-cream/60 mt-1"><span>${escapeHtml(decodeURIComponent(entry.url).replace(/^\/wiki\//,'').replace(/\/$/, '').replaceAll('/',' › '))}</span></p></div><span class="self-center text-gold group-hover:translate-x-1 transition" aria-hidden="true">→</span></a>`).join('')
  results.querySelectorAll('[data-result]').forEach(row => row.addEventListener('click', () => saveRecent(query)))
}
function runSearch() { clearTimeout(timer); timer = setTimeout(() => { const query = input.value; const url = new URL(location.href); query.trim() ? url.searchParams.set('q', query.trim()) : url.searchParams.delete('q'); history.replaceState(null,'',url); renderSearch(query) }, 70) }

input.addEventListener('input', runSearch)
input.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(selected + 1) } else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(selected - 1) } else if (event.key === 'Enter' && selected >= 0) { event.preventDefault(); saveRecent(input.value); location.href = visibleResults[selected].url } else if (event.key === 'Escape') { input.value = ''; runSearch() } })
document.addEventListener('keydown', event => { if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { event.preventDefault(); input.focus() } })
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { activeFilter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); renderSearch(input.value) }))
window.addEventListener('geor:bookmarks-updated', () => { if (activeFilter === 'saved') renderSearch(input.value) })
window.addEventListener('geor:archive-synced', event => { syncedBookmarks = new Set((event.detail?.saved || []).map(item => item.path)); if (activeFilter === 'saved') renderSearch(input.value) })
document.getElementById('clearRecent').addEventListener('click', () => { localStorage.removeItem('geor_recent_searches'); renderRecent() })

try {
  results.innerHTML = Array.from({length:4},()=>'<div class="skel h-20 rounded-xl"></div>').join('')
  const response = await fetch('/wiki-index.json', { credentials:'same-origin' })
  if (response.status === 401) { location.href='/?next='+encodeURIComponent('/search'); throw new Error('Authentication required') }
  if (!response.ok) throw new Error('The index could not be opened')
  const data = await response.json(); index = Array.isArray(data) ? data.filter(item => item && typeof item.title === 'string' && typeof item.url === 'string') : []
  try { const extraResponse = await fetch('/wiki/search-extra-index.json', { credentials:'same-origin' }); if (extraResponse.ok) { const extraData = await extraResponse.json(); extraIndex = Array.isArray(extraData) ? extraData.filter(item => item && typeof item.title === 'string' && typeof item.url === 'string') : [] } } catch { extraIndex = [] }
  fetch('/api/archive-state',{credentials:'same-origin'}).then(response=>response.ok?response.json():null).then(data=>{ if(data){ syncedBookmarks=new Set((data.saved||[]).map(item=>item.path)); if(activeFilter==='saved') renderSearch(input.value) } }).catch(()=>{})
  input.value = new URLSearchParams(location.search).get('q') || ''; results.innerHTML = ''; renderRecent(); renderSearch(input.value); input.focus({preventScroll:true})
} catch (error) { results.innerHTML = `<div class="rounded-xl border border-red-400/20 bg-red-400/5 p-5 text-sm text-red-200">${escapeHtml(error.message)}</div>`; status.textContent='Index unavailable' }
