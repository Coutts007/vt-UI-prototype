import { defineConfig, devices } from '@playwright/test';

const OFF_PORT = 4183;

export default defineConfig({
  testDir: 'tests/e2e',
  use: {
    baseURL: 'http://localhost:4173',
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
      command: 'pnpm build --mode mock && pnpm preview',
      env: { VITE_API_MODE: 'mock' },
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm build --mode mock --outDir dist-directory-off && pnpm exec vite preview --outDir dist-directory-off --port ${OFF_PORT} --strictPort`,
      env: { VITE_API_MODE: 'mock', VITE_FEATURE_DIRECTORY: 'false' },
      url: `http://localhost:${OFF_PORT}`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
