// The nine capture checks in priority order (frontend-spec 10.3, A14). Numbers in, verdicts out.
import type { TranslationKey } from '../i18n/en';
import type { Landmark, MarkerObs, PersonMask, View, ViewChecks, VisionSample } from '../vision/types';
import { CAPTURE_CONFIG, CaptureConfig } from './config';

export const CHECK_ORDER = [
  'level',
  'person',
  'frame',
  'distance',
  'facing',
  'arms',
  'sheet',
  'light',
  'stability',
] as const;
export type CheckId = (typeof CHECK_ORDER)[number];
export type CheckResults = Record<CheckId, boolean>;
export type FreeArm = 'left' | 'right' | null;

export interface CheckInput {
  view: View;
  sample: VisionSample;
  /** Tilt from the phone's sensors. Without it the sample's own tilt is used. */
  orientation?: { beta: number; gamma: number } | null;
  levelUnchecked?: boolean;
  /** Earlier samples' landmarks, oldest first, for the stability check. */
  history?: Landmark[][];
}

export interface CheckOutcome {
  results: CheckResults;
  corrections: Partial<Record<CheckId, TranslationKey>>;
  /** Light and sharpness are one row on screen but two fields in the contract. */
  lumaOk: boolean;
  sharpOk: boolean;
  freeArm: FreeArm;
}

export interface MaskBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function maskBounds(mask: PersonMask): MaskBounds | null {
  let top = -1;
  let bottom = -1;
  let left = mask.width;
  let right = -1;
  for (let row = 0; row < mask.height; row++) {
    for (let col = 0; col < mask.width; col++) {
      if (!mask.data[row * mask.width + col]) continue;
      if (top < 0) top = row;
      bottom = row;
      if (col < left) left = col;
      if (col > right) right = col;
    }
  }
  if (top < 0) return null;
  return {
    top: top / mask.height,
    bottom: (bottom + 1) / mask.height,
    left: left / mask.width,
    right: (right + 1) / mask.width,
  };
}

function markerCentre(marker: MarkerObs): { x: number; y: number } {
  const n = marker.corners.length;
  return {
    x: marker.corners.reduce((sum, c) => sum + c[0], 0) / n,
    y: marker.corners.reduce((sum, c) => sum + c[1], 0) / n,
  };
}

/** A14: the free arm is the one whose wrist is farther from the marker centre. */
export function findFreeArm(
  landmarks: Landmark[] | null,
  marker: MarkerObs | null,
  config: CaptureConfig = CAPTURE_CONFIG,
): FreeArm {
  if (!landmarks || !marker) return null;
  const centre = markerCentre(marker);
  const distance = (lm: Landmark) =>
    Math.hypot(lm.x * marker.image_w - centre.x, lm.y * marker.image_h - centre.y);
  const left = distance(landmarks[15]);
  const right = distance(landmarks[16]);
  if (left >= right * config.freeArmRatio) return 'left';
  if (right >= left * config.freeArmRatio) return 'right';
  return null;
}

/** True when no background separates the torso and the outside of the arm on the waist row. */
export function armMergedAtWaist(mask: PersonMask, rowFraction: number, centre: number, side: 1 | -1): boolean {
  const row = Math.min(mask.height - 1, Math.max(0, Math.round(rowFraction * mask.height)));
  const start = Math.round(centre * mask.width);
  let outer = -1;
  for (let col = start; col >= 0 && col < mask.width; col += side) {
    if (mask.data[row * mask.width + col]) outer = col;
  }
  if (outer < 0) return false;
  for (let col = start; col !== outer; col += side) {
    if (!mask.data[row * mask.width + col]) return false;
  }
  return true;
}

/** The largest movement of any tracked point over the window, as a fraction of person height. */
export function landmarkJitter(history: Landmark[][], personHeight: number): number {
  if (history.length < 2 || personHeight <= 0) return 0;
  let worst = 0;
  for (const index of [0, 11, 12, 23, 24, 27, 28]) {
    const ys = history.map((frame) => frame[index].y);
    const xs = history.map((frame) => frame[index].x);
    worst = Math.max(worst, Math.max(...ys) - Math.min(...ys), Math.max(...xs) - Math.min(...xs));
  }
  return worst / personHeight;
}

const VISIBLE_FRONT = [0, 11, 12, 23, 24, 27, 28];
const VISIBLE_SIDE = [12, 24, 26, 28, 30];

