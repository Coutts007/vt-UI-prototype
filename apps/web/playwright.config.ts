import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://localhost:4173' },
  projects: [{ name: 'chromium', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'pnpm build --mode mock && pnpm preview',
    env: { VITE_API_MODE: 'mock' },
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
