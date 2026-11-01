import { describe, expect, it } from 'vitest';
import { combineBurst, median } from '../../src/capture/burst';
import { evaluateChecks, firstFailing } from '../../src/capture/checks';
import { VisionClient } from '../../src/vision/client';
import {
  DEFAULT_FAKE,
  FakeVisionWorker,
  RECOVER_AFTER_SAMPLES,
  SCENARIOS,
} from '../../src/vision/fakeVision';

const client = (options = {}) =>
  new VisionClient(new FakeVisionWorker({ ...DEFAULT_FAKE, ...options }));

function assertOnlyNumbers(value: unknown): void {
  if (value === null || ['number', 'boolean', 'undefined'].includes(typeof value)) return;
  if (value instanceof Uint8Array) return;
  if (Array.isArray(value)) return value.forEach(assertOnlyNumbers);
  if (typeof value === 'object') return Object.values(value).forEach(assertOnlyNumbers);
  throw new Error(`not a number: ${String(value)}`);
}

describe('FakeVisionWorker', () => {
  it.each(SCENARIOS)('%s returns numbers and masks only, never an image', async (scenario) => {
    const vision = client({ scenario });
    await vision.init(1700);
    assertOnlyNumbers(await vision.live());
    assertOnlyNumbers(await vision.burst('front'));
  });

  it('recovers after the failing samples', async () => {
    const vision = client({ scenario: 'too_far', recover: true });
    await vision.reset('front');
    const first = await vision.live();
    expect(firstFailing(evaluateChecks({ view: 'front', sample: first }).results)).toBe('distance');
    let last = first;
    for (let i = 0; i < RECOVER_AFTER_SAMPLES + 1; i++) last = await vision.live();
    expect(firstFailing(evaluateChecks({ view: 'front', sample: last }).results)).toBeNull();
  });

  it('burst_bad fails the first burst, then recovers', async () => {
    const vision = client({ scenario: 'burst_bad' });
    expect(combineBurst(await vision.burst('front'))).toBeNull();
    expect(combineBurst(await vision.burst('front'))).not.toBeNull();
  });

  it('crashes once or twice in compute, as chosen', async () => {
    const once = client({ scenario: 'compute_crash_once' });
    await expect(once.compute()).rejects.toThrow('worker_crash');
    await expect(once.compute()).resolves.toBeDefined();
    const twice = client({ scenario: 'compute_crash_twice' });
    await expect(twice.compute()).rejects.toThrow();
    await expect(twice.compute()).rejects.toThrow();
    await expect(twice.compute()).resolves.toBeDefined();
  });

  it('times out when a worker stops answering', async () => {
    const silent = {
      onmessage: null,
      postMessage: () => {},
      terminate: () => {},
    };
    const vision = new VisionClient(silent);
    await expect(vision.live()).rejects.toThrow('vision_timeout');
  }, 3000);
});

describe('burst', () => {
  it('takes the median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it('tolerates two bad frames but not three', async () => {
    const { frames } = await client().burst('front');
    expect(frames).toHaveLength(5);
    const two = frames.map((f, i) => (i < 2 ? { ...f, marker: null } : f));
    const combined = combineBurst({ frames: two })!;
    expect(combined.marker_confidence).toBeCloseTo(0.6 * 0.96, 2);
    expect(
      combineBurst({ frames: frames.map((f, i) => (i < 3 ? { ...f, landmarks: null } : f)) }),
    ).toBeNull();
  });
  it('confidence falls as the corners spread', async () => {
    const { frames } = await client().burst('front');
    const spread = frames.map((frame, i) => ({
      ...frame,
      marker: {
        ...frame.marker!,
        corners: frame.marker!.corners.map(([x, y]) => [x + i * 3, y]),
      },
    }));
    expect(combineBurst({ frames: spread })!.marker_confidence).toBeLessThan(
      combineBurst({ frames })!.marker_confidence,
    );
  });
});
