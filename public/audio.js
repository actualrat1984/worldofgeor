// Audio Library (Wave G2) — site-wide player over the real vault audio library.
// Every track below is a real file from Ge'or Arts/Audio (see Audio Lore Library
// in the vault): nothing invented, nothing synthesized. Pure helpers are exported
// so node --test can verify the manifest, rendering, queue math, and progress
// without a browser. Browser playback only runs when `document` exists. Progress
// (last track + position) persists per member in localStorage — no new D1 table.
import { escapeHtml } from './timeline.js'

export const AUDIO_NEXT = '/audio'
export const AUDIO_PROGRESS_KEY = 'geor_audio_progress_v1'
const WIKI_AUDIO_BASE = `/wiki/${encodeURIComponent("Ge'or Arts").replace(/'/g, '%27')}/Audio/`

// Real vault manifest: 24 chapters, filenames verified against Ge'or Arts/Audio.
export const TRACKS = Object.freeze([
  { n: 1, file: '01_Glorious_Alliance.mp3', title: 'The Glorious Alliance' },
  { n: 2, file: '02_The_Shadows_Are_Born.mp3', title: 'The Shadows Are Born' },
  { n: 3, file: '03_Nethra_and_the_Ironcloak.mp3', title: 'Nethra and the Ironcloak' },
  { n: 4, file: '04_The_Demonic_War.mp3', title: 'The Demonic War' },
  { n: 5, file: '05_The_Old_Lumina_Empire.mp3', title: 'The Old Lumina Empire' },
  { n: 6, file: '06_The_Great_Divergence.mp3', title: 'The Great Divergence' },
  { n: 7, file: '07_The_Long_Manipulation.mp3', title: 'The Long Manipulation' },
  { n: 8, file: '08_Xiumi_and_the_Glorious_Alliance.mp3', title: 'Xiumi and the Glorious Alliance' },
  { n: 9, file: '09_The_Black_Agent.mp3', title: 'The Black Agent' },
  { n: 10, file: '10_Kirivis_The_Hero_No_One_Knew.mp3', title: 'Kirivis, the Hero No One Knew' },
  { n: 11, file: '11_The_Long_Manipulation.mp3', title: 'The Long Manipulation' },
  { n: 12, file: '12_The_Eris_Fabrication.mp3', title: 'The Eris Fabrication' },
  { n: 13, file: '13_Age_12_What_Comes_Next.mp3', title: 'Age 12: What Comes Next' },
  { n: 14, file: '14_The_Dragon_Tyranny.mp3', title: 'The Dragon Tyranny' },
  { n: 15, file: '15_The_Dwarf_Era.mp3', title: 'The Dwarf Era' },
  { n: 16, file: '16_The_Elvish_Age_and_the_Hybrian_Crash.mp3', title: 'The Elvish Age and the Hybrian Crash' },
  { n: 17, file: '17_The_Kutten_Catastrophe_and_the_Elvish_Diaspora.mp3', title: 'The Kutten Catastrophe and the Elvish Diaspora' },
  { n: 18, file: '18_The_Age_of_Baoth.mp3', title: 'The Age of Baoth' },
  { n: 19, file: '19_The_Lost_Era.mp3', title: 'The Lost Era' },
  { n: 20, file: '20_The_Erisian_Era.mp3', title: 'The Erisian Era' },
  { n: 21, file: '21_The_Age_of_Divergence.mp3', title: 'The Age of Divergence' },
  { n: 22, file: '22_The_Age_of_Nomadism.mp3', title: 'The Age of Nomadism' },
  { n: 23, file: '23_The_First_Tribes.mp3', title: 'The First Tribes' },
  { n: 24, file: '24_The_First_Empires.mp3', title: 'The First Empires' },
])

export function trackSrc(track) {
  return typeof track?.file === 'string' && track.file ? WIKI_AUDIO_BASE + track.file : null
}

export function trackLabel(track) {
  const n = Number.isSafeInteger(track?.n) ? String(track.n).padStart(2, '0') : '??'
  const title = typeof track?.title === 'string' && track.title ? track.title : 'Untitled chapter'
  return `${n} — ${title}`
}

export function trackIndexOf(tracks, file) {
  const list = Array.isArray(tracks) ? tracks : []
  return list.findIndex(track => track?.file === file)
}

export function nextIndex(index, total) {
  if (!Number.isSafeInteger(total) || total <= 0) return -1
  if (!Number.isSafeInteger(index) || index < 0 || index >= total) return 0
  return (index + 1) % total
}

export function prevIndex(index, total) {
  if (!Number.isSafeInteger(total) || total <= 0) return -1
  if (!Number.isSafeInteger(index) || index < 0 || index >= total) return 0
  return (index - 1 + total) % total
}

