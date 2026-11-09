// Scalping V2 Service Worker
// Strategy: cache-first for static assets, network-first for API + WebSocket
// Self-contained — no external dependencies, no importScripts.

const SW_VERSION = 'scalping-v2-sw-v1.0.0';
const STATIC_CACHE = `${SW_VERSION}-static`;
const RUNTIME_CACHE = `${SW_VERSION}-runtime`;

// Static assets that should be cached on install (cache-first).
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/logo.svg',
  '/robots.txt',
];

// Routes that should always hit network first (Python FastAPI + Next.js API).
const NETWORK_FIRST_PATTERNS = [
  /\/api\//,
  /\/healthz/,
  /\/readyz/,
  /\/metrics/,
];

// Routes that are cache-first (immutable build assets).
const CACHE_FIRST_PATTERNS = [
  /\/_next\/static\//,
  /\/_next\/[^/]+\.js$/,
  /\.(?:woff2?|ttf|otf|eot)$/i,
  /\.(?:png|jpg|jpeg|gif|webp|svg|ico)$/i,
];

// Install: precache known static assets, skipWaiting to activate immediately.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // Use individual fetches so one failed asset doesn't break the install.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'no-store' });
            if (res.ok) await cache.put(url, res.clone());
          } catch {
            // ignore — offline-first, will retry on activate.
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

// Activate: clear old caches, claim clients.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(SW_VERSION))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Message handler: allow page to trigger skipWaiting.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch handler: route-based strategy.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // WebSocket & non-http(s) requests are not handled by SW.
  if (!url.protocol.startsWith('http')) return;

  // Network-first for API / dynamic data.
  if (NETWORK_FIRST_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Cache-first for static / immutable assets.
  if (CACHE_FIRST_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // HTML navigations: stale-while-revalidate.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Default: try network, fallback to cache.
  event.respondWith(networkFallbackCache(req));
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ ok: false, error: 'offline', demo_mode: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

async function networkFallbackCache(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}
