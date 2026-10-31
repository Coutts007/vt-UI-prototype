// Every capture threshold (frontend-spec 10.3), versioned. Nothing here is inlined elsewhere.
export const CAPTURE_CONFIG = {
  version: 'capture-1',
  level: { betaMin: 88, betaMax: 92, gammaMax: 2 },
  visibilityMin: 0.5,
  frame: { topMin: 0.03, bottomMax: 0.97, sideMargin: 0.03 },
  // 600 to 1200 px on a 1920-tall stream (C2).
  distance: { minFrac: 600 / 1920, maxFrac: 1200 / 1920 },
  facing: { frontRatioTolerance: 0.05, sideGapMax: 0.04 },
  arms: { wristHipMinShoulders: 0.25, waistRowFraction: 0.6, sideForwardMin: 0 },
  // A14: one wrist must be this much farther from the marker to be called the free arm (D33).
  freeArmRatio: 1.05,
  marker: { squareMax: 1.03, sideMinPx: 80 },
  light: { lumaMin: 60, lumaMax: 220, blurMin: 100 },
  stability: { window: 10, jitterMax: 0.01 },
  timing: {
    hysteresisMs: 300,
    messageHoldMs: 1500,
    allGreenMs: 1000,
    countdownSec: 3,
    walkAwaySec: 8,
    sideTransitionSec: 6,
    levelHoldMs: 1000,
    motionWaitMs: 2000,
    sampleMs: 160,
    doneMs: 1200,
    liveTimeoutMs: 1000,
    burstTimeoutMs: 10000,
  },
  // A3 item 3.
  pacing: { correctionGapMs: 3000, repeatMs: 6000, goodGapMs: 1000 },
  burst: { frames: 5, spacingMs: 200, maxBadFrames: 2 },
  scale: { disagreePct: 4 },
} as const;

export type CaptureConfig = typeof CAPTURE_CONFIG;

/** A short stable hash, sent with each session so results can be traced to the thresholds used. */
export function configHash(config: unknown = CAPTURE_CONFIG): string {
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify(config)) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
