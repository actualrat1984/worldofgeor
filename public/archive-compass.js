const COMPASS_ID = 'georArchiveCompass'
const RECENT_KEY = 'geor_archive_trail_v1'
const BOOKMARK_KEY = 'geor_archive_bookmarks_v1'
const MIGRATION_KEY = 'geor_archive_sync_v1'
const MAX_RECENT = 20
const MAX_BOOKMARKS = 50

if (!document.getElementById(COMPASS_ID)) {
  if (location.pathname.startsWith('/app')) document.body.classList.add('geor-workroom')
  if (location.pathname.startsWith('/map-editor')) document.body.classList.add('geor-no-shell-offset')
  const commands = [
    { title: 'Member Home', subtitle: 'Your trail, collections, and new archive activity', url: '/dashboard', sigil: '▦', group: 'ROOM', keywords: 'dashboard home recent new activity' },
    { title: 'Keeper’s Index', subtitle: 'Search every private archive folio', url: '/search', sigil: '⌕', group: 'ROOM', keywords: 'search index find lore omnibox' },
    { title: 'The Full Archive', subtitle: 'Enter the World of Ge’or wiki', url: '/wiki/', sigil: '◇', group: 'ROOM', keywords: 'wiki archive lore read' },
    { title: 'World Atlas', subtitle: 'Explore the world and Grimmel maps', url: '/atlas', sigil: '◎', group: 'ROOM', keywords: 'map atlas grimmel world' },
    { title: 'Atlas Studio', subtitle: 'Draw markers, labels, and regions', url: '/map-editor', sigil: '✦', group: 'CREATE', keywords: 'map editor studio draw workflow' },
    { title: 'Species Gallery', subtitle: 'Browse the sentient peoples of Ge’or', url: '/species', sigil: '◈', group: 'ROOM', keywords: 'species peoples races gallery' },
    { title: 'Timeline of the Ages', subtitle: 'Walk all thirteen ages, event by event', url: '/timeline', sigil: '◷', group: 'ROOM', keywords: 'timeline ages history events dates bgd agd chronicle' },
    { title: 'Ge’orian Calendar', subtitle: 'Twelve months, twelve festivals, and the BGD/AGD converter', url: '/calendar', sigil: '☾', group: 'ROOM', keywords: 'calendar months festivals converter bgd agd year earth' },
    { title: 'Gazetteer of Nations', subtitle: 'Sort and filter every nation of Ge’or', url: '/gazetteer', sigil: '❈', group: 'ROOM', keywords: 'gazetteer nations regions geography index' },
    { title: 'Chronicles', subtitle: 'Scrub the timeline and fly the atlas', url: '/chronicles', sigil: '❖', group: 'ROOM', keywords: 'chronicles scrub map fly events timeline atlas' },
    { title: 'Family Trees', subtitle: 'Trace every named bloodline of Ge’or', url: '/trees', sigil: '❦', group: 'ROOM', keywords: 'family trees houses bloodlines pedigree genealogy' },
    { title: 'Notebook', subtitle: 'Keep quick notes and checklists', url: '/notebook', sigil: '✎', group: 'ROOM', keywords: 'notebook notes checklist memo write' },
    { title: 'Manuscripts', subtitle: 'Draft chapters and scenes for the archive', url: '/manuscripts', sigil: '✒', group: 'ROOM', keywords: 'manuscripts books chapters scenes draft write' },
    { title: 'Guided Entry', subtitle: 'File a character, deity, or race as vault-shaped markdown', url: '/entry', sigil: '❏', group: 'ROOM', keywords: 'entry guided form character deity race markdown draft download' },
    { title: 'Session Recaps', subtitle: 'Log play sessions, link the cast, pin the date', url: '/recaps', sigil: '❐', group: 'ROOM', keywords: 'recaps sessions log entries timeline calendar entities play' },
    { title: 'Review Queue', subtitle: 'Submit drafts, approve canon, publish additions', url: '/review', sigil: '☰', group: 'ROOM', keywords: 'review queue workflow draft approved publish canon additions' },
    { title: 'Whiteboards', subtitle: 'Plot schemes on an infinite canvas', url: '/boards', sigil: '▦', group: 'ROOM', keywords: 'whiteboard boards canvas cards arrows plot scheme' },
    { title: 'Story Arcs', subtitle: 'Chart master plots, subplots, and open threads', url: '/arcs', sigil: '✧', group: 'ROOM', keywords: 'story arcs plots subplots threads master tree' },
    { title: 'Quest Board', subtitle: 'Read every open contract, arc by arc', url: '/quests', sigil: '❧', group: 'ROOM', keywords: 'quests board contracts guild threads arcs settled' },
    { title: 'System Statblocks', subtitle: 'Magic ranks, species traits, and currencies as game blocks', url: '/statblocks', sigil: '⚖', group: 'ROOM', keywords: 'statblocks systems magic ranks species traits currencies homebrew blocks' },
    { title: 'Reader’s Primer', subtitle: 'See what Arcady may know — sealed and opened', url: '/primer', sigil: '◐', group: 'ROOM', keywords: 'primer reader spoilers secrets revealed seals reading' },
    { title: 'Author’s Desk', subtitle: 'Notes, arcs, ages, and seals in one command view', url: '/desk', sigil: '✍', group: 'ROOM', keywords: 'desk author command notes arcs timeline primer status' },
    { title: 'Audio Library', subtitle: 'Hear the story of Ge’or, chapter by chapter', url: '/audio', sigil: '♪', group: 'ROOM', keywords: 'audio music listen lore chapters voice library player' },
    { title: 'Diplomacy Webs', subtitle: 'Trace every pact and rivalry of Ge’or', url: '/webs', sigil: '🕸', group: 'ROOM', keywords: 'diplomacy webs factions relations allies rivals war pacts' },
    { title: 'Relation Graph', subtitle: 'See every faction bond of Ge’or in one web', url: '/graph', sigil: '◈', group: 'ROOM', keywords: 'graph relations factions edges bonds network explorer' },
    { title: 'Character Gallery', subtitle: 'Browse every named soul of Ge’or', url: '/gallery', sigil: '◍', group: 'ROOM', keywords: 'characters gallery houses species nations people' },
    { title: 'Prompt Oracle', subtitle: 'Roll character, place, and conflict omens', url: '/oracle', sigil: '⚄', group: 'ROOM', keywords: 'oracle prompt roll random character place conflict tags omen' },
    { title: 'Battlestation', subtitle: 'Draft, review, and publish archive additions', url: '/app/', sigil: '⌬', group: 'CREATE', keywords: 'app write additions workspace workflow' },
  ]
  const normalizeTitle = value => String(value || '').replace(/\s+[—|-]\s+World of Ge['’]or.*$/i, '').trim()
  const safeLocalPath = value => { try { const url = new URL(value, location.origin); return url.origin === location.origin && url.pathname.startsWith('/') ? url.pathname + url.search + url.hash : null } catch { return null } }
  const readList = (key, limit) => { try { const value = JSON.parse(localStorage.getItem(key) || '[]'); if (!Array.isArray(value)) return []; return value.map(item => { const url = safeLocalPath(item?.url); return url && typeof item?.title === 'string' ? { ...item, title: item.title.trim().slice(0, 180), url } : null }).filter(Boolean).slice(0, limit) } catch { return [] } }
  const writeList = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} }
  const postState = payload => fetch('/api/archive-state', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(response => response.ok ? response.json() : null).catch(() => null)
  const readRecent = () => readList(RECENT_KEY, MAX_RECENT)
  const readBookmarks = () => readList(BOOKMARK_KEY, MAX_BOOKMARKS)
  const isBookmarked = path => readBookmarks().some(item => item.url === path)
  const kindForPath = path => path.startsWith('/atlas') || path.startsWith('/map-editor') ? 'atlas' : path.startsWith('/species') ? 'species' : path.startsWith('/app') ? 'workspace' : 'folio'
  const saveCurrentPage = () => {
    const path = location.pathname + location.search
    if (['/dashboard', '/dashboard.html', '/admin', '/admin.html'].includes(path)) return
    const title = normalizeTitle(document.title)
    if (!title || !path.startsWith('/')) return
    const recent = [{ title, url: path, visitedAt: Date.now() }, ...readRecent().filter(item => item.url !== path)].slice(0, MAX_RECENT)
    writeList(RECENT_KEY, recent); window.dispatchEvent(new CustomEvent('geor:trail-updated', { detail: recent }))
    postState({ action: 'visit', path, title, kind: kindForPath(path), progress: 0 })
  }
  const toggleBookmark = (title, path) => {
    const existing = readBookmarks(); const active = isBookmarked(path)
    const next = active ? existing.filter(item => item.url !== path) : [{ title: normalizeTitle(title) || 'Archive folio', url: path, savedAt: Date.now() }, ...existing].slice(0, MAX_BOOKMARKS)
    writeList(BOOKMARK_KEY, next); window.dispatchEvent(new CustomEvent('geor:bookmarks-updated', { detail: next }))
    postState({ action: active ? 'unsave' : 'save', path, title: normalizeTitle(title) || 'Archive folio', kind: kindForPath(path), saved: !active })
    return !active
  }
  const safeWikiEntry = item => { const url = safeLocalPath(item?.url); if (!url || !url.startsWith('/wiki/') || typeof item?.title !== 'string') return null; return { title: item.title.trim().slice(0, 180), subtitle: decodeURIComponent(url).replace(/^\/wiki\//, '').replace(/\/$/, '').replaceAll('/', ' › '), url, sigil: '·', group: 'FOLIO', keywords: '' } }

  let wikiIndex = null, loadingIndex = null, visibleEntries = [], activeIndex = 0, returnFocus = null, selectedFilter = 'all'
  let serverState = { recent: [], saved: [], unseen: [] }
  let contextPanel = null, splitPanel = null

  const root = document.createElement('div')
  root.id = COMPASS_ID; root.dataset.georCompass = ''
  root.innerHTML = `
    <aside class="geor-archive-rail" aria-label="Private archive rooms">
      <a class="geor-rail-mark" href="/dashboard" aria-label="World of Ge’or member home"><span>G</span></a>
      <nav>
        <a href="/dashboard" data-route="/dashboard" title="Member Home"><span>▦</span><b>Home</b><i class="geor-new-badge" hidden>0</i></a>
        <button type="button" data-open-compass title="Search"><span>⌕</span><b>Search</b></button>
        <a href="/wiki/" data-route="/wiki/" title="Archive"><span>◇</span><b>Archive</b></a>
        <a href="/atlas" data-route="/atlas" title="Atlas"><span>◎</span><b>Atlas</b></a>
        <a href="/app/" data-route="/app/" title="Create"><span>⌬</span><b>Create</b></a>
      </nav>
      <button class="geor-rail-account" type="button" title="Archive account"><span>◉</span><b>Account</b></button>
    </aside>
    <nav class="geor-mobile-dock" aria-label="Archive navigation">
      <a href="/dashboard" data-route="/dashboard"><span>▦</span><b>Home</b><i class="geor-new-badge" hidden>0</i></a>
      <button type="button" data-open-compass><span>⌕</span><b>Search</b></button>
      <a href="/wiki/" data-route="/wiki/"><span>◇</span><b>Read</b></a>
      <a href="/atlas" data-route="/atlas"><span>◎</span><b>Atlas</b></a>
      <a href="/app/" data-route="/app/"><span>⌬</span><b>Create</b></a>
    </nav>
    <button class="geor-compass-launcher" type="button" data-open-compass aria-label="Open archive compass" title="Open archive compass (Ctrl or Command + K)"><span>⌕</span><span>COMPASS</span><kbd>⌘K</kbd></button>
    <div class="geor-account-popover" hidden><p>ARCHIVE MEMBER</p><strong data-account-email>Signed in</strong><a href="/dashboard">Open member home</a><button type="button" data-mark-seen>Mark activity as seen</button></div>
    <div class="geor-compass-backdrop" hidden>
      <section class="geor-compass-panel" role="dialog" aria-modal="true" aria-labelledby="georCompassTitle">
        <header class="geor-compass-header"><div><p>KEEPER’S INSTRUMENT</p><h2 id="georCompassTitle">ARCHIVE OMNIBOX</h2></div><button class="geor-compass-close" type="button" aria-label="Close archive compass">×</button></header>
        <label class="geor-compass-search"><span>⌕</span><input type="search" autocomplete="off" spellcheck="false" placeholder="Search lore, maps, saved folios, or type &gt; for commands…" aria-controls="georCompassResults" aria-autocomplete="list"><kbd>ESC</kbd></label>
        <div class="geor-compass-filters" role="group" aria-label="Search scope"><button data-filter="all" aria-pressed="true">Everything</button><button data-filter="wiki" aria-pressed="false">Lore</button><button data-filter="saved" aria-pressed="false">Saved</button><button data-filter="rooms" aria-pressed="false">Rooms</button></div>
        <p class="geor-compass-status" role="status" aria-live="polite"></p>
        <div id="georCompassResults" class="geor-compass-results" role="listbox" aria-label="Archive destinations"></div>
        <footer><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span>Private archive · synced collections</span></footer>
      </section>
    </div>`
  document.body.append(root)

  const skip = document.createElement('a'); skip.className = 'geor-skip-link'; skip.href = '#main'; skip.textContent = 'Skip to archive content'
  skip.addEventListener('click', event => { const target = document.querySelector('main, #main, [role="main"]'); if (!target) return; event.preventDefault(); target.tabIndex = -1; target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'start' }) }); document.body.prepend(skip)
  const connection = document.createElement('div'); connection.className = 'geor-connection-status'; connection.setAttribute('role', 'status'); connection.setAttribute('aria-live', 'polite'); connection.hidden = navigator.onLine; connection.textContent = 'Archive connection lost — your local trail remains available.'; document.body.append(connection)
  const updateConnection = () => { connection.hidden = false; connection.textContent = navigator.onLine ? 'Archive connection restored.' : 'Archive connection lost — your local trail remains available.'; if (navigator.onLine) setTimeout(() => { connection.hidden = true }, 2200) }
  window.addEventListener('online', updateConnection); window.addEventListener('offline', updateConnection)

  const backdrop = root.querySelector('.geor-compass-backdrop'), panel = root.querySelector('.geor-compass-panel'), closeButton = root.querySelector('.geor-compass-close'), input = root.querySelector('.geor-compass-search input'), results = root.querySelector('.geor-compass-results'), status = root.querySelector('.geor-compass-status')
  root.querySelector('.geor-compass-launcher kbd').textContent = /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? '⌘K' : 'Ctrl K'
  root.querySelectorAll('[data-route]').forEach(link => { const route = link.dataset.route; if (location.pathname === route || (route !== '/' && location.pathname.startsWith(route))) { link.classList.add('is-current'); link.setAttribute('aria-current', 'page') } })
  const loadWikiIndex = async () => {
    if (wikiIndex || loadingIndex) return loadingIndex
    loadingIndex = fetch('/wiki-index.json', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(response => response.ok ? response.json() : Promise.reject(new Error('Index unavailable'))).then(data => { wikiIndex = Array.isArray(data) ? data.map(safeWikiEntry).filter(Boolean) : []; render(); return wikiIndex }).catch(() => { wikiIndex = []; status.textContent = 'The deeper index is temporarily unavailable'; return wikiIndex }).finally(() => { loadingIndex = null })
    return loadingIndex
  }
  const score = (entry, query) => { const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); const title = entry.title.toLowerCase(), haystack = `${title} ${entry.subtitle || ''} ${entry.keywords || ''}`.toLowerCase(); if (!words.every(word => haystack.includes(word))) return -1; return (title === query ? 1000 : title.startsWith(query) ? 500 : title.includes(query) ? 240 : 0) + words.reduce((total, word) => total + (title.startsWith(word) ? 80 : title.includes(word) ? 40 : 10), 0) }
  const setActive = next => { const rows = [...results.querySelectorAll('[data-compass-index]')]; if (!rows.length) return; activeIndex = (next + rows.length) % rows.length; rows.forEach((row, index) => { const active = index === activeIndex; row.setAttribute('aria-selected', String(active)); row.classList.toggle('is-active', active) }); input.setAttribute('aria-activedescendant', rows[activeIndex].id); rows[activeIndex].scrollIntoView({ block: 'nearest' }) }
  const openEntry = index => { const url = safeLocalPath(visibleEntries[index]?.url); if (url) location.href = url }
  function render() {
    let query = input.value.trim().toLowerCase()
    if (query.startsWith('>')) { selectedFilter = 'rooms'; query = query.slice(1).trim(); root.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === 'rooms'))) }
    const localRecent = readRecent().map(item => ({ ...item, subtitle: 'Recently opened', sigil: '↺', group: 'RECENT', keywords: '' }))
    const syncedRecent = (serverState.recent || []).map(item => ({ title: item.title, url: item.path, subtitle: 'Recently opened · synced', sigil: '↺', group: 'RECENT', keywords: '' }))
    const saved = [...readBookmarks().map(item => ({ ...item, subtitle: 'Saved folio', sigil: '★', group: 'SAVED', keywords: '' })), ...(serverState.saved || []).map(item => ({ title: item.title, url: item.path, subtitle: 'Saved folio · synced', sigil: '★', group: 'SAVED', keywords: '' }))]
    let pool = selectedFilter === 'saved' ? saved : selectedFilter === 'rooms' ? commands : selectedFilter === 'wiki' ? (wikiIndex || []) : [...commands, ...(wikiIndex || []), ...saved]
    if (!query && selectedFilter === 'all') pool = [...localRecent, ...syncedRecent, ...commands]
    const seen = new Set(); pool = pool.filter(entry => entry?.url && !seen.has(entry.url) && seen.add(entry.url))
    visibleEntries = query ? pool.map(entry => ({ entry, rank: score(entry, query) })).filter(item => item.rank >= 0).sort((a, b) => b.rank - a.rank || a.entry.title.localeCompare(b.entry.title)).slice(0, 24).map(item => item.entry) : pool.slice(0, 18)
    status.textContent = `${visibleEntries.length} ${selectedFilter === 'all' ? 'archive destination' : selectedFilter + ' result'}${visibleEntries.length === 1 ? '' : 's'}`; activeIndex = 0; results.replaceChildren()
    if (!visibleEntries.length) { const empty = document.createElement('p'); empty.className = 'geor-compass-empty'; empty.textContent = wikiIndex ? 'No folio answers that description.' : 'Opening the deeper index…'; results.append(empty); input.removeAttribute('aria-activedescendant'); return }
    visibleEntries.forEach((entry, index) => { const row = document.createElement('button'); row.type = 'button'; row.id = `georCompassOption${index}`; row.dataset.compassIndex = String(index); row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(index === 0)); row.className = `geor-compass-result${index === 0 ? ' is-active' : ''}`; const sigil = document.createElement('span'); sigil.className = 'geor-compass-sigil'; sigil.textContent = entry.sigil || '·'; const copy = document.createElement('span'); copy.className = 'geor-compass-copy'; const heading = document.createElement('strong'); heading.textContent = entry.title; const subtitle = document.createElement('small'); subtitle.textContent = `${entry.group ? entry.group + ' · ' : ''}${entry.subtitle || 'Archive folio'}`; copy.append(heading, subtitle); const arrow = document.createElement('span'); arrow.className = 'geor-compass-arrow'; arrow.textContent = '→'; row.append(sigil, copy, arrow); row.addEventListener('mouseenter', () => setActive(index)); row.addEventListener('click', () => openEntry(index)); results.append(row) })
    input.setAttribute('aria-activedescendant', 'georCompassOption0')
  }
  const open = () => { returnFocus = document.activeElement; backdrop.hidden = false; document.body.classList.add('geor-compass-open'); input.value = ''; selectedFilter = 'all'; root.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === 'all'))); render(); loadWikiIndex(); requestAnimationFrame(() => input.focus()) }
  const close = () => { if (backdrop.hidden) return; backdrop.hidden = true; document.body.classList.remove('geor-compass-open'); returnFocus?.focus?.() }
  const closeContext = () => { if (contextPanel) { contextPanel.remove(); contextPanel = null; document.body.classList.remove('geor-context-open') } }
  const closeSplit = () => { if (splitPanel) { splitPanel.remove(); splitPanel = null; document.body.classList.remove('geor-split-open') } }
  root.querySelectorAll('[data-open-compass]').forEach(button => button.addEventListener('click', open)); closeButton.addEventListener('click', close); backdrop.addEventListener('mousedown', event => { if (event.target === backdrop) close() })
  input.addEventListener('input', () => { render(); if (input.value.trim().length >= 1) loadWikiIndex() })
  input.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); setActive(activeIndex + 1) } else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(activeIndex - 1) } else if (event.key === 'Enter') { event.preventDefault(); openEntry(activeIndex) } else if (event.key === 'Tab') { const buttons = [...root.querySelectorAll('[data-filter]')], current = buttons.findIndex(button => button.getAttribute('aria-pressed') === 'true'); event.preventDefault(); buttons[(current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].click() } })
  root.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { selectedFilter = button.dataset.filter; root.querySelectorAll('[data-filter]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); if (selectedFilter === 'wiki') loadWikiIndex(); render() }))
  panel.addEventListener('keydown', event => { if (event.key === 'Tab' && !event.defaultPrevented) { const focusable = [...panel.querySelectorAll('button:not([disabled]),input:not([disabled]),a[href]')], first = focusable[0], last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() } } })
  document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); backdrop.hidden ? open() : close() } else if (event.key === 'Escape') { close(); closeContext(); closeSplit() } })

  const account = root.querySelector('.geor-rail-account'), accountPopover = root.querySelector('.geor-account-popover')
  account.addEventListener('click', () => { accountPopover.hidden = !accountPopover.hidden }); document.addEventListener('click', event => { if (!accountPopover.hidden && !account.contains(event.target) && !accountPopover.contains(event.target)) accountPopover.hidden = true })
  root.querySelector('[data-mark-seen]').addEventListener('click', async () => { await postState({ action: 'seen' }); serverState.unseen = []; updateNewBadge(); accountPopover.hidden = true })
  fetch('/api/me', { credentials: 'same-origin' }).then(response => response.ok ? response.json() : null).then(data => { if (data?.user?.email) root.querySelector('[data-account-email]').textContent = data.user.email }).catch(() => {})
  const updateNewBadge = () => root.querySelectorAll('.geor-new-badge').forEach(badge => { const count = Math.min(99, serverState.unseen?.length || 0); badge.textContent = String(count); badge.hidden = !count })
  const syncState = async () => { try { if (!localStorage.getItem(MIGRATION_KEY)) { const payloads = [...readBookmarks().slice(0, 20).map(item => ({ action: 'save', path: item.url, title: item.title, kind: kindForPath(item.url), saved: true })), ...readRecent().slice(0, 10).map(item => ({ action: 'visit', path: item.url, title: item.title, kind: kindForPath(item.url), progress: 0 }))]; await Promise.all(payloads.map(postState)); localStorage.setItem(MIGRATION_KEY, '1') } const response = await fetch('/api/archive-state', { credentials: 'same-origin' }); if (!response.ok) return; serverState = await response.json(); updateNewBadge(); window.dispatchEvent(new CustomEvent('geor:archive-synced', { detail: serverState })); render() } catch {} }

  const relatedEntries = () => { if (!wikiIndex) return []; const path = location.pathname, parts = decodeURIComponent(path).split('/').filter(Boolean), parent = parts.slice(0, -1).join('/').toLowerCase(), titleWords = normalizeTitle(document.title).toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 3); return wikiIndex.filter(entry => entry.url !== path).map(entry => { const decoded = decodeURIComponent(entry.url).toLowerCase(); return { entry, rank: (decoded.includes(parent) ? 80 : 0) + titleWords.reduce((n, word) => n + (decoded.includes(word) || entry.title.toLowerCase().includes(word) ? 12 : 0), 0) } }).filter(item => item.rank > 0).sort((a, b) => b.rank - a.rank).slice(0, 8).map(item => item.entry) }
  const openSplit = () => { closeContext(); closeSplit(); splitPanel = document.createElement('section'); splitPanel.className = 'geor-split-panel'; splitPanel.innerHTML = `<header><p>WIKI + ATLAS</p><button type="button" aria-label="Close split view">×</button></header><iframe title="World of Ge’or Atlas" src="/atlas?embedded=1&from=${encodeURIComponent(location.pathname)}"></iframe>`; splitPanel.querySelector('button').addEventListener('click', closeSplit); document.body.append(splitPanel); document.body.classList.add('geor-split-open') }
  const openContext = async () => { closeContext(); await loadWikiIndex(); const related = relatedEntries(); contextPanel = document.createElement('aside'); contextPanel.className = 'geor-context-panel'; contextPanel.setAttribute('aria-label', 'Folio context'); const parentPath = location.pathname.split('/').filter(Boolean).slice(0, -1), parentUrl = '/' + parentPath.map(encodeURIComponent).join('/') + '/'; contextPanel.innerHTML = `<header><div><p>CONNECTED LORE</p><h2></h2></div><button type="button" aria-label="Close context">×</button></header><div class="geor-context-body"><a class="geor-context-parent" href="${parentUrl}">↑ Open parent section</a><section><p>RELATED FOLIOS</p><div class="geor-related-list"></div></section><section><p>READ BESIDE THE WORLD</p><button class="geor-split-button" type="button">Open Wiki + Atlas split view</button></section></div>`; contextPanel.querySelector('h2').textContent = normalizeTitle(document.title); const list = contextPanel.querySelector('.geor-related-list'); related.forEach(entry => { const link = document.createElement('a'); link.href = entry.url; link.innerHTML = '<span>◇</span><b></b><small></small>'; link.querySelector('b').textContent = entry.title; link.querySelector('small').textContent = entry.subtitle; list.append(link) }); if (!related.length) list.textContent = 'No neighboring folios found.'; contextPanel.querySelector('header button').addEventListener('click', closeContext); contextPanel.querySelector('.geor-split-button').addEventListener('click', openSplit); document.body.append(contextPanel); document.body.classList.add('geor-context-open'); contextPanel.querySelector('header button').focus() }

  const isWikiPage = location.pathname.startsWith('/wiki/')
  if (isWikiPage) {
    const progress = document.createElement('div'); progress.className = 'geor-reading-progress'; progress.setAttribute('aria-hidden', 'true'); progress.innerHTML = '<span></span>'; document.body.prepend(progress)
    let lastProgress = -1, progressTimer
    const updateProgress = () => { const maximum = Math.max(1, document.documentElement.scrollHeight - innerHeight), ratio = Math.min(1, Math.max(0, scrollY / maximum)); progress.firstElementChild.style.transform = `scaleX(${ratio})`; const percent = Math.round(ratio * 100); if (Math.abs(percent - lastProgress) >= 10) { lastProgress = percent; clearTimeout(progressTimer); progressTimer = setTimeout(() => postState({ action: 'visit', path: location.pathname, title: normalizeTitle(document.title), kind: 'folio', progress: percent }), 600) } }
    addEventListener('scroll', updateProgress, { passive: true }); updateProgress()
    const toolbar = document.createElement('nav'); toolbar.className = 'geor-folio-toolbar'; toolbar.setAttribute('aria-label', 'Folio tools'); const crumb = document.createElement('div'); crumb.className = 'geor-folio-crumbs'; const home = document.createElement('a'); home.href = '/wiki/'; home.textContent = 'Archive'; crumb.append(home)
    const parts = decodeURIComponent(location.pathname).replace(/^\/wiki\/?/, '').split('/').filter(Boolean); parts.forEach((part, index) => { const separator = document.createElement('span'); separator.textContent = '›'; const link = document.createElement('a'); link.href = '/wiki/' + parts.slice(0, index + 1).map(encodeURIComponent).join('/') + '/'; link.textContent = part.replaceAll('_', ' '); crumb.append(separator, link) })
    const tools = document.createElement('div'); tools.className = 'geor-folio-actions'; const previous = document.createElement('a'); previous.className = 'geor-folio-neighbor'; previous.textContent = '← Previous'; previous.hidden = true; const next = document.createElement('a'); next.className = 'geor-folio-neighbor'; next.textContent = 'Next →'; next.hidden = true; const context = document.createElement('button'); context.type = 'button'; context.className = 'geor-context-button'; context.textContent = 'Connections'; context.addEventListener('click', openContext); const split = document.createElement('button'); split.type = 'button'; split.className = 'geor-context-button'; split.textContent = 'Map beside'; split.addEventListener('click', openSplit); const bookmark = document.createElement('button'); bookmark.type = 'button'; bookmark.className = 'geor-bookmark-button'; const path = location.pathname; const setBookmarkLabel = active => { bookmark.classList.toggle('is-saved', active); bookmark.setAttribute('aria-pressed', String(active)); bookmark.textContent = active ? '★ Saved' : '☆ Save' }; setBookmarkLabel(isBookmarked(path)); bookmark.addEventListener('click', () => setBookmarkLabel(toggleBookmark(document.title, path))); tools.append(previous, context, split, bookmark, next); toolbar.append(crumb, tools); const content = document.querySelector('main, .md-main, [role="main"]'); if (content?.parentNode) content.parentNode.insertBefore(toolbar, content); else document.body.prepend(toolbar)
    loadWikiIndex().then(entries => { const index = entries.findIndex(entry => entry.url.replace(/\/$/, '') === path.replace(/\/$/, '')); if (index > 0) { previous.href = entries[index - 1].url; previous.title = entries[index - 1].title; previous.hidden = false } if (index >= 0 && index < entries.length - 1) { next.href = entries[index + 1].url; next.title = entries[index + 1].title; next.hidden = false } })
    let preview = null, previewTimer
    const closePreview = () => { clearTimeout(previewTimer); preview?.remove(); preview = null }
    document.addEventListener('pointerover', event => { const link = event.target.closest('a[href^="/wiki/"]'); if (!link || link.closest('#georArchiveCompass,.geor-folio-toolbar,.geor-context-panel') || matchMedia('(hover:none)').matches) return; clearTimeout(previewTimer); previewTimer = setTimeout(async () => { closePreview(); preview = document.createElement('aside'); preview.className = 'geor-link-preview'; preview.innerHTML = '<p>UNROLLING FOLIO…</p>'; document.body.append(preview); const rect = link.getBoundingClientRect(); preview.style.left = `${Math.min(innerWidth - 340, Math.max(12, rect.left))}px`; preview.style.top = `${Math.min(innerHeight - 190, rect.bottom + 10)}px`; try { const response = await fetch(link.href, { credentials: 'same-origin' }); const html = await response.text(), doc = new DOMParser().parseFromString(html, 'text/html'), title = normalizeTitle(doc.title || link.textContent), paragraph = doc.querySelector('main article p, article p, main p, .md-content p')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 280) || 'Open this connected archive folio.'; preview.replaceChildren(); const eye = document.createElement('p'); eye.textContent = 'FOLIO PREVIEW'; const heading = document.createElement('h3'); heading.textContent = title; const copy = document.createElement('div'); copy.textContent = paragraph; preview.append(eye, heading, copy) } catch { preview.textContent = normalizeTitle(link.textContent) } }, 420) })
    document.addEventListener('pointerout', event => { if (event.target.closest('a[href^="/wiki/"]')) closePreview() })
  }

  saveCurrentPage(); syncState()
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {})
}
