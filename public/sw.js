// Service Worker pour WhatsApp Commercial AI (Espace Vendeur & Admin)
const CACHE_NAME = 'wca-vendeur-v2';
const STATIC_ASSETS = [
  '/',
  '/?source=pwa',
  '/manifest.json',
  '/manifest.webmanifest',
  '/pwa-192x192.png',
  '/pwa-maskable-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
  '/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Robust individual asset caching so one failure doesn't invalidate offline capability
      await Promise.allSettled(
        STATIC_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn('[SW] Pre-cache non-blocking warning for', asset, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Ignore non-GET requests or Google Apps Script/external POSTs
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Bypass service worker caching for Google Apps Script API endpoints or analytics
  if (url.hostname.includes('script.google.com') || url.pathname.includes('/api/')) {
    return;
  }

  // Stale-while-revalidate for static assets & offline fallback for navigation
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Offline fallback for navigation requests to ensure Chrome installability check passes
        if (event.request.mode === 'navigate') {
          return caches.match('/?source=pwa')
            .then((res) => res || caches.match('/'))
            .then((res) => res || caches.match('/index.html'));
        }
      });

      return cachedResponse || fetchPromise;
    })
  );
});
