// The real camera, MediaPipe and OpenCV.js against Chromium's fake camera playing a synthetic figure.
// This shows the pipeline runs and frees its frames. It says nothing about a real phone (A10).
import { expect, Page, test } from '@playwright/test';
import { en } from '../../src/i18n/en';

const FREE_CODE = 'AB1008';

async function real(page: Page, extra: object = {}) {
  await page.addInitScript(
    (value) => {
      sessionStorage.setItem('vt_fake_vision', JSON.stringify(value));
    },
    { scenario: 'good', recover: false, speed: 1, real: true, ...extra },
  );
}

const value = (page: Page, label: string) => page.getByTestId(`real-${label}`);

async function tuningReady(page: Page) {
  await page.goto('/dev/capture-tuning');
  await page.getByTestId('real-switch').waitFor();
  await expect(page.getByTestId('real-first-failing')).not.toContainText('starting', {
    timeout: 90_000,
  });
}

test('real models and detector read the synthetic figure', async ({ page }) => {
  test.setTimeout(120_000);
  const outside: string[] = [];
  const posts: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== 'localhost') outside.push(request.url());
    if (request.method() !== 'GET' && !url.pathname.startsWith('/api/')) posts.push(request.url());
  });
  await real(page);
  await tuningReady(page);
  await expect(value(page, 'frame size')).toContainText('720 x 1280');
  await expect(value(page, 'marker side px')).not.toHaveText('-', { timeout: 30_000 });
  await expect(value(page, 'sheet')).toHaveText('pass');
  await expect(value(page, 'landmarks')).toContainText('33', { timeout: 30_000 });
  await expect(value(page, 'person')).toHaveText('pass');
  await expect(value(page, 'frame')).toBeVisible();
  await expect(value(page, 'light')).toHaveText('pass');
  await expect(value(page, 'problem')).toHaveCount(0);
  // Read-back of what the camera applied.
  await expect(value(page, 'camera')).toContainText('720 x 1280');
  expect(Number(await value(page, 'fps').innerText())).toBeGreaterThan(0);
  expect(outside).toEqual([]);
  expect(posts).toEqual([]);
});

test('leaving the page frees every frame and stops the camera', async ({ page }) => {
  test.setTimeout(120_000);
  await real(page);
  await page.addInitScript(() => {
    const seen: MediaStreamTrack[] = [];
    (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks = seen;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      seen.push(...stream.getTracks());
      return stream;
    };
  });
  await tuningReady(page);
  await page.getByTestId('real-switch').uncheck();
  await expect(page.getByTestId('real-first-failing')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.every(
          (track) => track.readyState === 'ended',
        ),
      ),
    )
    .toBe(true);
});

test('through the client flow: real download, then the front view is measured and everything is freed', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await real(page);
  // A laptop has no tilt sensor, so the test plays a level phone.
  await page.addInitScript(() => {
    setInterval(
      () =>
        window.dispatchEvent(
          new DeviceOrientationEvent('deviceorientation', { beta: 90, gamma: 0 }),
        ),
      100,
    );
  });
  const outside: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname !== 'localhost') outside.push(request.url());
  });

  await page.goto('/');
  await page.getByRole('button', { name: en.welcomeEnGo }).click();
  await page.getByLabel(en.clientCodeLabel).fill(FREE_CODE);
  await page.getByLabel(en.heightLabel).fill('170');
  await page.getByText(en.sexFemale, { exact: true }).click();
  await page.getByRole('button', { name: en.continue, exact: true }).click();
  for (const box of [en.consentBox1, en.consentBox2, en.consentBox3]) {
    await page.getByText(box, { exact: true }).click();
  }
  await page.getByRole('button', { name: en.openCamera }).click();
  await page.getByRole('button', { name: en.continue, exact: true }).click({ timeout: 15_000 });
  await page.getByText(en.sheetOptionTailor, { exact: true }).click();
  await page.getByRole('button', { name: en.printCheckYes }).click();
  await page.getByRole('button', { name: en.continue, exact: true }).click();
  await expect(page).toHaveURL(/\/setup/);

  await page.getByRole('button', { name: en.downloadNow }).click();
  await expect(page.getByText(en.downloadDone)).toBeVisible({ timeout: 60_000 });
  const stored = await page.evaluate(async () => {
    const manifest = (await (await fetch('/vision-manifest.json')).json()) as {
      version: string;
      files: { url: string; bytes: number }[];
    };
    const cache = await caches.open(`vt-vision-${manifest.version}`);
    return { wanted: manifest.files.length, have: (await cache.keys()).length };
  });
  expect(stored.have).toBeGreaterThanOrEqual(stored.wanted - 1);

  await page.getByRole('button', { name: en.continue, exact: true }).click();
  await page.getByRole('button', { name: en.continue, exact: true }).click();
  await page.getByRole('button', { name: en.allowCamera }).click();
  await page.getByRole('button', { name: en.allowMotion }).click();
  await page.getByRole('button', { name: en.volumePlay }).click();
  await page.getByRole('button', { name: en.volumeYes }).click();
  const start = page.getByRole('button', { name: en.readyStart });
  await expect(start).toBeEnabled({ timeout: 10_000 });
  await start.click();

  // The real pipeline runs the nine checks, then the burst, and moves to the side view.
  await expect(page).toHaveURL(/\/capture\/side/, { timeout: 150_000 });

  // The figure faces the camera, so the side view keeps asking the client to turn.
  await expect(page.locator('[data-check="checkFacing"]')).toHaveAttribute('data-result', 'fail', {
    timeout: 60_000,
  });
  await page.getByRole('button', { name: en.stopMeasuringConfirm }).click();
  await page.getByRole('button', { name: en.stopMeasuring, exact: true }).click();
  await expect(page).toHaveURL(/\/setup/);

  // The memory-release test against real workers (2.1 invariant 2).
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const w = window as unknown as {
          __vtFrames?: () => { bitmap: number; mask: number };
          __vtWorkerBitmaps?: () => number;
        };
        return { ...w.__vtFrames?.(), workers: w.__vtWorkerBitmaps?.() };
      }),
    )
    .toEqual({ bitmap: 0, mask: 0, workers: 0 });
  expect(outside).toEqual([]);
});
