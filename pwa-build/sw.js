// public/sw.js — Service Worker Derewol PWA

const CACHE_NAME = 'derewol-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/upload.html',
  '/dashboard.html',
  '/offline.html',
];

// ── Installation — cache les assets statiques ─────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installation');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Certains assets non cachés:', err);
      });
    })
  );
  self.skipWaiting();
});

// ── Activation — nettoie anciens caches ───────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activation');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch — stratégie Network First ──────────────────────────
// Réseau en priorité, fallback cache si offline
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore les requêtes Supabase — pas de cache pour les données live
  if (url.hostname.includes('supabase.co')) return;

  // Ignore les requêtes non-GET
  if (request.method !== 'GET') return;

  event.respondWith(
    fetch(request)
      .then(response => {
        // Si succès réseau — met à jour le cache
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        // Offline — cherche dans le cache
        return caches.match(request).then(cached => {
          if (cached) return cached;
          // Si page HTML pas en cache → affiche page offline
          if (request.headers.get('accept')?.includes('text/html')) {
            return caches.match('/offline.html');
          }
        });
      })
  );
});