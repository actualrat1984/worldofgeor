// Timeline of the Ages (Wave C1) — pure helpers are exported so node --test
// can verify age assignment and the ^/wiki/ link gate without a browser.
// Browser rendering only runs when `document` exists (see bottom guard).
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

// Lore-leak gate: only same-site wiki article paths may ever become links.
export function isWikiUrl(url) {
  return typeof url === 'string' && url.startsWith('/wiki/')
}

export function normalizeTitle(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function buildTitleLookup(wikiIndex) {
  const lookup = new Map()
  for (const entry of wikiIndex ?? []) {
    if (!entry || typeof entry.title !== 'string' || !isWikiUrl(entry.url)) continue
    const key = normalizeTitle(entry.title)
    if (key && !lookup.has(key)) lookup.set(key, entry.url)
  }
  return lookup
}

// Resolve a [[wikilink]] name to a wiki article URL, or null when unknown.
// Never returns a non-/wiki/ URL — callers must still check isWikiUrl.
export function resolveWikiUrl(name, lookup) {
  const key = normalizeTitle(name)
  if (!key || !(lookup instanceof Map) || lookup.size === 0) return null
  if (lookup.has(key)) return lookup.get(key)
  const bare = key.replace(/^the\s+/, '')
  if (bare && bare !== key && lookup.has(bare)) return lookup.get(bare)
  if (lookup.has(`the ${key}`)) return lookup.get(`the ${key}`)
  let best = null
  for (const [title, url] of lookup) {
    if (title.includes(key) || (bare && title.includes(bare))) {
      if (!best || title.length < best.title.length) best = { title, url }
    }
  }
  return best ? best.url : null
}

// Render event prose: escape HTML, linkify [[Article]] fragments (validated),
// support **bold**, strip stray markers. Emitted hrefs are always ^/wiki/.
export function renderEventText(text, lookup) {
  const parts = String(text ?? '').split('[[')
  let out = escapeHtml(parts[0])
  for (let i = 1; i < parts.length; i++) {
    const raw = parts[i]
    const closeAt = raw.indexOf(']]')
    const name = (closeAt >= 0 ? raw.slice(0, closeAt) : raw).replace(/^\*+/, '').trim()
    const tail = closeAt >= 0 ? raw.slice(closeAt + 2) : ''
    const url = resolveWikiUrl(name, lookup)
    if (name && url && isWikiUrl(url)) {
      out += `<a href="${escapeHtml(url)}">${escapeHtml(name)}</a>${escapeHtml(tail)}`
    } else {
      out += escapeHtml(name) + escapeHtml(tail)
    }
  }
  return out.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>').replace(/\*\*/g, '')
}

// Signed year scalar: BGD counts negative, AGD positive, Year 0 is zero.
export function dateToScalar(date) {
  const text = String(date ?? '')
  const match = text.replace(/,/g, '').match(/\d+/)
  const year = match ? parseInt(match[0], 10) : 0
  if (/AGD/.test(text)) return year
  if (/BGD/.test(text)) return -year
  if (/pre[-\s]?year 0/i.test(text)) return -1
  return 0
}

export function rangeToBounds(range) {
  const text = String(range ?? '')
  const nums = [...text.replace(/,/g, '').matchAll(/\d+/g)].map(m => parseInt(m[0], 10))
  const first = nums[0] ?? 0
  const second = nums[1] ?? nums[0] ?? 0
  if (/after/i.test(text)) return [first, Infinity]
  if (/BGD/.test(text) && /year 0/i.test(text)) return [-first, 0]
  if (/year 0/i.test(text) && /AGD/.test(text)) return [0, second]
  if (/BGD/.test(text)) return [-first, -second]
  if (/AGD/.test(text)) return [first, second]
  return [-Infinity, Infinity]
}

// Index into data.ages for an event, or -1 when its date parses to nothing known.
export function assignAgeIndex(event, ages) {
  if (!event || !Array.isArray(ages) || ages.length === 0) return -1
  const point = dateToScalar(event.date)
  for (let i = 0; i < ages.length; i++) {
    const [lo, hi] = rangeToBounds(ages[i]?.range)
    const last = i === ages.length - 1
    if (point >= lo && (last ? point <= hi : point < hi)) return i
  }
  return -1
}

export function groupEventsByAge(data) {
  const ages = Array.isArray(data?.ages) ? data.ages : []
  const perAge = ages.map(() => [])
  const unassigned = []
  for (const event of data?.events ?? []) {
    const idx = assignAgeIndex(event, ages)
    if (idx >= 0) perAge[idx].push(event)
    else unassigned.push(event)
  }
  return { perAge, unassigned }
}

// --- Browser rendering (never runs under node --test) -----------------------
async function initTimeline() {
  const rail = document.getElementById('eraRail')
  const sections = document.getElementById('timelineSections')
  const status = document.getElementById('timelineStatus')
  const count = document.getElementById('timelineCount')
  const filter = document.getElementById('timelineFilter')
  const shadow = document.getElementById('shadowStrip')
  const present = document.getElementById('presentYear')
  if (!rail || !sections) return
  try {
    const [timelineResponse, wikiResponse] = await Promise.all([
      fetch('/wiki/timeline-index.json', { credentials: 'same-origin' }),
      fetch('/wiki-index.json', { credentials: 'same-origin' }),
    ])
    if (timelineResponse.status === 401 || wikiResponse.status === 401) {
      location.href = '/?next=' + encodeURIComponent('/timeline')
      return
    }
    if (!timelineResponse.ok) throw new Error('The timeline index could not be opened')
    if (!wikiResponse.ok) throw new Error('The archive index could not be opened')
    const data = await timelineResponse.json()
    const wikiIndex = await wikiResponse.json()
    const lookup = buildTitleLookup(Array.isArray(wikiIndex) ? wikiIndex : [])
    const { perAge, unassigned } = groupEventsByAge(data)
    const total = (data.events ?? []).length
    if (present && data.present_year) present.textContent = `PRESENT DAY · ${data.present_year}`
    if (count) count.textContent = `${total} dated events · ${(data.ages ?? []).length} ages`
    if (status) status.textContent = `${total} events ready`
    rail.innerHTML = (data.ages ?? []).map((age, i) =>
      `<button type="button" data-era="${i}" class="tl-era" aria-pressed="false"><span class="tl-era-name">${escapeHtml(age.age)}</span><span class="tl-era-n">${perAge[i].length}</span></button>`
    ).join('')
    sections.innerHTML = (data.ages ?? []).map((age, i) => {
      const cards = perAge[i].map(event => `
        <article class="tl-card" data-text="${escapeHtml(`${event.date} ${event.event}`.toLowerCase())}">
          <p class="tl-date">${escapeHtml(event.date || 'undated')}<span class="tl-era-tag">${escapeHtml(event.era || '')}</span></p>
          <p class="tl-text">${renderEventText(event.event, lookup)}</p>
        </article>`).join('')
      return `
        <section id="age-${i}" class="tl-age" aria-label="${escapeHtml(age.age)}">
          <header class="tl-age-head"><div><p class="tl-eyebrow">${escapeHtml(age.age)}</p>
          <h2>${escapeHtml(age.trait || '')}</h2><p class="tl-range">${escapeHtml(age.range || '')}</p></div>
          <span class="tl-count">${perAge[i].length} event${perAge[i].length === 1 ? '' : 's'}</span></header>
          ${cards || '<p class="tl-empty">No dated events survive from this age — the archive holds only its name.</p>'}
        </section>`
    }).join('') + (unassigned.length ? `
        <section class="tl-age" aria-label="Undated"><header class="tl-age-head"><div><p class="tl-eyebrow">UNDATED</p>
        <h2>Fragments without a year</h2></div><span class="tl-count">${unassigned.length}</span></header>
        ${unassigned.map(event => `<article class="tl-card"><p class="tl-text">${renderEventText(event.event, lookup)}</p></article>`).join('')}</section>` : '')
    if (shadow && Array.isArray(data.shadow_plan_phases)) {
      shadow.innerHTML = `<h2>THE SHADOW PLAN · ${data.shadow_plan_phases.length} PHASES</h2><ol>` +
        data.shadow_plan_phases.map(phase => `<li><strong>${escapeHtml(phase.phase)}</strong><span>${escapeHtml(phase.range || '')}</span><p>${escapeHtml(phase.activity || '')}</p></li>`).join('') + '</ol>'
    }
    const applyFilter = () => {
      const query = (filter?.value ?? '').trim().toLowerCase()
      let visible = 0
      sections.querySelectorAll('.tl-card').forEach(card => {
        const hit = !query || (card.dataset.text || '').includes(query)
        card.classList.toggle('hidden', !hit)
        if (hit) visible++
      })
      sections.querySelectorAll('.tl-age').forEach(section => {
        const any = [...section.querySelectorAll('.tl-card')].some(card => !card.classList.contains('hidden'))
        section.classList.toggle('hidden', !any)
      })
      if (status) status.textContent = query ? `${visible} of ${total} events match` : `${total} events ready`
      rail.querySelectorAll('[data-era]').forEach(button => {
        const section = document.getElementById(`age-${button.dataset.era}`)
        button.classList.toggle('hidden', query ? !section || section.classList.contains('hidden') : false)
      })
    }
    filter?.addEventListener('input', applyFilter)
    rail.querySelectorAll('[data-era]').forEach(button => button.addEventListener('click', () => {
      rail.querySelectorAll('[data-era]').forEach(item => item.setAttribute('aria-pressed', String(item === button)))
      document.getElementById(`age-${button.dataset.era}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    }))
    const spy = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const idx = entry.target.id.replace('age-', '')
        rail.querySelectorAll('[data-era]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.era === idx)))
      }
    }, { rootMargin: '-30% 0px -60% 0px' })
    sections.querySelectorAll('.tl-age[id]').forEach(section => spy.observe(section))
  } catch (error) {
    if (status) status.textContent = 'Timeline unavailable'
    sections.innerHTML = `<div class="tl-error" role="alert">${escapeHtml(error instanceof Error ? error.message : 'The timeline could not be opened')}</div>`
  }
}

if (typeof document !== 'undefined' && typeof fetch !== 'undefined') {
  initTimeline()
}
