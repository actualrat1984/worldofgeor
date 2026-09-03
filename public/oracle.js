// Prompt Oracle (Wave E5) — pure roll helpers are exported so node --test
// can verify seeded determinism, index membership, and the ^/wiki/ link
// gate without a browser. Browser rendering only runs when `document` exists.
import { escapeHtml, isWikiUrl } from './timeline.js'

export const ORACLE_MODES = ['character', 'place', 'conflict']

// Uniform pick; `rand` defaults to Math.random so tests can inject a seed.
export function pickRandom(list, rand = Math.random) {
  const items = Array.isArray(list) ? list : []
  if (!items.length) return null
  const index = Math.floor(rand() * items.length)
  return items[Math.min(index, items.length - 1)]
}

// tags-index.json pages carry vault-relative md paths ("World/Foo.md" or
// "World/Foo/index.md"); MkDocs renders each to /wiki/<path-minus-.md>/.
// Mirrors worker.js relatedUrlForPagePath.
export function tagPageToWikiUrl(mdPath) {
  if (typeof mdPath !== 'string' || !mdPath.trim()) return null
  let rel = mdPath.trim().replace(/\.md$/, '')
  if (rel.endsWith('/index')) rel = rel.slice(0, -'/index'.length)
  if (!rel || rel.includes('..')) return null
  return `/wiki/${rel.split('/').map(encodeURIComponent).join('/')}/`
}

// A name becomes a link only for ^/wiki/ paths; hostile or empty paths
// render as plain escaped text. Never invents lore — no path, no link.
export function renderOracleLink(name, path) {
  const label = escapeHtml(String(name ?? 'Unnamed'))
  return isWikiUrl(path)
    ? `<a href="${escapeHtml(path)}" class="text-gold underline decoration-gold/30 underline-offset-4">${label}</a>`
    : label
}

function renderTagWrinkle(tag, tagTitle, tagUrl) {
  const tagLabel = escapeHtml(`#${tag}`)
  const page = renderOracleLink(tagTitle || 'Untagged folio', tagUrl)
  return `<p class="mt-4 text-xs tracking-widest text-cream/40">WRINKLE · <span class="text-gold">${tagLabel}</span> · ${page}</p>`
}

// One random tag item + one random page inside it.
export function rollTagWrinkle(tags, rand = Math.random) {
  const item = pickRandom(tags, rand)
  if (!item || typeof item.tag !== 'string') return { tag: null, tagTitle: null, tagUrl: null }
  const page = pickRandom(Array.isArray(item.pages) ? item.pages : [], rand)
  const tagTitle = page && typeof page.title === 'string' && page.title ? page.title : null
  const tagUrl = page ? tagPageToWikiUrl(page.path) : null
  return { tag: item.tag, tagTitle, tagUrl }
}

// Mode mapping: character = gallery entry + tag; place = gazetteer entry +
// tag; conflict = two distinct gazetteer nations + timeline event + tag.
export function rollCharacter(characters, tags, rand = Math.random) {
  return { character: pickRandom(characters, rand), ...rollTagWrinkle(tags, rand) }
}

export function rollPlace(places, tags, rand = Math.random) {
  return { place: pickRandom(places, rand), ...rollTagWrinkle(tags, rand) }
}

export function rollConflict(places, events, tags, rand = Math.random) {
  const list = Array.isArray(places) ? places : []
  const sideA = pickRandom(list, rand)
  const rest = sideA ? list.filter(entry => entry !== sideA) : []
  const sideB = rest.length ? pickRandom(rest, rand) : sideA
  return { sideA, sideB, event: pickRandom(events, rand), ...rollTagWrinkle(tags, rand) }
}

export function rollOracle(mode, indexes, rand = Math.random) {
  const { characters = [], places = [], events = [], tags = [] } = indexes ?? {}
  if (mode === 'place') return { mode, ...rollPlace(places, tags, rand) }
  if (mode === 'conflict') return { mode, ...rollConflict(places, events, tags, rand) }
  return { mode: 'character', ...rollCharacter(characters, tags, rand) }
}

