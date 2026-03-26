const CACHE_VERSION = 'mindforge-v2.0.1';

const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/manifest.json',
    '/css/base.css',
    '/css/mobile.css',
    '/css/themes/dark.css',
    '/css/themes/light.css',
    '/css/themes/matrix.css',
    '/js/app.js',
    '/js/card-manager.js',
    '/js/category-manager.js',
    '/js/config.js',
    '/js/data-manager.js',
    '/js/indexedDB-manager.js',
    '/js/router.js',
    '/js/service-worker-register.js',
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

// Fetch — cache-first strategy for static assets
self.addEventListener('fetch', event => {
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
