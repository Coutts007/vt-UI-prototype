// Device pre-flight rules (frontend-spec 9.4, A7).
import { describe, expect, it } from 'vitest';
import {
  PreflightFacts,
  overallVerdict,
  parseBrowser,
  runPreflight,
  SIMD_PROBE,
} from '../../src/capture/preflight';

const ok: PreflightFacts = {
  secure: true,
  browser: { name: 'Chrome', version: 120 },
  simd: true,
  memoryGb: 4,
  videoInputs: 1,
  streamMax: 1920,
  motion: 'working',
  freeMb: 5000,
  modelsCached: false,
};
const status = (changes: Partial<PreflightFacts>, id: string) =>
  runPreflight({ ...ok, ...changes }).find((item) => item.id === id)!.status;

describe('rules', () => {
  it('a good phone is ready', () => {
    expect(overallVerdict(runPreflight(ok))).toBe('ready');
  });
  it.each([
    [{ secure: false }, 'secure', 'fail'],
    [{ browser: { name: 'Chrome', version: 90 } }, 'browser', 'fail'],
    [{ browser: { name: 'Chrome', version: 91 } }, 'browser', 'caution'],
    [{ browser: { name: 'Chrome', version: 105 } }, 'browser', 'pass'],
    [{ browser: { name: 'Safari', version: 16.3 } }, 'browser', 'fail'],
    [{ browser: { name: 'Safari', version: 16.4 } }, 'browser', 'pass'],
    [{ browser: { name: 'Samsung', version: 15 } }, 'browser', 'fail'],
    [{ browser: { name: 'other', version: 0 } }, 'browser', 'caution'],
    [{ simd: false }, 'simd', 'fail'],
    [{ memoryGb: 3 }, 'memory', 'caution'],
    [{ memoryGb: 2 }, 'memory', 'fail'],
    [{ memoryGb: null }, 'memory', 'pass'],
    [{ videoInputs: 0 }, 'camera', 'fail'],
    [{ streamMax: 1279 }, 'resolution', 'fail'],
    [{ streamMax: 1280 }, 'resolution', 'caution'],
    [{ streamMax: 1919 }, 'resolution', 'caution'],
    [{ streamMax: null }, 'resolution', 'pass'],
    [{ motion: 'absent' }, 'sensors', 'caution'],
    [{ motion: 'needs-permission' }, 'sensors', 'pass'],
    [{ freeMb: 99 }, 'storage', 'caution'],
    [{ freeMb: null }, 'storage', 'pass'],
  ] as [Partial<PreflightFacts>, string, string][])('%j gives %s %s', (changes, id, expected) => {
    expect(status(changes, id)).toBe(expected);
  });
  it('any fail wins, then any caution', () => {
    expect(overallVerdict(runPreflight({ ...ok, memoryGb: 3 }))).toBe('caution');
    expect(overallVerdict(runPreflight({ ...ok, memoryGb: 3, secure: false }))).toBe('fail');
  });
});

describe('parseBrowser', () => {
  it.each([
    [
      'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
      'Chrome',
      120,
    ],
    [
      'Mozilla/5.0 (Linux; Android 13) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
      'Samsung',
      23,
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) Version/16.4 Mobile/15E148 Safari/604.1',
      'Safari',
      16.4,
    ],
    ['Mozilla/5.0 Firefox/120.0', 'other', 0],
  ])('%s', (ua, name, version) => {
    expect(parseBrowser(ua)).toEqual({ name, version });
  });
});

it('the SIMD probe is a valid module where SIMD exists', () => {
  expect(WebAssembly.validate(SIMD_PROBE)).toBe(true);
});

it('the models row fails where no vision exists, and never claims otherwise', () => {
  const models = (visionAvailable: boolean) =>
    runPreflight({ ...ok, visionAvailable }).find((item) => item.id === 'models')?.status;
  expect(models(false)).toBe('fail');
  expect(models(true)).toBe('pass');
});