export function renderTrackList(tracks, currentFile) {
  const list = Array.isArray(tracks) ? tracks : []
  if (!list.length) return '<p class="p-5 text-sm text-cream/40">No chapters in the library yet.</p>'
  return '<ol class="grid gap-2">' + list.map((track, index) => {
    const active = track?.file === currentFile
    const label = trackLabel(track)
    return `<li><button type="button" data-track="${escapeHtml(track?.file ?? '')}" data-index="${index}" aria-current="${active ? 'true' : 'false'}"`
      + ` class="w-full text-left rounded-lg border px-4 py-3 ${active ? 'border-gold/60 bg-gold/10' : 'border-gold/10'}">`
      + `<span class="block text-sm font-semibold ${active ? 'text-gold' : 'text-cream/90'}">${escapeHtml(label)}</span>`
      + `<span class="block text-[10px] tracking-widest text-cream/40 mt-1">${active ? 'NOW PLAYING' : `CHAPTER ${index + 1} OF ${list.length}`}</span>`
      + `</button></li>`
  }).join('') + '</ol>'
}

export function renderNowPlaying(track, index, total) {
  if (!track) return 'Choose a chapter below.'
  const position = Number.isSafeInteger(index) && Number.isSafeInteger(total) && total > 0
    ? ` · chapter ${index + 1} of ${total}` : ''
  return `${trackLabel(track)}${position}`
}

// --- Progress (localStorage, per member device) ------------------------------
export function sanitizeProgress(value) {
  if (!value || typeof value !== 'object') return null
  const { file, time } = value
  if (typeof file !== 'string' || !file.endsWith('.mp3') || file.includes('/') || file.includes('\\') || file.includes('..')) return null
  const seconds = Number(time)
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 24 * 3600) return null
  return { file, time: seconds }
}

export function readProgress(store) {
  try {
    const raw = store?.getItem?.(AUDIO_PROGRESS_KEY)
    if (!raw) return null
    const saved = sanitizeProgress(JSON.parse(raw))
    if (!saved) return null
    return trackIndexOf(TRACKS, saved.file) === -1 ? null : saved
  } catch { return null }
}

export function writeProgress(store, file, time) {
  const clean = sanitizeProgress({ file, time })
  if (!clean) return false
  try {
    store?.setItem?.(AUDIO_PROGRESS_KEY, JSON.stringify({ ...clean, at: Date.now() }))
    return true
  } catch { return false }
}

// --- Browser -----------------------------------------------------------------
function store() {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

async function requireMember() {
  const response = await fetch('/api/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
  if (response.status === 401) {
    location.href = `/?next=${encodeURIComponent(AUDIO_NEXT)}`
    return false
  }
  if (!response.ok) throw new Error(`The library answered ${response.status}.`)
  return true
}

if (typeof document !== 'undefined') {
  const count = document.getElementById('audioCount')
  const status = document.getElementById('audioStatus')
  const list = document.getElementById('trackList')
  const now = document.getElementById('nowPlaying')
  const position = document.getElementById('audioPosition')
  const player = document.getElementById('player')
  const prev = document.getElementById('audioPrev')
  const next = document.getElementById('audioNext')
  const say = message => { if (status) status.textContent = message }

  let current = -1
  let lastSave = 0

  const paint = () => {
    if (list) {
      list.setAttribute('aria-busy', 'false')
      list.innerHTML = renderTrackList(TRACKS, current === -1 ? null : TRACKS[current]?.file)
    }
    const track = current === -1 ? null : TRACKS[current]
    if (now) now.textContent = renderNowPlaying(track, current, TRACKS.length)
    if (position) position.textContent = track ? `CHAPTER ${current + 1} / ${TRACKS.length}` : ''
    if (count) count.textContent = `${TRACKS.length} chapters in the vault library`
  }

  const play = index => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= TRACKS.length) return
    current = index
    const track = TRACKS[current]
    player.src = trackSrc(track)
    paint()
    say(`Playing ${trackLabel(track)}…`)
    player.play().catch(() => say(`Ready: ${trackLabel(track)} — press play.`))
  }

  requireMember().then(ok => {
    if (!ok) return
    const saved = readProgress(store())
    paint()
    if (saved) {
      const index = trackIndexOf(TRACKS, saved.file)
      current = index
      const track = TRACKS[current]
      player.src = trackSrc(track)
      paint()
      const resume = () => { try { if (saved.time > 1) player.currentTime = saved.time } catch {} }
      if (player.readyState >= 1) resume()
      else player.addEventListener('loadedmetadata', resume, { once: true })
      say(`Welcome back — ${trackLabel(track)} resumes where you left it. Press play.`)
    } else {
      say(`${TRACKS.length} chapters ready. Choose one to begin.`)
    }
  }).catch(error => {
    paint()
    say(error?.message || 'The library could not be opened.')
  })

  list?.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-index]')
    if (!button) return
    play(Number(button.dataset.index))
  })
  prev?.addEventListener('click', () => play(prevIndex(current, TRACKS.length)))
  next?.addEventListener('click', () => play(nextIndex(current, TRACKS.length)))
  player?.addEventListener('ended', () => play(nextIndex(current, TRACKS.length)))
  player?.addEventListener('timeupdate', () => {
    const elapsed = Date.now() - lastSave
    if (elapsed < 5000 || current === -1) return
    lastSave = Date.now()
    try { writeProgress(store(), TRACKS[current].file, player.currentTime || 0) } catch {}
  })
  player?.addEventListener('pause', () => {
    if (current === -1) return
    try { writeProgress(store(), TRACKS[current].file, player.currentTime || 0) } catch {}
  })
  player?.addEventListener('error', () => {
    say('That chapter could not be played — try the next one.')
  })
}
