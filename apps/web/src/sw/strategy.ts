// What the service worker may do with a request. Kept pure so the privacy rule can be tested.
export type Strategy = 'network-only' | 'cache-first' | 'vision-cache' | 'network-first-shell';

export function strategyFor(request: { url: string; method: string; mode?: string }, origin: string): Strategy {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== origin) return 'network-only';
  // Golden rule: API data never enters Cache Storage.
  if (url.pathname.startsWith('/api/')) return 'network-only';
  // Models and WASM are versioned separately and survive an app update (D37).
  if (/^\/(models|wasm|opencv)\//.test(url.pathname)) return 'vision-cache';
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/audio/') || url.pathname === '/vision-manifest.json' || url.pathname === '/vt-measuring-sheet-A4.pdf') return 'cache-first';
  if (request.mode === 'navigate') return 'network-first-shell';
  return 'network-only';
}
