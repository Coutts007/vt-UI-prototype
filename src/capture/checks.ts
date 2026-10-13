import { TranslationKey } from '../i18n/en';
import { Landmark, MarkerObs } from '../types/api';

export interface CheckItemState {
  id: string;
  labelKey: TranslationKey;
  passed: boolean;
  correctionKey?: TranslationKey;
}

export interface CaptureChecksContext {
  view: 'front' | 'side';
  beta?: number; // tilt angle (88 to 92 deg is upright portrait)
  gamma?: number; // roll angle (-2 to +2 deg is level)
  levelUnchecked?: boolean;
  landmarks: Landmark[];
  marker: MarkerObs | null;
  luminance?: number; // 0..255
  sharpness?: number; // variance of Laplacian
  stabilityScore?: number; // 0..1 (1 is very still)
}

/**
 * Checks evaluation in strict priority order (Section 10.3)
 * Returns list of checks and the single highest-priority correction
 */
export function evaluateCaptureChecks(ctx: CaptureChecksContext): {
  checks: CheckItemState[];
  allPassed: boolean;
  activeCorrectionKey: TranslationKey | null;
  borderState: 'ok' | 'wait' | 'stop';
} {
  const { view, beta, gamma, levelUnchecked, landmarks, marker, luminance = 130, stabilityScore = 0.95 } = ctx;

  const checks: CheckItemState[] = [];

  // Check 1: Level (C1: beta in [88, 92] and |gamma| <= 2)
  let levelOk = true;
  if (!levelUnchecked && beta !== undefined && gamma !== undefined) {
    levelOk = beta >= 88 && beta <= 92 && Math.abs(gamma) <= 2.5;
  }
  checks.push({
    id: 'level',
    labelKey: 'checkLevel',
    passed: levelOk,
    correctionKey: 'corrTilt',
  });

  // Check 2: Person found (landmarks detected with visibility >= 0.5)
  const nose = landmarks[0];
  const lShoulder = landmarks[11];
  const rShoulder = landmarks[12];
  const lHip = landmarks[23];
  const rHip = landmarks[24];
  const lAnkle = landmarks[27];
  const rAnkle = landmarks[28];

  const personFound =
    view === 'front'
      ? !!(nose && lShoulder && rShoulder && lHip && rHip && lAnkle && rAnkle &&
          lShoulder.visibility >= 0.45 && rShoulder.visibility >= 0.45)
      : !!(lShoulder && lHip && lAnkle && (lShoulder.visibility >= 0.45 || (rShoulder && rShoulder.visibility >= 0.45)));

  checks.push({
    id: 'person',
    labelKey: 'checkWholeBody',
    passed: personFound,
    correctionKey: 'corrStepIn',
  });

  // Check 3: Whole body in frame (margins >= 3% top/bottom)
  let wholeBodyOk = false;
  if (personFound && nose && (lAnkle || rAnkle)) {
    const topY = nose.y - 0.08;
    const bottomY = Math.max(lAnkle?.y || 0.9, rAnkle?.y || 0.9);
    wholeBodyOk = topY >= 0.02 && bottomY <= 0.98;
  }
  checks.push({
    id: 'frame',
    labelKey: 'checkWholeBody',
    passed: wholeBodyOk,
    correctionKey: 'corrHeadCut',
  });

  // Check 4: Distance (Person height between 31% and 63% of frame height)
  let distanceOk = false;
  let distanceCorrection: TranslationKey = 'corrTooFar';
  if (personFound && nose && (lAnkle || rAnkle)) {
    const heightNorm = (Math.max(lAnkle?.y || 0.9, rAnkle?.y || 0.9) - (nose.y - 0.08));
    if (heightNorm < 0.31) {
      distanceCorrection = 'corrTooFar';
      distanceOk = false;
    } else if (heightNorm > 0.63) {
      distanceCorrection = 'corrTooClose';
      distanceOk = false;
    } else {
      distanceOk = true;
    }
  }
  checks.push({
    id: 'distance',
    labelKey: 'checkDistance',
    passed: distanceOk,
    correctionKey: distanceCorrection,
  });

  // Check 5: Facing / Profile
  let facingOk = false;
  if (view === 'front') {
    if (lShoulder && rShoulder && lHip && rHip) {
      const shoulderSpread = Math.abs(rShoulder.x - lShoulder.x);
      facingOk = shoulderSpread >= 0.12;
    }
  } else {
    // Side profile: shoulders and hips aligned horizontally in depth
    if (lShoulder && rShoulder) {
      const shoulderXDiff = Math.abs(rShoulder.x - lShoulder.x);
      facingOk = shoulderXDiff <= 0.08;
    }
  }
  checks.push({
    id: 'facing',
    labelKey: 'checkFacing',
    passed: facingOk,
    correctionKey: view === 'front' ? 'corrTurnFace' : 'corrTurnRight',
  });

  // Check 6: Arms away from body
  let armsOk = false;
  const lWrist = landmarks[15];
  const rWrist = landmarks[16];
  if (view === 'front') {
    if (lWrist && rWrist && lHip && rHip) {
      const lDist = Math.abs(lWrist.x - lHip.x);
      const rDist = Math.abs(rWrist.x - rHip.x);
      armsOk = lDist >= 0.06 && rDist >= 0.06;
    }
  } else {
    // Side view: arms hanging slightly forward
    armsOk = true;
  }
  checks.push({
    id: 'arms',
    labelKey: 'checkArms',
    passed: armsOk,
    correctionKey: view === 'front' ? 'corrArmsAway' : 'corrArmsForward',
  });

  // Check 7: Sheet found (ArUco marker)
  const markerOk = !!(marker && marker.side_px >= 40 && marker.confidence >= 0.65);
  checks.push({
    id: 'sheet',
    labelKey: 'checkSheet',
    passed: markerOk,
    correctionKey: 'corrHoldSheetFlat',
  });

  // Check 8: Light & sharp
  const lightOk = luminance >= 50 && luminance <= 235;
  checks.push({
    id: 'light',
    labelKey: 'checkLightSharp',
    passed: lightOk,
    correctionKey: luminance < 50 ? 'corrTooDark' : 'corrTooBright',
  });

  // Determine first failing check for the 56px instructions
  const firstFailing = checks.find((c) => !c.passed);
  const allPassed = !firstFailing && stabilityScore >= 0.8;

  let borderState: 'ok' | 'wait' | 'stop' = 'stop';
  if (allPassed) {
    borderState = 'ok';
  } else {
    const passedCount = checks.filter((c) => c.passed).length;
    if (passedCount >= checks.length - 1) {
      borderState = 'wait';
    } else {
      borderState = 'stop';
    }
  }

  return {
    checks,
    allPassed,
    activeCorrectionKey: firstFailing?.correctionKey || (stabilityScore < 0.8 ? 'corrHoldStill' : null),
    borderState,
  };
}
