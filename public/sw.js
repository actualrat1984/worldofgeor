const CACHE = 'geor-shell-v1'
const SAFE_ASSETS = ['/site.css', '/Geor_from_orbit-640.webp', '/Geor_from_orbit-1280.webp', '/manifest.webmanifest']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SAFE_ASSETS)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE && key.startsWith('geor-shell-')).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== location.origin || event.request.mode === 'navigate' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/wiki/')) return
  if (!SAFE_ASSETS.includes(url.pathname)) return
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => { if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone())); return response })))
})
