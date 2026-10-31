import { defineConfig, devices } from '@playwright/test';

// Move these with VT_E2E_PORT to run two checkouts side by side.
const PORT = Number(process.env.VT_E2E_PORT ?? 4173);
const OFF_PORT = PORT + 10;
const DEFAULT_PORT = PORT + 11;

export default defineConfig({
  testDir: 'tests/e2e',
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Pixel 7'] }, testIgnore: /directory-off/ },
    // A real build with the directory switched off (D27), so nothing depends on a runtime switch.
    {
      name: 'directory-off',
      use: { ...devices['Pixel 7'], baseURL: `http://localhost:${OFF_PORT}` },
      testMatch: /directory-off/,
    },
  ],
  webServer: [
    {
      command: `pnpm build --mode mock && pnpm exec vite preview --port ${PORT} --strictPort`,
      env: { VITE_API_MODE: 'mock' },
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm build --mode mock --outDir dist-directory-off && pnpm exec vite preview --outDir dist-directory-off --port ${OFF_PORT} --strictPort`,
      env: { VITE_API_MODE: 'mock', VITE_FEATURE_DIRECTORY: 'false' },
      url: `http://localhost:${OFF_PORT}`,
      reuseExistingServer: !process.env.CI,
    },
    // What production really gets: production mode, with neither switch set at all.
    {
      command: `env -u VITE_FEATURE_DIRECTORY -u VITE_API_MODE pnpm build --outDir dist-directory-default && pnpm exec vite preview --outDir dist-directory-default --port ${DEFAULT_PORT} --strictPort`,
      url: `http://localhost:${DEFAULT_PORT}`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
