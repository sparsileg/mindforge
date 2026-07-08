// update the version (at the same time as js/config.js) to trigger the
// browser's update cycle. The old cache is discarded on activation and new store is created.
const CACHE_VERSION = 'mindforge-cache-19';

// this explicit caching is because the app is a PWA. A PWA makes two
// promises that other orderinary websites don't.
// 1. Expected to fully work with no network
// 2. Atomic versioning so there is never a half-old, half-new situation.
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/manifest.json',
    '/css/base.css',
    '/css/mobile.css',
    '/css/themes/dark.css',
    '/css/themes/light.css',
    '/css/themes/matrix.css',
    '/include/jszip.min.js',
    '/include/papaparse.min.js',
    '/js/app.js',
    '/js/card-manager.js',
    '/js/category-manager.js',
    '/js/config.js',
    '/js/data-manager.js',
    '/js/indexedDB-manager.js',
    '/js/router.js',
    '/js/service-worker-register.js',
    '/js/storage-adapter.js',
    '/js/study-manager.js',
    '/js/ui-manager.js',
    '/js/utils.js',
    '/icons/web-app-manifest-192x192.png',
    '/icons/web-app-manifest-512x512.png',
    '/icons/apple-touch-icon.png',
    '/icons/favicon-96x96.png'
];

// Install — pre-cache all static assets
self.addEventListener('install', event => {
    console.log('SW installing, version:', CACHE_VERSION);
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then(cache => {
                console.log('Cache opened, fetching assets...');
                return Promise.all(
                    ASSETS_TO_CACHE.map(url =>
                        cache.add(url)
                            .then(() => console.log('Cached:', url))
                            .catch(err => console.error('Failed to cache:', url, err))
                    )
                );
            })
            .then(() => {
                console.log('All assets cached, calling skipWaiting');
                return self.skipWaiting();
            })
            .catch(err => console.error('Install failed:', err))
    );
});

// Activate — delete any old caches that don't match current version
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(cacheNames => Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_VERSION)
                    .map(name => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

// Fetch — cache-first strategy for static assets.
// Non-GET requests and API calls are never cached:
//  - cache.put() throws on non-GET, so those must bypass the SW entirely
//  - /api/* responses must always come from the network (future D1 backend)
self.addEventListener('fetch', event => {
    // Let the browser handle non-GET requests natively (POST, PUT, DELETE...)
    if (event.request.method !== 'GET') {
        return;
    }

    // API requests are network-only — never served from or added to cache
    const url = new URL(event.request.url);
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(cached => {
                if (cached) return cached;
                return fetch(event.request)
                    .then(response => {
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }
                        const responseToCache = response.clone();
                        caches.open(CACHE_VERSION)
                            .then(cache => cache.put(event.request, responseToCache));
                        return response;
                    });
            })
    );
});

// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
// ----------------------------------------------------------------------
