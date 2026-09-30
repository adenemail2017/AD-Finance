/* eslint-env serviceworker */
/**
 * AD-Finance — Service Worker.
 *
 * Strategy
 *  • App shell (HTML/CSS/JS/icons): cache-first, precached on install → instant
 *    cold starts and full offline capability.
 *  • Navigations: network-first with cache fallback to index.html so deep links
 *    work offline.
 *  • Writes/API: never cached; the app itself queues mutations in an outbox.
 */

const VERSION = 'adfinance-v2.1.0';
const RUNTIME = 'adfinance-runtime-v2.0.0';

const APP_SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'src/styles/design-system.css',
  'src/styles/components.css',
  'src/styles/app.css',
  'src/app.js',
  'src/sw-client.js',
  'src/types/models.js',
  'src/utils/format.js',
  'src/utils/privacy.js',
  'src/utils/date.js',
  'src/utils/dom.js',
  'src/utils/id.js',
  'src/utils/csv.js',
  'src/utils/xlsx.js',
  'src/database/idb.js',
  'src/database/seed.js',
  'src/services/store.js',
  'src/services/finance.js',
  'src/services/notifications.js',
  'src/services/security.js',
  'src/components/icons.js',
  'src/components/ui.js',
  'src/components/charts.js',
  'src/components/cards.js',
  'src/components/category-manager.js',
  'src/components/ledger.js',
  'src/pages/dashboard.js',
  'src/pages/transactions.js',
  'src/pages/accounts.js',
  'src/pages/debts.js',
  'src/pages/reports.js',
  'src/pages/analytics.js',
  'src/pages/budgets.js',
  'src/pages/settings.js',
  'src/pages/search.js',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/maskable-512.png',
  'assets/icons/icon.svg',
  'assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.allSettled(APP_SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== VERSION && key !== RUNTIME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const shell = await caches.match('index.html');
    if (shell) return shell;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title><body style="font-family:system-ui;padding:40px;text-align:center">'
      + '<h2>Aplikasi sedang offline</h2><p>Muat ulang setelah koneksi kembali — data Anda tetap tersimpan di perangkat.</p></body>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 },
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: false });
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok && request.method === 'GET') {
      const cache = await caches.open(VERSION);
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    return caches.match(request).then((fallback) => fallback || Response.error());
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let the network handle third parties
  if (url.pathname.includes('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

/* --- Background sync hook (used when the app is closed mid-queue) ------- */
self.addEventListener('sync', (event) => {
  if (event.tag === 'pfos-sync') {
    event.waitUntil((async () => {
      const clientsList = await self.clients.matchAll({ includeUncontrolled: true });
      clientsList.forEach((client) => client.postMessage({ type: 'FLUSH_OUTBOX' }));
    })());
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clientsList.length) return clientsList[0].focus();
    return self.clients.openWindow('./');
  })());
});