export function evaluateChecks(input: CheckInput, config: CaptureConfig = CAPTURE_CONFIG): CheckOutcome {
  const { view, sample, levelUnchecked = false, history = [] } = input;
  const { landmarks, mask, marker, image_w: w, image_h: h } = sample;
  const front = view === 'front';
  const results = {} as CheckResults;
  const corrections: CheckOutcome['corrections'] = {};

  const tilt = input.orientation ?? sample.orientation;
  results.level =
    levelUnchecked ||
    (!!tilt &&
      tilt.beta >= config.level.betaMin &&
      tilt.beta <= config.level.betaMax &&
      Math.abs(tilt.gamma) <= config.level.gammaMax);
  corrections.level = 'corrTilt';

  const seen = (i: number) => (landmarks?.[i]?.visibility ?? 0) >= config.visibilityMin;
  results.person =
    !!landmarks &&
    (front
      ? VISIBLE_FRONT.every(seen) && (seen(29) || seen(30))
      : VISIBLE_SIDE.every(seen));
  corrections.person = 'corrStepIn';

  const bounds = mask ? maskBounds(mask) : null;
  const heelY = landmarks ? Math.max(landmarks[29]?.y ?? 0, landmarks[30]?.y ?? 0) : 0;
  results.frame =
    results.person &&
    !!bounds &&
    bounds.top >= config.frame.topMin &&
    bounds.bottom <= config.frame.bottomMax &&
    heelY <= config.frame.bottomMax &&
    bounds.left >= config.frame.sideMargin &&
    bounds.right <= 1 - config.frame.sideMargin;
  corrections.frame = 'corrHeadCut';

  const personHeight = bounds ? bounds.bottom - bounds.top : 0;
  results.distance =
    !!bounds && personHeight >= config.distance.minFrac && personHeight <= config.distance.maxFrac;
  corrections.distance = personHeight > config.distance.maxFrac ? 'corrTooClose' : 'corrTooFar';

  results.facing = false;
  if (results.person && landmarks) {
    const px = (a: Landmark, b: Landmark) => Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
    if (front) {
      const ratio = px(landmarks[11], landmarks[23]) / Math.max(px(landmarks[12], landmarks[24]), 1e-6);
      results.facing = Math.abs(ratio - 1) <= config.facing.frontRatioTolerance;
    } else {
      const limit = config.facing.sideGapMax * personHeight * h;
      results.facing =
        Math.abs(landmarks[11].x - landmarks[12].x) * w <= limit &&
        Math.abs(landmarks[23].x - landmarks[24].x) * w <= limit;
    }
  }
  corrections.facing = front ? 'corrTurnFace' : 'corrTurnRight';

  const freeArm = front ? findFreeArm(landmarks, marker, config) : null;
  results.arms = false;
  if (results.person && landmarks) {
    if (front) {
      const shoulders = Math.abs(landmarks[11].x - landmarks[12].x);
      const need = config.arms.wristHipMinShoulders * shoulders;
      const leftOk = Math.abs(landmarks[15].x - landmarks[23].x) >= need;
      const rightOk = Math.abs(landmarks[16].x - landmarks[24].x) >= need;
      const shoulderY = (landmarks[11].y + landmarks[12].y) / 2;
      const hipY = (landmarks[23].y + landmarks[24].y) / 2;
      const waistY = shoulderY + config.arms.waistRowFraction * (hipY - shoulderY);
      const centre = (landmarks[11].x + landmarks[12].x) / 2;
      const merged = (wrist: Landmark): boolean =>
        !!mask && armMergedAtWaist(mask, waistY, centre, wrist.x >= centre ? 1 : -1);
      // Only the free arm counts (A14). While it is unknown, one clear arm is enough (D33).
      const left = leftOk && !merged(landmarks[15]);
      const right = rightOk && !merged(landmarks[16]);
      results.arms = freeArm === 'left' ? left : freeArm === 'right' ? right : left || right;
    } else {
      results.arms = landmarks[16].x - landmarks[24].x > config.arms.sideForwardMin;
    }
  }
  corrections.arms = front ? 'corrArmsAway' : 'corrArmsForward';

  results.sheet = false;
  corrections.sheet = sample.markerOccluded ? 'corrMoveFingers' : 'corrHoldSheetFlat';
  if (marker && marker.corners.length === 4) {
    const sides = marker.corners.map((corner, i) => {
      const next = marker.corners[(i + 1) % 4];
      return Math.hypot(corner[0] - next[0], corner[1] - next[1]);
    });
    const longest = Math.max(...sides);
    const shortest = Math.min(...sides);
    const square = shortest > 0 && longest / shortest <= config.marker.squareMax;
    const big = shortest >= config.marker.sideMinPx * (marker.image_h / 1920);
    results.sheet = square && big;
    if (square && !big) corrections.sheet = 'corrStepCloserSheet';
  }

  const lumaOk = sample.luminance >= config.light.lumaMin && sample.luminance <= config.light.lumaMax;
  const sharpOk = sample.sharpness >= config.light.blurMin;
  results.light = lumaOk && sharpOk;
  corrections.light =
    sample.luminance < config.light.lumaMin
      ? 'corrTooDark'
      : sample.luminance > config.light.lumaMax
        ? 'corrTooBright'
        : 'corrHoldStill';

  const window = landmarks ? [...history, landmarks].slice(-config.stability.window) : [];
  results.stability = landmarkJitter(window, personHeight) < config.stability.jitterMax;
  corrections.stability = 'corrHoldStill';

  return { results, corrections, lumaOk, sharpOk, freeArm };
}

export function firstFailing(results: CheckResults): CheckId | null {
  return CHECK_ORDER.find((id) => !results[id]) ?? null;
}

/** The final state of each check, in the shape the contract stores. */
export function toViewChecks(outcome: CheckOutcome, levelUnchecked: boolean): ViewChecks {
  const state = (ok: boolean) => (ok ? ('pass' as const) : ('fail' as const));
  const { results } = outcome;
  return {
    level: levelUnchecked ? 'skipped' : state(results.level),
    frame: state(results.person && results.frame),
    distance: state(results.distance),
    symmetry: state(results.facing),
    arms: state(results.arms),
    marker: state(results.sheet),
    light: state(outcome.lumaOk),
    sharpness: state(outcome.sharpOk),
  };
}
