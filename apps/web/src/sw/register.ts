export function registerServiceWorker(onUpdate: (apply: () => void) => void): void {
  if (!import.meta.env.PROD || import.meta.env.VITE_API_MODE === 'mock') return;
  if (!('serviceWorker' in navigator)) return;
  // A first install also takes control, and must not reload a page already in use.
  const hadController = Boolean(navigator.serviceWorker.controller);
  void navigator.serviceWorker.register('/sw.js').then((registration) => {
    const offer = (worker: ServiceWorker) => onUpdate(() => worker.postMessage('skip-waiting'));
    if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) window.location.reload();
    });
  });
}
