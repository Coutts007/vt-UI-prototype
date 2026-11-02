// The production build behind Caddy with rate limits on (M12). Needs `make stack-check`.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/stack',
  workers: 1,
  use: {
    ...devices['Pixel 7'],
    baseURL: process.env.VT_STACK_URL ?? 'https://localhost:8454',
    ignoreHTTPSErrors: true,
  },
});
