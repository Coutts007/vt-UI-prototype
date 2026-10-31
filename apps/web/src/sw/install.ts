// Holds the browser's install prompt until the Saved screen can offer it (9.14).
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
}

let deferred: InstallPrompt | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as InstallPrompt;
  });
}

export const canInstall = () => deferred !== null;

export async function promptInstall(): Promise<void> {
  await deferred?.prompt();
  deferred = null;
}

export const isIos = () => /iPhone|iPad/.test(navigator.userAgent);