export function renderOracleResult(roll) {
  if (!roll) return '<p class="text-sm text-cream/40">The oracle is silent — roll again.</p>'
  const wrinkle = (roll.tag == null && roll.tagTitle == null)
    ? ''
    : renderTagWrinkle(roll.tag ?? 'untagged', roll.tagTitle, roll.tagUrl)
  if (roll.mode === 'place') {
    const place = roll.place
    const name = place?.name ? renderOracleLink(place.name, place.path) : '<span class="text-cream/40">No place answered</span>'
    const region = typeof place?.region === 'string' && place.region.trim() ? ` <span class="text-cream/40">· ${escapeHtml(place.region.trim())}</span>` : ''
    return `<article><p class="text-[10px] tracking-[.3em] text-gold font-semibold">PLACE OMEN</p>`
      + `<p class="font-display text-2xl md:text-3xl mt-2">${name}${region}</p>${wrinkle}</article>`
  }
  if (roll.mode === 'conflict') {
    const side = entry => entry?.name ? renderOracleLink(entry.name, entry.path) : '<span class="text-cream/40">No side answered</span>'
    const event = roll.event && typeof roll.event.event === 'string'
      ? `<p class="font-serif italic text-lg text-cream/80 mt-3">“${escapeHtml(roll.event.event)}”</p>`
        + (typeof roll.event.date === 'string' && roll.event.date ? `<p class="text-xs text-cream/40 mt-1">${escapeHtml(roll.event.date)}</p>` : '')
      : '<p class="text-cream/40 mt-3">No age remembers this war.</p>'
    return `<article><p class="text-[10px] tracking-[.3em] text-gold font-semibold">CONFLICT OMEN</p>`
      + `<p class="font-display text-2xl md:text-3xl mt-2">${side(roll.sideA)} <span class="text-cream/30">⚔</span> ${side(roll.sideB)}</p>`
      + event + wrinkle + `</article>`
  }
  const character = roll.character
  const name = character?.name ? renderOracleLink(character.name, character.path) : '<span class="text-cream/40">No soul answered</span>'
  const meta = []
  for (const [key, value] of [['house', character?.house], ['species', character?.species], ['nation', character?.nation]]) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text) meta.push(`<span>${escapeHtml(text)}</span>`)
  }
  return `<article><p class="text-[10px] tracking-[.3em] text-gold font-semibold">CHARACTER OMEN</p>`
    + `<p class="font-display text-2xl md:text-3xl mt-2">${name}</p>`
    + (meta.length ? `<p class="mt-2 text-xs text-cream/50 flex flex-wrap justify-center gap-x-2 gap-y-0.5">${meta.join('')}</p>` : '')
    + wrinkle + `</article>`
}

// Mulberry32 — deterministic RNG for tests and shareable readings.
export function seededRandom(seed) {
  let state = (Number(seed) || 0) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let word = state
    word = Math.imul(word ^ (word >>> 15), word | 1)
    word ^= word + Math.imul(word ^ (word >>> 7), word | 61)
    return ((word ^ (word >>> 14)) >>> 0) / 4294967296
  }
}

// --- Browser rendering (never runs under node --test) -----------------------
async function fetchIndex(url) {
  const response = await fetch(url, { credentials: 'same-origin' })
  if (response.status === 401) {
    location.href = '/?next=' + encodeURIComponent('/oracle')
    throw new Error('unauthorized')
  }
  if (!response.ok) throw new Error(`The oracle index ${url} could not be opened`)
  return response.json()
}

async function initOracle() {
  const result = document.getElementById('oracleResult')
  if (!result) return
  const status = document.getElementById('oracleStatus')
  const count = document.getElementById('oracleCount')
  const reroll = document.getElementById('oracleReroll')
  const tabs = [...document.querySelectorAll('[data-mode]')]
  let mode = 'character'
  let indexes = null
  const setMode = next => {
    mode = ORACLE_MODES.includes(next) ? next : 'character'
    for (const tab of tabs) {
      const active = tab.dataset.mode === mode
      tab.setAttribute('aria-selected', String(active))
      tab.className = active
        ? 'rounded-full border border-gold/25 bg-gold/10 px-5 py-2 text-xs tracking-widest text-gold'
        : 'rounded-full border border-gold/15 px-5 py-2 text-xs tracking-widest text-cream/60'
    }
  }
  const draw = () => {
    if (!indexes) return
    const roll = rollOracle(mode, indexes)
    result.innerHTML = renderOracleResult(roll)
    result.setAttribute('aria-busy', 'false')
    if (status) status.textContent = `The ${mode} omen stands — roll again to tempt another.`
  }
  try {
    const [gallery, gazetteer, timeline, tags] = await Promise.all([
      fetchIndex('/wiki/gallery-index.json'),
      fetchIndex('/wiki/gazetteer-index.json'),
      fetchIndex('/wiki/timeline-index.json'),
      fetchIndex('/wiki/tags-index.json'),
    ])
    indexes = {
      characters: Array.isArray(gallery?.entries) ? gallery.entries : [],
      places: Array.isArray(gazetteer?.entries) ? gazetteer.entries : [],
      events: Array.isArray(timeline?.events) ? timeline.events : [],
      tags: Array.isArray(tags?.items) ? tags.items : [],
    }
    if (count) count.textContent = `${indexes.characters.length} souls · ${indexes.places.length} nations · ${indexes.events.length} events · ${indexes.tags.length} tags`
    for (const tab of tabs) tab.addEventListener('click', () => { setMode(tab.dataset.mode); draw() })
    reroll?.addEventListener('click', draw)
    draw()
  } catch (error) {
    if (error instanceof Error && error.message === 'unauthorized') return
    if (status) status.textContent = error instanceof Error ? error.message : 'The oracle could not be consulted'
  }
}

if (typeof document !== 'undefined') initOracle()
