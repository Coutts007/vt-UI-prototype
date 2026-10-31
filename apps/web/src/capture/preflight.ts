// The device pre-flight (frontend-spec 9.4, A7). The rules are pure, and gathering is separate.
import { visionAvailable } from '../vision/client';
import type { TranslationKey } from '../i18n/en';

export type PreflightStatus = 'pass' | 'caution' | 'fail';
export type Verdict = 'ready' | 'caution' | 'fail';

export interface PreflightFacts {
  secure: boolean;
  browser: { name: 'Chrome' | 'Safari' | 'Samsung' | 'other'; version: number };
  simd: boolean;
  memoryGb: number | null;
  videoInputs: number | null;
  /** Null until the camera has been allowed. */
  streamMax: number | null;
  motion: 'working' | 'absent' | 'needs-permission';
  freeMb: number | null;
  /** False where this build cannot measure at all. */
  visionAvailable?: boolean;
  modelsCached: boolean;
}

export interface PreflightItem {
  id: 'secure' | 'browser' | 'simd' | 'memory' | 'camera' | 'resolution' | 'sensors' | 'storage' | 'models';
  label: TranslationKey;
  status: PreflightStatus;
  message?: TranslationKey;
}

const FLOOR = { Chrome: 91, Samsung: 16, Safari: 16.4 };
const RECOMMENDED = { Chrome: 105, Samsung: 16, Safari: 16.4 };

export function parseBrowser(ua: string): PreflightFacts['browser'] {
  const samsung = /SamsungBrowser\/(\d+(?:\.\d+)?)/.exec(ua);
  if (samsung) return { name: 'Samsung', version: parseFloat(samsung[1]) };
  const chrome = /Chrome\/(\d+)/.exec(ua);
  if (chrome) return { name: 'Chrome', version: parseInt(chrome[1], 10) };
  const safari = /Version\/(\d+(?:\.\d+)?).*Safari/.exec(ua);
  if (safari) return { name: 'Safari', version: parseFloat(safari[1]) };
  return { name: 'other', version: 0 };
}

export function runPreflight(facts: PreflightFacts): PreflightItem[] {
  const { name, version } = facts.browser;
  const browser: PreflightStatus =
    name === 'other'
      ? 'caution'
      : version < FLOOR[name]
        ? 'fail'
        : version < RECOMMENDED[name]
          ? 'caution'
          : 'pass';
  const memory: PreflightStatus =
    facts.memoryGb === null ? 'pass' : facts.memoryGb <= 2 ? 'fail' : facts.memoryGb <= 3 ? 'caution' : 'pass';
  const resolution: PreflightStatus =
    facts.streamMax === null ? 'pass' : facts.streamMax < 1280 ? 'fail' : facts.streamMax < 1920 ? 'caution' : 'pass';
  const item = (
    id: PreflightItem['id'],
    label: TranslationKey,
    status: PreflightStatus,
    message: TranslationKey,
  ): PreflightItem => ({ id, label, status, message: status === 'pass' ? undefined : message });
  return [
    item('secure', 'checkSecure', facts.secure ? 'pass' : 'fail', 'pfSecure'),
    item('browser', 'checkBrowser', browser, 'pfBrowser'),
    item('simd', 'checkSIMD', facts.simd ? 'pass' : 'fail', 'pfSimd'),
    item('memory', 'checkMemory', memory, 'pfMemory'),
    item('camera', 'checkRearCamera', facts.videoInputs === 0 ? 'fail' : 'pass', 'pfCamera'),
    item('resolution', 'checkResolution', resolution, 'pfResolution'),
    item('sensors', 'checkSensors', facts.motion === 'absent' ? 'caution' : 'pass', 'pfMotion'),
    item('storage', 'checkStorage', facts.freeMb !== null && facts.freeMb < 100 ? 'caution' : 'pass', 'pfStorage'),
    item('models', 'checkModels', facts.visionAvailable === false ? 'fail' : 'pass', 'captureUnavailable'),
  ];
}

export function overallVerdict(items: PreflightItem[]): Verdict {
  if (items.some((item) => item.status === 'fail')) return 'fail';
  return items.some((item) => item.status === 'caution') ? 'caution' : 'ready';
}

// (module (func (result v128) i32.const 0 i8x16.splat i8x16.popcnt)): valid only where WebAssembly SIMD exists.
export const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

function motionFact(waitMs: number): Promise<PreflightFacts['motion']> {
  if (!('DeviceOrientationEvent' in window)) return Promise.resolve('absent');
  const ios = window.DeviceOrientationEvent as unknown as { requestPermission?: unknown };
  if (typeof ios.requestPermission === 'function') return Promise.resolve('needs-permission');
  return new Promise((resolve) => {
    const handler = () => {
      clearTimeout(timer);
      window.removeEventListener('deviceorientation', handler);
      resolve('working');
    };
    const timer = setTimeout(() => {
      window.removeEventListener('deviceorientation', handler);
      resolve('absent');
    }, waitMs);
    window.addEventListener('deviceorientation', handler);
  });
}

export async function gatherFacts(motionWaitMs: number): Promise<PreflightFacts> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  let videoInputs: number | null = null;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoInputs = devices.filter((device) => device.kind === 'videoinput').length;
  } catch {
    videoInputs = navigator.mediaDevices ? null : 0;
  }
  let freeMb: number | null = null;
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    freeMb = (quota - usage) / 1_048_576;
    void navigator.storage.persist?.();
  } catch {
    // Unknown: not a reason to stop.
  }
  let simd = false;
  try {
    simd = WebAssembly.validate(SIMD_PROBE);
  } catch {
    simd = false;
  }
  return {
    visionAvailable: visionAvailable(),
    secure: window.isSecureContext,
    browser: parseBrowser(navigator.userAgent),
    simd,
    memoryGb: nav.deviceMemory ?? null,
    videoInputs,
    streamMax: null,
    motion: await motionFact(motionWaitMs),
    freeMb,
    modelsCached: false,
  };
}

/** Device details for the session record. No names or numbers that identify a person. */
export function deviceSummary(facts: PreflightFacts): {
  device_model: string;
  browser: string;
  os: string;
  memory_gb: number | null;
  stream_max: number;
} {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad/.test(ua);
  const android = /Android (\d+)/.exec(ua);
  return {
    device_model: ios ? 'iPhone' : android ? 'Android' : 'other',
    browser: `${facts.browser.name} ${facts.browser.version}`.slice(0, 64),
    os: ios ? 'iOS' : android ? `Android ${android[1]}` : 'other',
    memory_gb: facts.memoryGb,
    stream_max: facts.streamMax ?? 0,
  };
}
