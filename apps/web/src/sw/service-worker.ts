/// <reference lib="webworker" />
// Shell only (A13). Models and WASM join the precache in M6. It never caches /api/.
import { strategyFor } from './strategy';

declare const self: ServiceWorkerGlobalScope;
// The build replaces this with "<version>,<file>,<file>..." (see vite.config.ts).
const [VERSION, ...FILES] = '__VT_PRECACHE__'.split(',');
const CACHE = `vt-shell-${VERSION}`;
const SHELL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([SHELL, ...FILES])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const strategy = strategyFor(event.request, self.location.origin);
  if (strategy === 'network-only') return;
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
