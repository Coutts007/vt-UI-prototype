import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const OFF_PORT = 4183;
const SYNTH = resolve(import.meta.dirname, 'tests/fixtures/video/generated/synth-front.y4m');

export default defineConfig({
  testDir: 'tests/e2e',
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  globalSetup: './tests/e2e/global-setup.ts',
  projects: [
    { name: 'chromium', use: { ...devices['Pixel 7'] }, testIgnore: /directory-off|real-vision/ },
    // A real build with the directory switched off (D27), so nothing depends on a runtime switch.
    {
      name: 'directory-off',
      use: { ...devices['Pixel 7'], baseURL: `http://localhost:${OFF_PORT}` },
      testMatch: /directory-off/,
    },
    // The real pipeline on a synthetic clip played as the camera (M6). Never a real person.
    {
      name: 'real-vision',
      testMatch: /real-vision/,
      // 1 run in 9 timed out on one worker with software rendering; see docs/PROGRESS.md (M6).
      retries: 1,
      use: {
        ...devices['Pixel 7'],
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
