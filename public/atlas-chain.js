// Atlas pin→article + folio chaining (Wave C3a) — pure helpers are exported
// so node --test can verify the ^/wiki/ link gate and the folio registry
// without a browser. Reuses isWikiUrl from ./timeline.js — never duplicates
// it. Browser wiring in atlas.html imports this module (type="module").
// Browser rendering only runs when `document` exists (see atlas.html guard).
import { isWikiUrl } from './timeline.js'

// Folio registry: the only drill-down structure the atlas knows. Slugs must
// match live viewer configs (world/grimmel/erisdar in atlas.html) and D1
// MAP_SLUGS where overlays exist (worker.js: world, grimmel). No child
// folios exist in D1 — regions/cities are future data — so the world folio
// lists its zoom-level children geographically and every child points back
// up. An empty registry means the chain UI stays hidden (no dead buttons).
export const FOLIO_REGISTRY = {
  world: { label: 'World Map', parent: null, children: ['grimmel', 'erisdar'] },
  grimmel: { label: 'Grimmel Peninsula', parent: 'world', children: [] },
  erisdar: { label: 'Central Erisdar', parent: 'world', children: [] },
}

// Article URL carried by a pin, or null when the pin links nowhere safe.
// Hostile values (javascript:, https://evil, /evil, backslashes, ..) never
// render — the popup omits the lore link entirely. Bare wiki roots are not
// articles either: a pin must point somewhere deeper than /wiki/ itself.
export function pinArticleUrl(pin) {
  const url = pin && typeof pin === 'object' ? pin.url : null
  if (typeof url !== 'string') return null
  // Reject traversal and separators BEFORE normalization: new URL() would
  // silently resolve '/wiki/../secret' to '/secret' and pass a prefix test.
  if (url.includes('..') || url.includes('\\')) return null
  if (!isWikiUrl(url)) return null
  let path = url
  try {
    path = new URL(url, 'https://worldofgeor.com').pathname
  } catch {
    return null
  }
  return path.startsWith('/wiki/') && path.length > '/wiki/'.length ? url : null
}

// Child-folio drill target carried by a pin (pin.folio slug), or null when
// absent or not a known registered folio. Unknown slugs never render.
export function pinFolioTarget(pin, registry = FOLIO_REGISTRY) {
  const slug = pin && typeof pin === 'object' ? pin.folio : null
  if (typeof slug !== 'string' || !registry || typeof registry !== 'object') return null
  return Object.prototype.hasOwnProperty.call(registry, slug) ? slug : null
}

// Registered children of a folio slug, unknown slugs yield [].
export function childFolios(slug, registry = FOLIO_REGISTRY) {
  const entry = registry && typeof registry === 'object' ? registry[slug] : null
  if (!entry || !Array.isArray(entry.children)) return []
  return entry.children.filter(child => Object.prototype.hasOwnProperty.call(registry, child))
}

// Registered parent of a folio slug, or null at the top / unknown slugs.
export function parentFolio(slug, registry = FOLIO_REGISTRY) {
  const entry = registry && typeof registry === 'object' ? registry[slug] : null
  const parent = entry && typeof entry.parent === 'string' ? entry.parent : null
  return parent && registry && Object.prototype.hasOwnProperty.call(registry, parent) ? parent : null
}

// Whether the chaining UI (breadcrumb + drill buttons) should render at
// all: false for an empty registry so no dead buttons ever appear.
export function chainUiVisible(registry = FOLIO_REGISTRY) {
  if (!registry || typeof registry !== 'object') return false
  return Object.keys(registry).length > 0
}

// --- Wave H10: hidden-lore pin badges (leak-proof) ------------------------
// secretsIndex maps article URL -> hidden-passage COUNT (built by
// scripts/generate_secrets_index.py, fetched gated). Counts only — no
// secret bytes ever flow through here, and lookups go through the same
// pinArticleUrl gate, so hostile pin urls and hostile index keys resolve
// to 0 and never render.
export function secretCountForUrl(url, secretsIndex) {
  if (typeof url !== 'string' || !url.startsWith('/wiki/')) return 0
  if (!secretsIndex || typeof secretsIndex !== 'object' || Array.isArray(secretsIndex)) return 0
  const count = secretsIndex[url]
  return Number.isInteger(count) && count > 0 ? count : 0
}

export function pinSecretCount(pin, secretsIndex) {
  return secretCountForUrl(pinArticleUrl(pin), secretsIndex)
}

export function formatSecretBadge(count) {
  if (!Number.isInteger(count) || count <= 0) return ''
  return `🔒 ${count} hidden ${count === 1 ? 'passage' : 'passages'}`
}
