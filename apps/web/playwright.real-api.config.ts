// The client suite on the real API (M8). Needs the stack from deploy/docker-compose.e2e.yml.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.VT_E2E_PORT ?? 4190);
const API = process.env.VT_API_PROXY ?? 'http://localhost:8010';
process.env.VT_E2E_REAL_API = '1';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /(client|server-sync|tailor)\.spec/,
  workers: 2,
  use: {
    ...devices['Pixel 7'],
    baseURL: `http://localhost:${PORT}`,
    // The worker caches files between runs, and these tests must see what the server says.
    serviceWorkers: 'block',
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  webServer: {
    // Mock mode keeps the fake vision worker; VITE_API_MODE=http sends every request to the API.
    command: `pnpm build --mode mock --outDir dist-real-api && pnpm exec vite preview --outDir dist-real-api --port ${PORT} --strictPort`,
    env: { VITE_API_MODE: 'http', VT_API_PROXY: API },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
  },
});
