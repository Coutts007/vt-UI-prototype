/// <reference lib="webworker" />
// Precaches the shell (A13). Models and WASM enter their own cache once the client taps Download
// (spec 18), or on first use, and are served from it offline. It never caches /api/ or any image.
import { strategyFor } from './strategy';

declare const self: ServiceWorkerGlobalScope;
// The build replaces this with "<version>,<file>,<file>..." (see vite.config.ts).
const [VERSION, ...FILES] = '__VT_PRECACHE__'.split(',');
const CACHE = `vt-shell-${VERSION}`;
const SHELL = '/index.html';
// The build replaces this with the vision-manifest version.
const VISION_CACHE = 'vt-vision-__VT_VISION__';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([SHELL, ...FILES])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== VISION_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const strategy = strategyFor(event.request, self.location.origin);
  if (strategy === 'network-only') return;
  if (strategy === 'vision-cache') {
    event.respondWith(
      caches.open(VISION_CACHE).then(async (cache) => {
        const hit = await cache.match(event.request.url);
        if (hit) return hit;
        const response = await fetch(event.request);
        if (response.ok && response.status === 200) await cache.put(event.request.url, response.clone());
        return response;
      }),
    );
    return;
  }
  if (strategy === 'cache-first') {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ??
          fetch(event.request).then(async (response) => {
            if (response.ok) (await caches.open(CACHE)).put(event.request, response.clone());
            return response;
          }),
      ),
    );
    return;
  }
  event.respondWith(
    fetch(event.request).catch(async () => (await caches.match(SHELL)) ?? Response.error()),
  );
});
