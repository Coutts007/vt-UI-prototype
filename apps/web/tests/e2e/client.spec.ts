// Client flow scenarios of frontend-spec 21.1, on the fake vision worker and the MSW mock.
import AxeBuilder from '@axe-core/playwright';
import { expect, Page, test } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { freshCode } from './real-api';
import { en } from '../../src/i18n/en';
import { sw } from '../../src/i18n/sw';

test.use({ actionTimeout: 15_000 });

type Dict = typeof en;
const REAL_API = process.env.VT_E2E_REAL_API === '1';
const ASSETS = join(
  import.meta.dirname,
  REAL_API ? '../../dist-real-api/assets' : '../../dist/assets',
);
let FREE_CODE = 'AB1008';

// The real API remembers between tests, so each test needs a code nobody has measured under.
test.beforeEach(async ({ request }) => {
  if (REAL_API) FREE_CODE = await freshCode(request);
});

interface Fake {
  scenario?: string;
  recover?: boolean;
  speed?: number;
}

async function fake(page: Page, options: Fake = {}) {
  await page.addInitScript(
    (value) => {
      sessionStorage.setItem('vt_fake_vision', JSON.stringify(value));
    },
    { scenario: 'good', recover: false, speed: 0.1, ...options },
  );
}

// Stands in for the service worker's precache, which the mock build does not run.
async function preloadChunks(page: Page) {
  const names = readdirSync(ASSETS).filter((name) =>
    /^(WelcomeView|StartView|ConsentView|PhoneCheckView|SheetGuideView|PhoneSetupView|CaptureView|ProcessingView|compute|ReviewView|SavedView|MyMeasurementsView|sync|fakeVision|en|sw)-.*\.js$/.test(
      name,
    ),
  );
  await page.evaluate(async (list) => {
    await Promise.all(list.map((name) => import(/* @vite-ignore */ `/assets/${name}`)));
  }, names);
}

async function details(page: Page, d: Dict, code: string) {
  await page.getByLabel(d.clientCodeLabel).fill(code);
  await page.getByLabel(d.heightLabel).fill('170');
  await page.getByText(d.sexFemale, { exact: true }).click();
}

async function toConsent(page: Page, d: Dict, code = FREE_CODE) {
  await page.goto('/');
  await page.getByRole('button', { name: d === sw ? sw.welcomeSwGo : en.welcomeEnGo }).click();
  await expect(page).toHaveURL(/\/start/);
  await details(page, d, code);
  await page.getByRole('button', { name: d.continue, exact: true }).click();
  await expect(page).toHaveURL(/\/consent/);
}

async function agree(page: Page, d: Dict) {
  for (const box of [d.consentBox1, d.consentBox2, d.consentBox3]) {
    await page.getByText(box, { exact: true }).click();
  }
  await page.getByRole('button', { name: d.openCamera }).click();
  await expect(page).toHaveURL(/\/check/);
}

async function toPlacePhone(page: Page, d: Dict) {
  await page.getByRole('button', { name: d.continue, exact: true }).click({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/sheet/);
  await page.getByText(d.sheetOptionTailor, { exact: true }).click();
  await page.getByRole('button', { name: d.printCheckYes }).click();
  await page.getByRole('button', { name: d.continue, exact: true }).click();
  await expect(page).toHaveURL(/\/setup/);
  await page.getByRole('button', { name: d.downloadLater }).click();
  await page.getByRole('button', { name: d.continue, exact: true }).click();
  await page.getByRole('button', { name: d.allowCamera }).click();
  const motion = page.getByRole('button', { name: d.allowMotion });
  const place = page.getByRole('heading', { name: d.placePhoneTitle });
  await motion.or(place).first().waitFor();
  if (await motion.isVisible()) await motion.click();
  await place.waitFor();
}

async function startCapture(page: Page, d: Dict) {
  await page.getByRole('button', { name: d.volumePlay }).click();
  await page.getByRole('button', { name: d.volumeYes }).click();
  const start = page.getByRole('button', { name: d.readyStart });
  await expect(start).toBeEnabled({ timeout: 10_000 });
  await start.click();
  await expect(page).toHaveURL(/\/capture\/front/);
}

async function toCapture(page: Page, d: Dict = en, code = FREE_CODE) {
  await toConsent(page, d, code);
  await agree(page, d);
  await toPlacePhone(page, d);
  await startCapture(page, d);
}

const toReview = async (page: Page, d: Dict = en, code = FREE_CODE) => {
  await toCapture(page, d, code);
  await expect(page).toHaveURL(/\/review/, { timeout: 120_000 });
};

const spoken = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vtSpoken: string[] }).__vtSpoken);

