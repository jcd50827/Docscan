// DocScan Service Worker.
// - App-Shell (eigene Dateien): Netzwerk zuerst, damit Updates sofort ankommen; offline aus dem Cache.
// - Bibliotheken von CDNs (jsDelivr/cdnjs): Cache zuerst, sie sind versioniert und ändern sich nicht.
// - Requests an Apps Script (POST) werden nie angefasst.
// Bei Änderungen an der Datei-Liste CACHE_VERSION erhöhen.

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `docscan-shell-${CACHE_VERSION}`;
const LIB_CACHE = 'docscan-libs-v1';

const SHELL_FILES = [
  './',
  'index.html',
  'styles.css',
  'config.js',
  'api.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith('docscan-') && k !== SHELL_CACHE && k !== LIB_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req));
  } else if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const shell = await cache.match('index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(LIB_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}
