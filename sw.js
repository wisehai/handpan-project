// Minimal offline cache for the handpan app itself. Bump CACHE_NAME whenever
// the cached files change so clients pick up the new version instead of
// being stuck on a stale copy forever.
const CACHE_NAME = 'handpan-v1';
const PRECACHE = [
  './handpan-player.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// Same-origin: cache-first (app works fully offline once loaded once).
// Cross-origin (e.g. the on-demand pdf.js CDN load for PDF import): always
// go to the network — that feature already needs connectivity anyway.
self.addEventListener('fetch', e => {
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request))
  );
});