async function saveAndSee(page: Page, d: Dict) {
  await page.getByRole('button', { name: d.saveAndSend }).click();
  await expect(page).toHaveURL(/\/saved/);
}

for (const [name, d] of [
  ['English', en],
  ['Kiswahili', sw],
] as const) {
  test(`full client flow in ${name}`, async ({ page }) => {
    test.setTimeout(180_000);
    // Real time: at test speed each clip is cut off by the next before it can sound.
    await fake(page, { speed: 1 });
    await toReview(page, d);
    await expect(page.getByRole('heading', { name: d.reviewTitle })).toBeVisible();
    await expect(page.getByTestId('site-list').getByRole('listitem')).toHaveCount(8);
    await expect(page.getByTestId('height-line')).toContainText('170');
    await saveAndSee(page, d);
    await expect(page.getByRole('heading', { name: d.savedTitleSynced })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(FREE_CODE)).toBeVisible();
    await expect(page.getByRole('button', { name: d.tellTailorWhatsApp })).toBeVisible();
    expect(await spoken(page)).toEqual(
      expect.arrayContaining(['walk_away', 'n3', 'hold_still', 'done', 'turn_right', 'finished']),
    );
  });
}

test('refusing consent stops the flow and saves nothing', async ({ page }) => {
  await fake(page);
  await toConsent(page, en);
  await expect(page.getByRole('button', { name: en.openCamera })).toBeDisabled();
  await page.getByRole('button', { name: en.iDoNotAgree }).click();
  await expect(page).toHaveURL(/\/declined/);
  await page.goto('/me');
  await expect(page.getByText(en.noMeasurementsYet)).toBeVisible();
});

test('a denied camera shows browser steps and a retry', async ({ page }) => {
  await fake(page);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('no', 'NotAllowedError'));
  });
  await toConsent(page, en);
  await agree(page, en);
  await page.goto('/setup');
  await page.getByRole('button', { name: en.downloadLater }).click();
  await page.getByRole('button', { name: en.continue, exact: true }).click();
  await page.getByRole('button', { name: en.allowCamera }).click();
  await expect(page.getByText(en.cameraDeniedChrome)).toBeVisible();
  await expect(page.getByRole('button', { name: en.retry })).toBeVisible();
});

test('denied motion on iOS skips the level check with a notice', async ({ page }) => {
  await fake(page);
  await page.addInitScript(() => {
    (
      DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }
    ).requestPermission = () => Promise.resolve('denied');
  });
  await toConsent(page, en);
  await agree(page, en);
  await toPlacePhone(page, en);
  await expect(page.getByText(en.levelSkippedNotice)).toBeVisible();
});

const FAILING: [string, string][] = [
  ['level_fail', 'corr_tilt'],
  ['no_person', 'corr_step_in'],
  ['cut_off', 'corr_head_cut'],
  ['too_far', 'corr_too_far'],
  ['too_close', 'corr_too_close'],
  ['not_facing', 'corr_turn_face'],
  ['arms_tucked', 'corr_arms_away'],
  ['sheet_missing', 'corr_sheet_flat'],
  ['sheet_fingers', 'corr_fingers'],
  ['sheet_small', 'corr_step_closer'],
  ['too_dark', 'corr_too_dark'],
  ['too_bright', 'corr_too_bright'],
];

