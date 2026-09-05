const CACHE = 'geor-shell-v3'
const SAFE_ASSETS = ['/site.css', '/Geor_from_orbit-640.webp', '/Geor_from_orbit-1280.webp', '/manifest.webmanifest']
const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Connection paused — World of Ge'or</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#171816;color:#f4eddc;font:18px/1.7 Georgia,serif}main{max-width:32rem;padding:32px}p{color:#c8c1b3}small{color:#d9b77a;letter-spacing:.15em}h1{font-weight:400;line-height:1.2}a{display:inline-block;color:#171816;background:#d9b77a;border-radius:2rem;padding:12px 24px;text-decoration:none}a:focus-visible{outline:3px solid #f4eddc;outline-offset:5px}</style></head><body><main><small>WORLD OF GE'OR</small><h1>The archive is waiting.</h1><p>Your connection was interrupted. Reconnect, then try this page again.</p><p>Private folios need a live connection so your membership can be checked.</p><a href="">Try again</a></main></body></html>`

// Only explicitly public shell assets belong in persistent browser storage.
// The previous runtime cache held private pages even after logout. Purge it
// on activation and never use caches.match across unrelated cache buckets.
const HAS_SW = typeof self !== 'undefined' && typeof self.addEventListener === 'function'
if (HAS_SW) {
  self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SAFE_ASSETS)).then(() => self.skipWaiting()))
  })
  self.addEventListener('activate', event => {
    event.waitUntil(caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('geor-pages-') || (key.startsWith('geor-shell-') && key !== CACHE))
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim()))
  })
  self.addEventListener('fetch', event => {
    const url = new URL(event.request.url)
    if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return
    if (SAFE_ASSETS.includes(url.pathname)) {
      event.respondWith(caches.open(CACHE).then(async cache => {
        const cached = await cache.match(event.request)
        if (cached) return cached
        const response = await fetch(event.request)
        if (response.ok && !response.redirected && !/private|no-store/i.test(response.headers.get('Cache-Control') || '')) {
          await cache.put(event.request, response.clone())
        }
        return response
      }))
      return
    }
    if (event.request.mode !== 'navigate') return
    event.respondWith(fetch(event.request).catch(() => new Response(OFFLINE_HTML, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
    })))
  })
}
