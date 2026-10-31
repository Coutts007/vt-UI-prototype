// Turns the two captured views into a profile. The numbers come from the prototype engine until
// the real measure port in M7, so every value here is a fake-flow value, not a measurement.
import type { ClientDraftSettings, LocalProfile } from '../db/storage';
import { computeMeasurements } from '../measure/engine';
import type { Landmark as OldLandmark, MarkerObs as OldMarker } from '../types/api';
import type { SilhouetteFront, SilhouetteSide } from '../vision/types';
import { CAPTURE_CONFIG, configHash } from './config';
import type { CaptureSession } from './session';

export const APP_VERSION = '0.5.0';

export function buildProfile(
  session: CaptureSession,
  draft: ClientDraftSettings,
  processingMs: number,
): LocalProfile {
  const { front, side } = session.views;
  if (!front || !side || !draft.client_code || !draft.height_mm || !draft.consent) {
    throw new Error('capture_incomplete');
  }
  const context = session.machine.context;
  const sex = draft.sex ?? 'unspecified';
  const fit = draft.clothing_fit ?? 'fitted';
  const silhouetteFront = front.silhouette as SilhouetteFront;
  const output = computeMeasurements({
    landmarks_front: front.landmarks as OldLandmark[],
    landmarks_side: side.landmarks as OldLandmark[],
    marker_front: front.marker as OldMarker,
    marker_side: side.marker as OldMarker,
    height_mm_entered: draft.height_mm,
    sex,
    clothing_fit: fit,
    level_unchecked: context.levelUnchecked,
    crotch_found: silhouetteFront.crotch_y_px !== null,
  });
  const preflight = draft.preflight;
  return {
    profile_id: crypto.randomUUID(),
    client_code: draft.client_code,
    version: 1, // Set again at save, from what is on the phone then (12.2).
    captured_at: new Date().toISOString(),
    status: 'final',
    sync_status: 'pending',
    rules_version: output.rules_version,
    covariates: {
      height_mm_entered: draft.height_mm,
      sex,
      clothing_fit: fit,
      code_verified: draft.code_verified ?? false,
    },
    consent: draft.consent,
    session: {
      session_id: crypto.randomUUID(),
      started_at: session.startedAt || new Date().toISOString(),
      capture_mode: context.mode,
      camera_facing: 'environment',
      // A3 item 7: voice for self-capture with the rear camera, visual with a helper.
      guidance_mode: context.mode === 'self' ? 'voice' : 'visual',
      free_arm: front.free_arm,
      app_version: APP_VERSION,
      device_model: preflight?.device_model ?? 'unknown',
      os: preflight?.os ?? 'unknown',
      browser: preflight?.browser ?? 'unknown',
      memory_gb: preflight?.memory_gb ?? null,
      model_variant: 'lite',
      stream_w: front.marker.image_w,
      stream_h: front.marker.image_h,
      still_source: 'canvas',
      level_unchecked: context.levelUnchecked,
      capture_fallback: false,
      front_checks: front.checks,
      side_checks: side.checks,
      scale_front_mm_px: output.scale_front_mm_px,
      scale_side_mm_px: output.scale_side_mm_px,
      scale_stature_mm_px: output.scale_stature_mm_px,
      scale_disagreement_pct: output.scale_disagreement_pct,
      processing_ms: Math.round(processingMs),
      retake_count: context.retakeCount,
      config_hash: `${CAPTURE_CONFIG.version}-${configHash()}`,
    },
    landmarks_front: front.landmarks,
    landmarks_side: side.landmarks,
    marker_front: front.marker,
    marker_side: side.marker,
    silhouette_front: silhouetteFront,
    silhouette_side: side.silhouette as SilhouetteSide,
    measurements: output.measurements as LocalProfile['measurements'],
  };
}

/** Past the limit the client is asked to retake the view with the weaker marker (FR-06). */
export function disagreeingView(session: CaptureSession, pct: number): 'front' | 'side' | null {
  if (pct <= CAPTURE_CONFIG.scale.disagreePct) return null;
  const { front, side } = session.views;
  return (side?.marker_confidence ?? 0) < (front?.marker_confidence ?? 0) ? 'side' : 'front';
}