for (const [scenario, clip] of FAILING) {
  test(`${scenario} fails with its correction, then recovers`, async ({ page }) => {
    test.setTimeout(180_000);
    await fake(page, { scenario, recover: true, speed: 1 });
    // The level check is skipped without a tilt sensor, so this phone needs one it may use.
    await page.addInitScript(() => {
      (
        DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }
      ).requestPermission = () => Promise.resolve('granted');
      setInterval(() => {
        window.dispatchEvent(
          new DeviceOrientationEvent('deviceorientation', { beta: 90, gamma: 0 }),
        );
      }, 100);
    });
    await toReview(page);
    expect(await spoken(page)).toContain(clip);
  });
}

test('a scale disagreement asks for a retake of that view', async ({ page }) => {
  test.setTimeout(120_000);
  await fake(page, { scenario: 'scale_disagree' });
  await toReview(page);
  await expect(page.getByText(en.scaleBanner.replace('{view}', en.viewFront))).toBeVisible();
  await page.getByRole('button', { name: en.retakeFront }).click();
  await expect(page).toHaveURL(/\/capture\/front/);
  await expect(page).toHaveURL(/\/review/, { timeout: 60_000 });
  await expect(page.getByText(en.scaleBanner.replace('{view}', en.viewFront))).toHaveCount(0);
});

test('saved offline, then sent when back online', async ({ page, context }) => {
  test.setTimeout(120_000);
  await fake(page);
  await toReview(page);
  await preloadChunks(page);
  await context.setOffline(true);
  await saveAndSee(page, en);
  await expect(page.getByRole('heading', { name: en.savedTitlePending })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole('heading', { name: en.savedTitleSynced })).toBeVisible({
    timeout: 30_000,
  });
});

