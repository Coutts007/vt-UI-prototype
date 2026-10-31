import { setupWorker } from 'msw/browser';
import { FAILURE_KEY } from './failure';
import { createHandlers } from './handlers';

export async function startMockWorker(): Promise<void> {
  const worker = setupWorker(
    ...createHandlers({
      latency: () => 150 + Math.random() * 450,
      failure: () => Number(sessionStorage.getItem(FAILURE_KEY)) || null,
    }),
  );
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
}
