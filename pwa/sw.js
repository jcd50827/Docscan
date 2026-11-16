// DocScan Service Worker.
// - App-Shell (eigene Dateien): Netzwerk zuerst, damit Updates sofort ankommen; offline aus dem Cache.
// - Bibliotheken von CDNs (jsDelivr/cdnjs): Cache zuerst, sie sind versioniert und ändern sich nicht.
// - Requests an Apps Script (POST) werden nie angefasst.
// Bei Änderungen an der Datei-Liste CACHE_VERSION erhöhen.

const CACHE_VERSION = 'v9';
const SHELL_CACHE = `docscan-shell-${CACHE_VERSION}`;
const LIB_CACHE = 'docscan-libs-v1';

const SHELL_FILES = [
  './',
  'index.html',
  'styles.css',
  'config.js',
  'api.js',
  'scanner.js',
  'queue.js',
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

// ---------------------------------------------------------------------------
// Push: Der Server schickt einen Push ohne Inhalt. Hier wird die aktuelle Zahl
// neuer Dokumente geholt, das Banner gezeigt und die Zahl am App-Symbol gesetzt.
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  event.waitUntil(neuBenachrichtigen());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const ziel = new URL('./#/liste', self.registration.scope).href;
  event.waitUntil((async () => {
    const fenster = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const f of fenster) {
      if ('focus' in f) {
        await f.focus();
        if ('navigate' in f) await f.navigate(ziel).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(ziel);
  })());
});

async function neuBenachrichtigen() {
  let titel = 'DocScan';
  let text = 'Ein neues Dokument wurde hochgeladen.';
  let neu = null;
  try {
    const zugang = await kvLesen('zugang');
    if (zugang && zugang.code && zugang.apiUrl) {
      const antwort = await Promise.race([
        fetch(zugang.apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'stats', code: zugang.code })
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Zeitüberschreitung')), 8000))
      ]);
      const daten = await antwort.json();
      if (daten && daten.ok) {
        neu = daten.neu || 0;
        const d = (daten.neueste || [])[0];
        if (neu > 1) {
          titel = `${neu} neue Dokumente`;
          text = d ? `Zuletzt: ${beschreibung(d)}` : 'In der Tracking-Liste ansehen.';
        } else if (d) {
          titel = 'Neues Dokument';
          text = beschreibung(d);
        }
      }
    }
  } catch (err) {
    // Ohne Netz oder Zugang: allgemeine Meldung (iOS verlangt zu jedem Push eine sichtbare Benachrichtigung).
  }
  try {
    if (neu !== null && self.navigator.setAppBadge) {
      if (neu > 0) await self.navigator.setAppBadge(neu);
      else await self.navigator.clearAppBadge();
    }
  } catch (err) { /* Zahl am Symbol nicht unterstützt */ }
  return self.registration.showNotification(titel, {
    body: text,
    icon: 'icons/icon-192.png',
    tag: 'docscan-neu',
    renotify: true,
    data: { url: './#/liste' }
  });
}

function beschreibung(d) {
  const betrag = typeof d.betrag === 'number'
    ? new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(d.betrag) : '';
  const teile = [d.kategorie, d.absender || d.titel, betrag].filter(Boolean).join(' – ');
  return d.hochgeladen_von ? `${teile} (von ${d.hochgeladen_von})` : teile;
}

/** Liest aus dem IndexedDB-Speicher, den die App (queue.js) anlegt. */
function kvLesen(key) {
  return new Promise((resolve) => {
    const req = indexedDB.open('docscan', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('uploads')) db.createObjectStore('uploads', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      try {
        const get = req.result.transaction('kv', 'readonly').objectStore('kv').get(key);
        get.onsuccess = () => resolve(get.result || null);
        get.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    };
  });
}

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
    // „no-cache“: beim Server nachfragen statt den 10-Minuten-HTTP-Cache von
    // GitHub Pages zu nutzen – so kommen Updates sofort an (unverändert = 304, schnell).
    // Navigations-Requests lassen sich nicht mit Optionen kopieren → über die URL.
    const res = req.mode === 'navigate'
      ? await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      : await fetch(req, { cache: 'no-cache' });
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
