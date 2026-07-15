// Minimal offline cache for the handpan app itself. Bump CACHE_NAME whenever
// the cached files change so clients pick up the new version instead of
// being stuck on a stale copy forever.
const CACHE_NAME = 'handpan-v33';
const PRECACHE = [
  './index.html',
  './handpan-player.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './vendor/pdfjs/pdf.min.js',
  './vendor/pdfjs/pdf.worker.min.js',
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

// Same-origin: cache-first (app and bundled PDF import work fully offline once loaded once).
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // Directory requests (e.g. the bare "/handpan-project/" README link) never match a precached
  // URL by exact path — the browser requests the directory, not "index.html" — so redirect the
  // cache lookup to this directory's index.html, same as a static file server's default document.
  const cacheKey = url.pathname.endsWith('/') ? url.origin + url.pathname + 'index.html' : e.request;
  e.respondWith(
    caches.match(cacheKey).then(hit => hit || fetch(e.request))
  );
});
