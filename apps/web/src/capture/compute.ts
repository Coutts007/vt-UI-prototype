// Turns the two captured views into a profile, using the module the server re-runs (make parity).
import rulesFile from '../../../../packages/rules/rules-0.1-uncalibrated.json';
import type { ClientDraftSettings, LocalProfile } from '../db/storage';
import { clearerArm, correctedScale, derive, Rules, SITES } from '../measure/derive';
import { frontProfile, sideProfile } from '../measure/silhouette';
import type { SilhouetteFront, SilhouetteSide } from '../vision/types';
import { CAPTURE_CONFIG, configHash } from './config';
import type { CaptureSession } from './session';

const RULES = rulesFile as unknown as Rules;
/** The contract's limit is exclusive. */
const MAX_SCALE = 99.999;

export const APP_VERSION = '0.5.0';

/**
 * Reads each held mask into its profiles, once. A view retaken later keeps the other view's numbers,
 * because its mask has gone by then (privacy invariant 2).
 */
export function readProfiles(session: CaptureSession): void {
  const { front, side } = session.views;
  if (front && session.masks.front) {
    const { image_w: imageW, image_h: imageH } = front.silhouette;
    const scale = correctedScale(front.marker, imageW, 'front', RULES);
    const arm = front.free_arm ?? clearerArm(front.landmarks);
    if (scale !== null) {
      front.silhouette = frontProfile({ mask: session.masks.front, landmarks: front.landmarks, scale, imageW, imageH }, arm);
    }
  }
  if (side && session.masks.side) {
    const { image_w: imageW, image_h: imageH } = side.silhouette;
    const scale = correctedScale(side.marker, imageW, 'side', RULES);
    if (scale !== null) {
      side.silhouette = sideProfile({ mask: session.masks.side, landmarks: side.landmarks, scale, imageW, imageH });
    }
  }
}

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
  const silhouetteSide = side.silhouette as SilhouetteSide;
  const result = derive(
    {
      covariates: { height_mm_entered: draft.height_mm, sex, clothing_fit: fit },
      session: { free_arm: front.free_arm, level_unchecked: context.levelUnchecked },
      landmarks_front: front.landmarks,
      landmarks_side: side.landmarks,
      marker_front: front.marker,
      marker_side: side.marker,
      silhouette_front: silhouetteFront,
      silhouette_side: silhouetteSide,
    },
    RULES,
  );
  // The contract needs positive scales even if a view failed. Its sites are all flagged fail then.
  const fallback = (marker: { side_px: number }) => RULES.marker.side_mm / Math.max(marker.side_px, 1);
  const preflight = draft.preflight;
  const stream = session.streamSize;
  return {
    profile_id: crypto.randomUUID(),
    client_code: draft.client_code,
    version: 1, // Set again at save, from what is on the phone then (12.2).
    captured_at: new Date().toISOString(),
    status: 'final',
    sync_status: 'pending',
    rules_version: RULES.rules_version,
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
      model_variant: session.modelVariant,
      stream_w: stream?.width ?? front.marker.image_w,
      stream_h: stream?.height ?? front.marker.image_h,
      still_source: front.still_source,
      level_unchecked: context.levelUnchecked,
      capture_fallback: false,
      front_checks: front.checks,
      side_checks: side.checks,
      scale_front_mm_px: result.scale_front ?? fallback(front.marker),
      scale_side_mm_px: result.scale_side ?? fallback(side.marker),
      scale_stature_mm_px: Math.min(result.scale_stature ?? fallback(front.marker), MAX_SCALE),
      // A failed front view has no agreement to report, and 0 would read as perfect.
      scale_disagreement_pct: Math.min(result.disagreement_pct ?? 100, 100),
      processing_ms: Math.round(processingMs),
      retake_count: context.retakeCount,
      config_hash: `${CAPTURE_CONFIG.version}-${configHash()}`,
    },
    landmarks_front: front.landmarks,
    landmarks_side: side.landmarks,
    marker_front: front.marker,
    marker_side: side.marker,
    silhouette_front: silhouetteFront,
    silhouette_side: silhouetteSide,
    measurements: SITES.map((site) => {
      const row = result.sites[site];
      return {
        site_code: site,
        value_mm: row.value_mm,
        method: 'auto',
        confidence_flag: row.flag,
        flag_reasons: row.reasons,
        ...(row.correction_factor !== null && { correction_factor: row.correction_factor }),
        ...(row.level_fraction !== null && { level_fraction: row.level_fraction }),
        ...(row.a_mm !== null && row.a_mm <= 400 && { half_width_mm: row.a_mm }),
        ...(row.b_mm !== null && row.b_mm <= 400 && { half_depth_mm: row.b_mm }),
      };
    }) as LocalProfile['measurements'],
  };
}

/** Past the limit the client is asked to retake the view with the weaker marker (FR-06). */
export function disagreeingView(session: CaptureSession, pct: number): 'front' | 'side' | null {
  if (pct <= CAPTURE_CONFIG.scale.disagreePct) return null;
  const { front, side } = session.views;
  return (side?.marker_confidence ?? 0) < (front?.marker_confidence ?? 0) ? 'side' : 'front';
}
