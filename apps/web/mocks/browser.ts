import { setupWorker } from 'msw/browser';
import { FAILURE_KEY } from './failure';
import { createHandlers } from './handlers';

let started: Promise<unknown> | null = null;

/** Started once, however many callers ask: main.tsx and the API client both do. */
export async function startMockWorker(): Promise<void> {
  started ??= boot();
  await started;
}

async function boot(): Promise<void> {
  const worker = setupWorker(
    ...createHandlers({
      latency: () => 150 + Math.random() * 450,
      failure: () => Number(sessionStorage.getItem(FAILURE_KEY)) || null,
    }),
  );
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
}
