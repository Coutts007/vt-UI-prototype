// What the service worker may do with a request. Kept pure so the privacy rule can be tested.
export type Strategy = 'network-only' | 'cache-first' | 'network-first-shell';

export function strategyFor(request: { url: string; method: string; mode?: string }, origin: string): Strategy {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== origin) return 'network-only';
  // Golden rule: API data never enters Cache Storage.
  if (url.pathname.startsWith('/api/')) return 'network-only';
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) return 'cache-first';
  if (request.mode === 'navigate') return 'network-first-shell';
  return 'network-only';
}
