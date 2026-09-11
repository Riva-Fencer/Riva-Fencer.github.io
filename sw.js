const CACHE_NAME = 'riva-fence-v1';

// Install: Activate new worker immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate: Clear out old cache so new edits take effect
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Always try getting the newest version from the internet first
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request))
  );
});
