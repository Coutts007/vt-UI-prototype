// Capture checks against synthetic fixtures, including each check state (frontend-spec 21.1).
import { describe, expect, it } from 'vitest';
import {
  CHECK_ORDER,
  CheckId,
  armMergedAtWaist,
  evaluateChecks,
  findFreeArm,
  firstFailing,
  landmarkJitter,
  maskBounds,
  toViewChecks,
} from '../../src/capture/checks';
import { CAPTURE_CONFIG, configHash } from '../../src/capture/config';
import { CORRECTION_CLIPS, MESSAGE_KEYS } from '../../src/capture/messages';
import { FakeVisionWorker, Scenario } from '../../src/vision/fakeVision';
import type { View, VisionSample } from '../../src/vision/types';

const sample = (scenario: Scenario, view: View = 'front', height = 1700): VisionSample => {
  const worker = new FakeVisionWorker();
  worker.postMessage({ id: 1, cmd: 'init', heightMm: height });
  return worker.live(scenario, view);
};
const judge = (scenario: Scenario, view: View = 'front') =>
  evaluateChecks({ view, sample: sample(scenario, view) });

describe('each check state', () => {
  it.each(['front', 'side'] as const)('the good case passes every check, %s', (view) => {
    const { results } = judge('good', view);
    expect(CHECK_ORDER.filter((id) => !results[id])).toEqual([]);
  });

  it.each([1200, 1500, 1700, 2000, 2200])('height %i passes', (height) => {
    const { results } = evaluateChecks({ view: 'front', sample: sample('good', 'front', height) });
    expect(firstFailing(results)).toBeNull();
  });

  const cases: [Scenario, View, CheckId, string][] = [
    ['level_fail', 'front', 'level', 'corrTilt'],
    ['no_person', 'front', 'person', 'corrStepIn'],
    ['no_person', 'side', 'person', 'corrStepIn'],
    ['cut_off', 'front', 'frame', 'corrHeadCut'],
    ['too_far', 'front', 'distance', 'corrTooFar'],
    ['too_close', 'front', 'distance', 'corrTooClose'],
    ['too_close', 'side', 'distance', 'corrTooClose'],
    ['not_facing', 'front', 'facing', 'corrTurnFace'],
    ['not_facing', 'side', 'facing', 'corrTurnRight'],
    ['arms_tucked', 'front', 'arms', 'corrArmsAway'],
    ['arms_tucked', 'side', 'arms', 'corrArmsForward'],
    ['sheet_missing', 'front', 'sheet', 'corrHoldSheetFlat'],
    ['sheet_fingers', 'front', 'sheet', 'corrMoveFingers'],
    ['sheet_tilted', 'front', 'sheet', 'corrHoldSheetFlat'],
    ['sheet_small', 'front', 'sheet', 'corrStepCloserSheet'],
    ['too_dark', 'front', 'light', 'corrTooDark'],
    ['too_bright', 'front', 'light', 'corrTooBright'],
    ['blurry', 'side', 'light', 'corrHoldStill'],
  ];
  it.each(cases)('%s in %s fails %s first, with %s', (scenario, view, check, correction) => {
    const outcome = judge(scenario, view);
    expect(firstFailing(outcome.results)).toBe(check);
    expect(outcome.corrections[check]).toBe(correction);
  });

  it('an unsteady person fails only stability', () => {
    const worker = new FakeVisionWorker();
    const history = Array.from({ length: 9 }, () => worker.live('unsteady', 'front').landmarks!);
    const outcome = evaluateChecks({
      view: 'front',
      sample: worker.live('unsteady', 'front'),
      history,
    });
    expect(firstFailing(outcome.results)).toBe('stability');
    expect(outcome.corrections.stability).toBe('corrHoldStill');
  });
});

