const COMPASS_ID = 'georArchiveCompass'
const RECENT_KEY = 'geor_archive_trail_v1'
const BOOKMARK_KEY = 'geor_archive_bookmarks_v1'
const MAX_RECENT = 12
const MAX_BOOKMARKS = 40

if (!document.getElementById(COMPASS_ID)) {
  const commands = [
    { title: 'Keeper’s Index', subtitle: 'Search every private archive folio', url: '/search', sigil: '⌕', keywords: 'search index find lore' },
    { title: 'The Full Archive', subtitle: 'Enter the World of Ge’or wiki', url: '/wiki/', sigil: '◇', keywords: 'wiki archive lore' },
    { title: 'World Atlas', subtitle: 'Explore the world and Grimmel maps', url: '/atlas', sigil: '◎', keywords: 'map atlas grimmel world' },
    { title: 'Atlas Studio', subtitle: 'Draw shared markers, labels, and regions', url: '/map-editor', sigil: '✦', keywords: 'map editor studio draw' },
    { title: 'Species Gallery', subtitle: 'Browse the sentient peoples of Ge’or', url: '/species', sigil: '◈', keywords: 'species peoples races gallery' },
    { title: 'Battlestation', subtitle: 'Write and commit archive additions', url: '/app/', sigil: '⌬', keywords: 'app write additions workspace' },
    { title: 'Member Dashboard', subtitle: 'World ledger, activity, and settings', url: '/dashboard', sigil: '▦', keywords: 'dashboard home stats settings' },
  ]

  let wikiIndex = null
  let loadingIndex = null
  let visibleEntries = []
  let activeIndex = 0
  let returnFocus = null

  const normalizeTitle = value => String(value || '').replace(/\s+[—|-]\s+World of Ge['’]or.*$/i, '').trim()
  const safeWikiEntry = item => {
    if (!item || typeof item.title !== 'string' || typeof item.url !== 'string') return null
    try {
      const url = new URL(item.url, location.origin)
      if (url.origin !== location.origin || !url.pathname.startsWith('/wiki/')) return null
      return { title: item.title.trim().slice(0, 180), subtitle: url.pathname.replace(/^\/wiki\//, '').replace(/\/$/, '').replaceAll('/', ' › '), url: url.pathname + url.search + url.hash, sigil: '·', keywords: '' }
    } catch { return null }
  }
  const readRecent = () => {
    try {
      const value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
      if (!Array.isArray(value)) return []
      return value.map(item => {
        if (!item || typeof item.title !== 'string' || typeof item.url !== 'string') return null
        try {
          const url = new URL(item.url, location.origin)
          if (url.origin !== location.origin || !url.pathname.startsWith('/')) return null
          return { title: item.title.trim().slice(0, 180), url: url.pathname + url.search + url.hash, visitedAt: Number(item.visitedAt) || 0 }
        } catch { return null }
      }).filter(Boolean).slice(0, MAX_RECENT)
    } catch { return [] }
  }
  const saveCurrentPage = () => {
    const path = location.pathname + location.search
    if (path === '/dashboard' || path === '/dashboard.html' || path === '/admin' || path === '/admin.html') return
    const title = normalizeTitle(document.title)
    if (!title || !path.startsWith('/')) return
    try {
      const recent = [{ title, url: path, visitedAt: Date.now() }, ...readRecent().filter(item => item.url !== path)].slice(0, MAX_RECENT)
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
      window.dispatchEvent(new CustomEvent('geor:trail-updated', { detail: recent }))
    } catch {}
  }

  const readBookmarks = () => {
    try {
      const value = JSON.parse(localStorage.getItem(BOOKMARK_KEY) || '[]')
      if (!Array.isArray(value)) return []
      return value.map(item => {
        if (!item || typeof item.title !== 'string' || typeof item.url !== 'string') return null
        try {
          const url = new URL(item.url, location.origin)
          if (url.origin !== location.origin || !url.pathname.startsWith('/')) return null
          return { title: item.title.trim().slice(0, 180), url: url.pathname + url.search + url.hash, savedAt: Number(item.savedAt) || 0 }
        } catch { return null }
      }).filter(Boolean).slice(0, MAX_BOOKMARKS)
    } catch { return [] }
  }
  const isBookmarked = path => readBookmarks().some(item => item.url === path)
  const toggleBookmark = (title, path) => {
    const existing = readBookmarks()
    const next = isBookmarked(path)
      ? existing.filter(item => item.url !== path)
      : [{ title: normalizeTitle(title) || 'Archive folio', url: path, savedAt: Date.now() }, ...existing].slice(0, MAX_BOOKMARKS)
    try { localStorage.setItem(BOOKMARK_KEY, JSON.stringify(next)) } catch {}
    window.dispatchEvent(new CustomEvent('geor:bookmarks-updated', { detail: next }))
    return next.some(item => item.url === path)
  }

  const root = document.createElement('div')
  root.id = COMPASS_ID
  root.dataset.georCompass = ''
  root.innerHTML = `
    <button class="geor-compass-launcher" type="button" aria-label="Open archive compass" title="Open archive compass (Ctrl or Command + K)">
      <span aria-hidden="true">⌕</span><span>COMPASS</span><kbd>⌘K</kbd>
    </button>
    <div class="geor-compass-backdrop" hidden>
      <section class="geor-compass-panel" role="dialog" aria-modal="true" aria-labelledby="georCompassTitle">
        <header class="geor-compass-header">
          <div><p>KEEPER’S INSTRUMENT</p><h2 id="georCompassTitle">ARCHIVE COMPASS</h2></div>
          <button class="geor-compass-close" type="button" aria-label="Close archive compass">×</button>
        </header>
        <label class="geor-compass-search">
          <span aria-hidden="true">⌕</span>
          <input type="search" autocomplete="off" spellcheck="false" placeholder="Search the archive or choose a destination…" aria-controls="georCompassResults" aria-autocomplete="list">
          <kbd>ESC</kbd>
        </label>
        <p class="geor-compass-status" role="status" aria-live="polite"></p>
        <div id="georCompassResults" class="geor-compass-results" role="listbox" aria-label="Archive destinations"></div>
        <footer><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span>Private · device-local trail</span></footer>
      </section>
    </div>`
  document.body.append(root)

  const skip = document.createElement('a')
  skip.className = 'geor-skip-link'
  skip.href = '#main'
  skip.textContent = 'Skip to archive content'
  skip.addEventListener('click', event => {
    const target = document.querySelector('main, #main, [role="main"]')
    if (!target) return
    event.preventDefault(); target.tabIndex = -1; target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'start' })
  })
  document.body.prepend(skip)

  const connection = document.createElement('div')
  connection.className = 'geor-connection-status'
  connection.setAttribute('role', 'status')
  connection.setAttribute('aria-live', 'polite')
  connection.hidden = navigator.onLine
  connection.textContent = 'Archive connection lost — your device-local trail is safe.'
  document.body.append(connection)
  const updateConnection = () => {
    connection.hidden = navigator.onLine
    connection.textContent = navigator.onLine ? 'Archive connection restored.' : 'Archive connection lost — your device-local trail is safe.'
    if (navigator.onLine) { connection.hidden = false; setTimeout(() => { connection.hidden = true }, 2200) }
  }
  window.addEventListener('online', updateConnection)
  window.addEventListener('offline', updateConnection)

  const launcher = root.querySelector('.geor-compass-launcher')
  const backdrop = root.querySelector('.geor-compass-backdrop')
  const panel = root.querySelector('.geor-compass-panel')
  const closeButton = root.querySelector('.geor-compass-close')
  const input = root.querySelector('input')
  const results = root.querySelector('.geor-compass-results')
  const status = root.querySelector('.geor-compass-status')
  launcher.querySelector('kbd').textContent = /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? '⌘K' : 'Ctrl K'

  const score = (entry, query) => {
    const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    const title = entry.title.toLowerCase()
    const haystack = `${title} ${entry.subtitle || ''} ${entry.keywords || ''}`.toLowerCase()
    if (!words.every(word => haystack.includes(word))) return -1
    return (title === query ? 1000 : title.startsWith(query) ? 500 : title.includes(query) ? 240 : 0) + words.reduce((total, word) => total + (title.startsWith(word) ? 80 : title.includes(word) ? 40 : 10), 0)
  }
  const setActive = next => {
    const rows = [...results.querySelectorAll('[data-compass-index]')]
    if (!rows.length) return
    activeIndex = (next + rows.length) % rows.length
    rows.forEach((row, index) => {
      const active = index === activeIndex
      row.setAttribute('aria-selected', String(active))
      row.classList.toggle('is-active', active)
    })
    input.setAttribute('aria-activedescendant', rows[activeIndex].id)
    rows[activeIndex].scrollIntoView({ block: 'nearest' })
  }
  const openEntry = index => {
    const entry = visibleEntries[index]
    if (!entry?.url) return
    try {
      const url = new URL(entry.url, location.origin)
      if (url.origin === location.origin) location.href = url.pathname + url.search + url.hash
    } catch {}
  }
  const render = () => {
    const query = input.value.trim().toLowerCase()
    const recent = readRecent().map(item => ({ ...item, subtitle: 'Recently opened on this device', sigil: '↺', keywords: '' }))
    if (!query) {
      const seen = new Set()
      visibleEntries = [...recent, ...commands].filter(entry => !seen.has(entry.url) && seen.add(entry.url)).slice(0, 12)
      status.textContent = recent.length ? 'Recent trail and archive destinations' : 'Archive destinations'
    } else {
      const pool = [...commands, ...(wikiIndex || [])]
      visibleEntries = pool.map(entry => ({ entry, rank: score(entry, query) })).filter(item => item.rank >= 0).sort((a, b) => b.rank - a.rank || a.entry.title.localeCompare(b.entry.title)).slice(0, 18).map(item => item.entry)
      status.textContent = wikiIndex ? `${visibleEntries.length} matching destination${visibleEntries.length === 1 ? '' : 's'}` : 'Searching the main archive rooms…'
    }
    activeIndex = 0
    results.replaceChildren()
    if (!visibleEntries.length) {
      const empty = document.createElement('p')
      empty.className = 'geor-compass-empty'
      empty.textContent = wikiIndex ? 'No folio answers that description.' : 'Opening the deeper index…'
      results.append(empty)
      input.removeAttribute('aria-activedescendant')
      return
    }
    visibleEntries.forEach((entry, index) => {
      const row = document.createElement('button')
      row.type = 'button'
      row.id = `georCompassOption${index}`
      row.dataset.compassIndex = String(index)
      row.setAttribute('role', 'option')
      row.setAttribute('aria-selected', String(index === 0))
      row.className = `geor-compass-result${index === 0 ? ' is-active' : ''}`
      const sigil = document.createElement('span'); sigil.className = 'geor-compass-sigil'; sigil.ariaHidden = 'true'; sigil.textContent = entry.sigil || '·'
      const copy = document.createElement('span'); copy.className = 'geor-compass-copy'
      const title = document.createElement('strong'); title.textContent = entry.title
      const subtitle = document.createElement('small'); subtitle.textContent = entry.subtitle || 'Archive folio'
      const arrow = document.createElement('span'); arrow.className = 'geor-compass-arrow'; arrow.ariaHidden = 'true'; arrow.textContent = '→'
      copy.append(title, subtitle); row.append(sigil, copy, arrow)
      row.addEventListener('mouseenter', () => setActive(index))
      row.addEventListener('click', () => openEntry(index))
      results.append(row)
    })
    input.setAttribute('aria-activedescendant', 'georCompassOption0')
  }
  const loadWikiIndex = async () => {
    if (wikiIndex || loadingIndex) return loadingIndex
    loadingIndex = fetch('/wiki-index.json', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Index unavailable')))
      .then(data => { wikiIndex = Array.isArray(data) ? data.map(safeWikiEntry).filter(Boolean) : []; render() })
      .catch(() => { wikiIndex = []; status.textContent = 'The deeper index is temporarily unavailable' })
      .finally(() => { loadingIndex = null })
    return loadingIndex
  }
  const open = () => {
    returnFocus = document.activeElement
    backdrop.hidden = false
    document.body.classList.add('geor-compass-open')
    input.value = ''
    render()
    requestAnimationFrame(() => input.focus())
  }
  const close = () => {
    if (backdrop.hidden) return
    backdrop.hidden = true
    document.body.classList.remove('geor-compass-open')
    returnFocus?.focus?.()
  }

  launcher.addEventListener('click', open)
  closeButton.addEventListener('click', close)
  backdrop.addEventListener('mousedown', event => { if (event.target === backdrop) close() })
  input.addEventListener('input', () => { render(); if (input.value.trim().length >= 2) loadWikiIndex() })
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(activeIndex + 1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(activeIndex - 1) }
    else if (event.key === 'Enter') { event.preventDefault(); openEntry(activeIndex) }
  })
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return
    const focusable = [...panel.querySelectorAll('button:not([disabled]), input:not([disabled])')]
    if (!focusable.length) return
    const first = focusable[0], last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  })
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); backdrop.hidden ? open() : close() }
    else if (event.key === 'Escape' && !backdrop.hidden) { event.preventDefault(); close() }
  })

  saveCurrentPage()

  const path = location.pathname + location.search
  const isWikiPage = location.pathname.startsWith('/wiki/')
  if (isWikiPage) {
    const progress = document.createElement('div')
    progress.className = 'geor-reading-progress'
    progress.setAttribute('aria-hidden', 'true')
    progress.innerHTML = '<span></span>'
    document.body.prepend(progress)
    const updateProgress = () => {
      const maximum = Math.max(1, document.documentElement.scrollHeight - innerHeight)
      progress.firstElementChild.style.transform = `scaleX(${Math.min(1, Math.max(0, scrollY / maximum))})`
    }
    addEventListener('scroll', updateProgress, { passive: true }); updateProgress()

    const parts = decodeURIComponent(location.pathname).split('/').filter(Boolean).slice(1)
    const toolbar = document.createElement('nav')
    toolbar.className = 'geor-folio-toolbar'
    toolbar.setAttribute('aria-label', 'Folio tools')
    const crumb = document.createElement('div'); crumb.className = 'geor-folio-crumbs'
    const home = document.createElement('a'); home.href = '/wiki/'; home.textContent = 'Archive'; crumb.append(home)
    parts.slice(0, -1).forEach((part, index) => {
      const divider = document.createElement('span'); divider.ariaHidden = 'true'; divider.textContent = '›'
      const link = document.createElement('a'); link.href = '/wiki/' + parts.slice(0, index + 1).map(encodeURIComponent).join('/') + '/'; link.textContent = part.replaceAll('_', ' ')
      crumb.append(divider, link)
    })
    const tools = document.createElement('div'); tools.className = 'geor-folio-actions'
    const previous = document.createElement('a'); previous.className = 'geor-folio-neighbor'; previous.hidden = true; previous.textContent = '← Previous'
    const bookmark = document.createElement('button'); bookmark.type = 'button'; bookmark.className = 'geor-bookmark-button'
    const setBookmarkLabel = active => { bookmark.classList.toggle('is-saved', active); bookmark.setAttribute('aria-pressed', String(active)); bookmark.textContent = active ? '★ Saved' : '☆ Save folio' }
    setBookmarkLabel(isBookmarked(path))
    bookmark.addEventListener('click', () => setBookmarkLabel(toggleBookmark(document.title, path)))
    const next = document.createElement('a'); next.className = 'geor-folio-neighbor'; next.hidden = true; next.textContent = 'Next →'
    tools.append(previous, bookmark, next); toolbar.append(crumb, tools)
    const content = document.querySelector('main, [role="main"], .md-main')
    if (content?.parentNode) content.parentNode.insertBefore(toolbar, content)
    loadWikiIndex().then(() => {
      const entries = wikiIndex || []
      const currentIndex = entries.findIndex(item => new URL(item.url, location.origin).pathname === location.pathname)
      if (currentIndex > 0) { previous.href = entries[currentIndex - 1].url; previous.title = entries[currentIndex - 1].title; previous.hidden = false }
      if (currentIndex >= 0 && currentIndex < entries.length - 1) { next.href = entries[currentIndex + 1].url; next.title = entries[currentIndex + 1].title; next.hidden = false }
    })
  }

  window.GeorArchive = Object.freeze({ readRecent, readBookmarks, toggleBookmark })
}