test('a conflict tells the client a newer version is saved', async ({ page }) => {
  test.setTimeout(180_000);
  await fake(page);
  if (!REAL_API) {
    // The mock forgets on reload, and answers in a service worker page.route cannot see.
    await page.addInitScript(() => {
      const real = window.fetch.bind(window);
      window.fetch = (input, init) =>
        String(input instanceof Request ? input.url : input).endsWith('/api/v1/profiles')
          ? Promise.resolve(
              new Response(
                JSON.stringify({
                  type: 'about:blank',
                  title: 'Conflict',
                  status: 409,
                  code: 'profile_version_conflict',
                  server_version: 2,
                  conflict_id: '00000000-0000-5000-8000-000000000009',
                }),
                { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
              ),
            )
          : real(input, init);
    });
    await toReview(page, en, FREE_CODE);
    await saveAndSee(page, en);
    await expect(page.getByRole('heading', { name: en.savedTitleConflict })).toBeVisible({
      timeout: 15_000,
    });
    return;
  }
  await toReview(page, en, FREE_CODE);
  await saveAndSee(page, en);
  await expect(page.getByRole('heading', { name: en.savedTitleSynced })).toBeVisible({
    timeout: 30_000,
  });
  // As if this phone lost its local copy but kept its secret: the next capture repeats a version.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('virtual_tailor');
        open.onsuccess = () => {
          const tx = open.result.transaction(['profiles', 'settings'], 'readwrite');
          tx.objectStore('profiles').clear();
          tx.objectStore('settings').clear();
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await toReview(page, en, FREE_CODE);
  await saveAndSee(page, en);
  await expect(page.getByRole('heading', { name: en.savedTitleConflict })).toBeVisible({
    timeout: 15_000,
  });
});

test('an unknown code is rejected and can be changed', async ({ page, context }) => {
  test.setTimeout(120_000);
  await fake(page);
  await page.goto('/');
  await page.getByRole('button', { name: en.welcomeEnGo }).click();
  await expect(page).toHaveURL(/\/start/);
  await preloadChunks(page);
  await context.setOffline(true);
  await details(page, en, 'ZZ9999');
  await page.getByRole('button', { name: en.continue, exact: true }).click();
  await expect(page).toHaveURL(/\/consent/);
  await context.setOffline(false);
  await agree(page, en);
  await toPlacePhone(page, en);
  await startCapture(page, en);
  await expect(page).toHaveURL(/\/review/, { timeout: 60_000 });
  await saveAndSee(page, en);
  await expect(page.getByRole('heading', { name: en.savedTitleRejected })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel(en.clientCodeLabel).fill(FREE_CODE);
  await page.getByRole('button', { name: en.changeCode }).click();
  await expect(page.getByRole('heading', { name: en.savedTitleSynced })).toBeVisible({
    timeout: 15_000,
  });
});

test('delete my data clears the phone after two confirmations', async ({ page }) => {
  test.setTimeout(120_000);
  await fake(page);
  await toReview(page);
  await saveAndSee(page, en);
  await expect(page.getByRole('heading', { name: en.savedTitleSynced })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: en.done, exact: true }).click();
  await page.getByTestId('profile-list').getByRole('button').first().click();
  await expect(page.getByTestId('checks-summary')).toBeVisible();
  await page.getByRole('button', { name: en.deleteMyData }).click();
  await page.getByRole('dialog').getByRole('button', { name: en.confirm }).click();
  await expect(page.getByText(en.deleteSecondConfirm)).toBeVisible();
  await page.getByRole('button', { name: en.deleteYes }).click();
  await expect(page.getByText(en.noMeasurementsYet)).toBeVisible();
});

for (const [name, d] of [
  ['English', en],
  ['Kiswahili', sw],
] as const) {
  test(`capture and review pass axe in ${name}`, async ({ page }) => {
    test.setTimeout(120_000);
    await fake(page, { scenario: 'too_far' });
    await toCapture(page, d);
    await expect(page.getByTestId('instruction')).toHaveText(d.corrTooFar, { timeout: 20_000 });
    const scan = async () =>
      (await new AxeBuilder({ page }).analyze()).violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`));
    expect(await scan()).toEqual([]);
  });
}

test('nothing leaves the phone but numbers: no image, no outside request', async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  await fake(page);
  const outside: string[] = [];
  const posted: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (
      !url.startsWith(baseURL ?? 'missing base URL') &&
      !url.startsWith('data:') &&
      !url.startsWith('blob:')
    ) {
      outside.push(url);
    }
    const body = request.postData();
    if (body) posted.push(body);
    if (/\.(png|jpe?g|webp)$/.test(new URL(url).pathname) && request.method() !== 'GET') {
      outside.push(url);
    }
  });
  await toReview(page);
  await saveAndSee(page, en);
  await expect(page.getByRole('heading', { name: en.savedTitleSynced })).toBeVisible({
    timeout: 15_000,
  });
  expect(outside).toEqual([]);
  expect(posted.join('\n')).not.toMatch(/data:image|base64|"mask"|"landmarks"/);
  const stored = await page.evaluate(async () => {
    const rows: unknown[] = [];
    for (const { name } of await indexedDB.databases()) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const all = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(store).objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        rows.push(...all);
      }
      db.close();
    }
    return JSON.stringify({ rows, local: { ...localStorage }, session: { ...sessionStorage } });
  });
  expect(stored).toContain(FREE_CODE);
  expect(stored).not.toMatch(/data:image|base64|"mask"|"landmarks"|ImageData/);
});

// The front camera (A4): the fake camera answers either facing, and says what it can deliver.
async function frontCamera(page: Page, maxLongEdge: number) {
  await page.addInitScript((max) => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const asked: string[] = [];
    (window as unknown as { __vtFacing: string[] }).__vtFacing = asked;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const video = (constraints?.video ?? {}) as MediaTrackConstraints;
      const exact = (video.facingMode as { exact?: string } | undefined)?.exact;
      asked.push(exact ?? 'environment');
      const stream = await original({ ...constraints, video: { ...video, facingMode: undefined } });
      for (const track of stream.getVideoTracks()) {
        track.getCapabilities = () => ({
          width: { max: 1080 },
          height: { max: exact ? max : 1920 },
        });
      }
      return stream;
    };
  }, maxLongEdge);
}

async function chooseFrontCamera(page: Page, d: Dict) {
  await page.getByRole('button', { name: d.continue, exact: true }).click({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/sheet/);
  await page.getByText(d.sheetOptionTailor, { exact: true }).click();
  await page.getByRole('button', { name: d.printCheckYes }).click();
  await page.getByRole('button', { name: d.continue, exact: true }).click();
  await expect(page).toHaveURL(/\/setup/);
  await page.getByRole('button', { name: d.downloadLater }).click();
  await page.getByText(d.seeScreenYes, { exact: true }).click();
  await page.getByRole('button', { name: d.continue, exact: true }).click();
  await page.getByRole('button', { name: d.allowCamera }).click();
  const motion = page.getByRole('button', { name: d.allowMotion });
  const place = page.getByRole('heading', { name: d.placePhoneTitle });
  await motion.or(place).first().waitFor();
  if (await motion.isVisible()) await motion.click();
  await place.waitFor();
}

test('the front camera is a mirror with visual guidance, and the record says so (A4)', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await fake(page);
  await frontCamera(page, 1920);
  const posted: string[] = [];
  page.on('request', (request) => {
    const body = request.postData();
    if (body) posted.push(body);
  });
  await toConsent(page, en);
  await agree(page, en);
  await chooseFrontCamera(page, en);
  // No volume check: the client sees the screen (A4).
  await expect(page.getByRole('button', { name: en.volumePlay })).toHaveCount(0);
  const start = page.getByRole('button', { name: en.readyStart });
  await expect(start).toBeEnabled({ timeout: 10_000 });
  await start.click();
  await expect(page).toHaveURL(/\/capture\/front/);
  const main = page.locator('main[data-camera="user"][data-guidance="visual"]');
  await expect(main).toBeVisible();
  await expect(main.locator('video')).toHaveCSS('transform', 'matrix(-1, 0, 0, 1, 0, 0)');
  expect(
    await page.evaluate(() => (window as unknown as { __vtFacing: string[] }).__vtFacing),
  ).toContain('user');
  await expect(page).toHaveURL(/\/review/, { timeout: 120_000 });
  await saveAndSee(page, en);
  await expect(page.getByRole('heading', { name: en.savedTitleSynced })).toBeVisible({
    timeout: 15_000,
  });
  const profile = posted.find((body) => body.includes('"session"'))!;
  expect(profile).toContain('"camera_facing":"user"');
  expect(profile).toContain('"guidance_mode":"visual"');
  expect(profile).toContain('"capture_mode":"self"');
});

test('a front camera below 1080p falls back to the rear camera and is not offered again (A4)', async ({
  page,
}) => {
  await fake(page);
  await frontCamera(page, 1280);
  await toConsent(page, en);
  await agree(page, en);
  await chooseFrontCamera(page, en);
  await expect(page.getByText(en.frontCameraTooSmall)).toBeVisible();
  // Back on voice guidance, so the volume check is asked for.
  await expect(page.getByRole('button', { name: en.volumePlay })).toBeVisible();
  await startCapture(page, en);
  await expect(
    page.locator('main[data-camera="environment"][data-guidance="voice"]'),
  ).toBeVisible();
  await page.goto('/setup');
  await page.getByRole('button', { name: en.downloadLater }).click();
  await expect(page.getByText(en.whoTakingPhotos)).toBeVisible();
  await expect(page.getByText(en.seeScreenQuestion)).toHaveCount(0);
});

test('the dev page downloads the capture log as numbers only (M15)', async ({ page }) => {
  test.setTimeout(150_000);
  await fake(page);
  await toReview(page);
  // In the app, so the log kept in memory survives.
  await page.evaluate(() => {
    history.pushState(null, '', '/dev/capture-tuning');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByTestId('session-log-count')).toContainText(/[1-9]\d* samples/);
  const waiting = page.waitForEvent('download');
  await page.getByTestId('download-log').click();
  const download = await waiting;
  expect(download.suggestedFilename()).toMatch(/^vt-capture-log-.*\.json$/);
  const text = await (await import('node:fs/promises')).readFile(await download.path(), 'utf8');
  const log = JSON.parse(text) as {
    meta: Record<string, unknown>;
    events: { event: string }[];
    samples: unknown[];
  };
  expect(log.meta.camera_facing).toBe('environment');
  expect(log.meta.guidance_mode).toBe('voice');
  expect(log.events.map((e) => e.event)).toEqual(
    expect.arrayContaining(['walk_away', 'countdown', 'burst', 'view_done']),
  );
  expect(log.samples.length).toBeGreaterThan(0);
  expect(text).not.toMatch(/data:image|base64|"mask"|"landmarks"|AB10/);
});

test('stopping a retake returns to the reviewed result', async ({ page }) => {
  test.setTimeout(120_000);
  await fake(page);
  await toReview(page);
  await page.getByRole('button', { name: en.retakeSide }).click();
  await expect(page).toHaveURL(/\/capture\/side/);
  await page.getByRole('button', { name: en.stopMeasuringConfirm }).click();
  await page.getByRole('dialog').getByRole('button', { name: en.stopMeasuring }).click();
  await expect(page).toHaveURL(/\/review/);
  await expect(page.getByRole('button', { name: en.saveAndSend })).toBeVisible();
});

test('details typed on Start survive a reload', async ({ page }) => {
  await fake(page);
  await page.goto(`/start?code=${FREE_CODE}`);
  await page.getByLabel(en.heightLabel).fill('172');
  await page.getByText(en.sexMale, { exact: true }).click();
  await expect(page.getByLabel(en.clientCodeLabel)).toHaveValue(FREE_CODE);
  await page.waitForTimeout(300);
  await page.goto('/start');
  await expect(page.getByLabel(en.heightLabel)).toHaveValue('172');
  await expect(page.getByLabel(en.clientCodeLabel)).toHaveValue(FREE_CODE);
});

test('after clearing, the sync timer does not bring back the earlier client', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await fake(page);
  await toReview(page);
  await preloadChunks(page);
  await context.setOffline(true);
  await saveAndSee(page, en);
  await page.getByRole('button', { name: en.sharedPhonePrompt }).click();
  await expect(page.getByText(en.sharedPhoneUnsent.replace('{n}', '1'))).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: en.confirm }).click();
  await expect(page.getByText(en.detailsCleared)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await context.setOffline(false);
  await expect(page.getByText(FREE_CODE)).toHaveCount(0);
  await page.goto('/me');
  await expect(page.getByText(FREE_CODE)).toHaveCount(0);
});

test('a later rejection can be corrected from My measurements', async ({ page, context }) => {
  test.setTimeout(120_000);
  await fake(page);
  await page.goto('/');
  await page.getByRole('button', { name: en.welcomeEnGo }).click();
  await expect(page).toHaveURL(/\/start/);
  await preloadChunks(page);
  await context.setOffline(true);
  await details(page, en, 'ZZ9999');
  await page.getByRole('button', { name: en.continue, exact: true }).click();
  await expect(page).toHaveURL(/\/consent/);
  await context.setOffline(false);
  await agree(page, en);
  await toPlacePhone(page, en);
  await startCapture(page, en);
  await expect(page).toHaveURL(/\/review/, { timeout: 60_000 });
  await saveAndSee(page, en);
  await expect(page.getByRole('heading', { name: en.savedTitleRejected })).toBeVisible({
    timeout: 15_000,
  });
  await page.goto('/me');
  await expect(page.getByText(en.syncRejectedNotice)).toBeVisible();
  await page.getByTestId('profile-list').getByRole('button').first().click();
  await page.getByLabel(en.clientCodeLabel).fill(FREE_CODE);
  await page.getByRole('button', { name: en.changeCode }).click();
  await expect(page.getByRole('button', { name: en.changeCode })).toHaveCount(0);
});
