/**
 * Riva Fencer - Service Worker (Try #8 + Tab 3 Offline Models)
 * Caches shell, cartridges, and MediaPipe offline assets.
 */

const CACHE_NAME = 'riva-fencer-v2';

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './icon-512.png',
    './sparrer.js',
    './clinic.js',
    './drills/drill_001.js',
    './drills/drill_002.js',
    './drills/drill_003.js',
    './models/pose_landmarker_lite.task',
    './models/vision_wasm_internal.js',
    './models/vision_wasm_internal.wasm'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
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
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request).then((networkResponse) => {
                return networkResponse;
            });
        }).catch(() => {
            if (event.request.mode === 'navigate') {
                return caches.match('./index.html');
            }
        })
    );
});
