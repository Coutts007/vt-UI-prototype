// The browser suites on the real API, through Caddy with the production Caddyfile (M8, M12).
// Needs the stack from `make e2e-real-api`: deploy/docker-compose.e2e.yml serves dist-real-api.
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const BASE = process.env.VT_E2E_URL ?? 'https://localhost:8453';
const SYNTH = resolve(import.meta.dirname, 'tests/fixtures/video/generated/synth-front.y4m');
process.env.VT_E2E_REAL_API = '1';

const shared = {
  ...devices['Pixel 7'],
  baseURL: BASE,
  // Caddy's local authority signs the certificate; the browser need not trust it here.
  ignoreHTTPSErrors: true,
  // The worker caches files between runs, and these tests must see what the server says.
  serviceWorkers: 'block' as const,
};

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  workers: 2,
  use: {
    ...shared,
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  projects: [
    { name: 'real-api', testMatch: /(client|server-sync|tailor|study|csp|walkthrough)\.spec/ },
    // OpenCV.js and MediaPipe in their workers under the real CSP, on the synthetic clip.
    {
      name: 'real-vision-csp',
      testMatch: /real-vision/,
      retries: 1,
      use: {
        ...shared,
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${SYNTH}`,
          ],
        },
      },
    },
  ],
});
