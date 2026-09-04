const CACHE = 'geor-shell-v2'
const RUNTIME = 'geor-pages-v1'
const RUNTIME_MAX = 120
const SAFE_ASSETS = ['/site.css', '/Geor_from_orbit-640.webp', '/Geor_from_orbit-1280.webp', '/manifest.webmanifest']
const READER_ROOTS = ['/timeline', '/chronicles', '/atlas', '/gazetteer', '/trees', '/webs', '/gallery', '/oracle', '/notebook', '/boards', '/manuscripts', '/arcs', '/quests', '/primer', '/desk', '/statblocks', '/calendar', '/audio', '/search']

function shouldCachePage(pathname, method) {
  if (method !== undefined && method !== 'GET') return false
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return false
  let path = pathname
  const query = path.indexOf('?')
  if (query !== -1) path = path.slice(0, query)
  const hash = path.indexOf('#')
  if (hash !== -1) path = path.slice(0, hash)
  if (!path.startsWith('/')) return false
  try { path = decodeURIComponent(path) } catch {}
  if (path === '/api' || path.startsWith('/api/')) return false
  if (path === '/wiki' || path.startsWith('/wiki/')) return true
  return READER_ROOTS.some(root => path === root || path === `${root}/` || path.startsWith(`${root}/`))
}

async function trimRuntime(cache) {
  const keys = await cache.keys()
  if (keys.length > RUNTIME_MAX) {
    for (let i = 0; i < keys.length - RUNTIME_MAX; i++) await cache.delete(keys[i])
  }
}

// Exposed for node unit tests via globalThis (classic SW registration has no module type, so no static export).
globalThis.shouldCachePage = shouldCachePage

const HAS_SW = typeof self !== 'undefined' && typeof self.addEventListener === 'function'

if (HAS_SW) {
  self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SAFE_ASSETS)).then(() => self.skipWaiting()))
  })

  self.addEventListener('activate', event => {
    event.waitUntil(caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => (key.startsWith('geor-shell-') && key !== CACHE) || (key.startsWith('geor-pages-') && key !== RUNTIME))
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim()))
  })

  self.addEventListener('fetch', event => {
    const url = new URL(event.request.url)
    if (event.request.method !== 'GET' || url.origin !== location.origin) return
    if (url.pathname.startsWith('/api/')) return
    if (SAFE_ASSETS.includes(url.pathname)) {
      event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
        if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()))
        return response
      })))
      return
    }
    if (event.request.mode !== 'navigate' || !shouldCachePage(url.pathname, event.request.method)) return
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone()
        caches.open(RUNTIME).then(cache => cache.put(event.request, copy).then(() => trimRuntime(cache)))
      }
      return response
    }).catch(() => caches.match(event.request)))
  })
}