describe('thresholds', () => {
  const tilt = (beta: number, gamma: number) =>
    evaluateChecks({ view: 'front', sample: sample('good'), orientation: { beta, gamma } }).results
      .level;
  it('level uses beta 88 to 92 and gamma up to 2 (C1)', () => {
    expect(tilt(88, 0)).toBe(true);
    expect(tilt(92, -2)).toBe(true);
    expect(tilt(87.9, 0)).toBe(false);
    expect(tilt(90, 2.5)).toBe(false);
  });
  it('level_unchecked lets the level check pass, recorded as skipped', () => {
    const outcome = evaluateChecks({
      view: 'front',
      sample: sample('level_fail'),
      levelUnchecked: true,
    });
    expect(outcome.results.level).toBe(true);
    expect(toViewChecks(outcome, true).level).toBe('skipped');
  });
  it('the sensor wins over the sample', () => {
    expect(tilt(80, 0)).toBe(false);
  });
  it('distance matches 600 to 1200 px on a 1920 stream (C2)', () => {
    expect(CAPTURE_CONFIG.distance.minFrac * 1920).toBeCloseTo(600);
    expect(CAPTURE_CONFIG.distance.maxFrac * 1920).toBeCloseTo(1200);
  });
  it('the config hash changes with the thresholds', () => {
    expect(configHash({ a: 1 })).not.toBe(configHash({ a: 2 }));
    expect(configHash()).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('A14 free arm', () => {
  it('is the wrist farther from the sheet', () => {
    const s = sample('good');
    expect(findFreeArm(s.landmarks, s.marker)).toBe('left');
  });
  it('is unknown without a marker', () => {
    const s = sample('good');
    expect(findFreeArm(s.landmarks, null)).toBeNull();
  });
  it('the holding arm may merge with the torso, the free arm may not', () => {
    const s = sample('good');
    const mask = s.mask!;
    const [lm11, lm12, lm23, lm24] = [11, 12, 23, 24].map((i) => s.landmarks![i]);
    const shoulder = (lm11.y + lm12.y) / 2;
    const row = shoulder + 0.6 * ((lm23.y + lm24.y) / 2 - shoulder);
    expect(armMergedAtWaist(mask, row, 0.5, 1)).toBe(false);
    const tucked = sample('arms_tucked').mask!;
    expect(armMergedAtWaist(tucked, row, 0.5, 1)).toBe(true);
    expect(evaluateChecks({ view: 'front', sample: s }).results.arms).toBe(true);
  });
});

describe('helpers', () => {
  it('reads mask bounds, and an empty mask has none', () => {
    const data = new Uint8Array(100);
    expect(maskBounds({ width: 10, height: 10, data })).toBeNull();
    data[55] = 1;
    expect(maskBounds({ width: 10, height: 10, data })).toEqual({
      top: 0.5,
      bottom: 0.6,
      left: 0.5,
      right: 0.6,
    });
  });
  it('jitter is zero for one sample', () => {
    expect(landmarkJitter([sample('good').landmarks!], 0.5)).toBe(0);
  });
  it('fills all eight contract fields', () => {
    expect(Object.keys(toViewChecks(judge('good'), false)).sort()).toEqual(
      ['arms', 'distance', 'frame', 'level', 'light', 'marker', 'sharpness', 'symmetry'].sort(),
    );
  });
  it('light and sharpness report apart', () => {
    const checks = toViewChecks(judge('blurry'), false);
    expect(checks.light).toBe('pass');
    expect(checks.sharpness).toBe('fail');
  });
});

describe('A3: every correction has a clip', () => {
  it.each(Object.entries(CORRECTION_CLIPS))('%s', (_, clip) => {
    expect(MESSAGE_KEYS).toContain(clip);
  });
  it('covers every correction the checks can give', () => {
    const keys = new Set<string>();
    for (const scenario of [
      'good',
      'level_fail',
      'no_person',
      'too_far',
      'too_close',
      'not_facing',
      'arms_tucked',
      'sheet_missing',
      'sheet_fingers',
      'sheet_small',
      'too_dark',
      'too_bright',
      'blurry',
    ] as Scenario[]) {
      for (const view of ['front', 'side'] as const) {
        for (const key of Object.values(judge(scenario, view).corrections)) keys.add(key);
      }
    }
    expect([...keys].filter((key) => !(key in CORRECTION_CLIPS))).toEqual([]);
  });
});
