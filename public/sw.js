// A self-destroying service worker. This app has no service worker and never
// will -- this file exists ONLY to evict a foreign one.
//
// Service workers are scoped to an ORIGIN, not to an app. Any other project
// previously run on the same localhost port (in our case a vite-plugin-pwa
// app) leaves a Workbox worker registered against `localhost:3000`, and it
// keeps intercepting requests for whatever is served there next -- including
// this app. Because Workbox precaches with a cache-first strategy, the browser
// gets STALE JS chunks out of Cache Storage instead of the dev server's fresh
// ones, and webpack then fails to find a module inside a chunk that no longer
// contains it:
//
//     TypeError: Cannot read properties of undefined (reading 'call')
//        at .../app-pages-internals.js
//
// That looks exactly like a build or dependency bug, and it survives every
// `rm -rf .next`, because the stale bytes were never on disk -- they were in
// the browser's cache. The tell is a `GET /sw.js 404` in the dev server log:
// the foreign worker polling for an update it never finds.
//
// Serving THIS file at that path is what breaks the cycle. The browser treats
// it as a byte-different update to the registered worker, installs it, and on
// activation it deletes every cache, unregisters itself, and reloads open
// tabs. After one load the origin is clean and stays clean.
//
// Do not add caching logic here. If this app ever legitimately wants a service
// worker, replace this file wholesale and drop the purge script in
// app/layout.tsx at the same time.

self.addEventListener('install', () => {
  // Take over immediately instead of waiting for existing tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch {
        // Cache Storage unavailable -- unregistering below is the part that matters.
      }

      await self.registration.unregister();

      // Reload any tab this worker still controls so it re-fetches everything
      // from the network with no worker in the way.
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.navigate(client.url);
      }
    })(),
  );
});

// Pass every request straight through in the meantime -- never serve from cache.
self.addEventListener('fetch', () => {});
