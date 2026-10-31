import {
  Landmark,
  MarkerObs,
  Measurement,
  Flag,
  FlagReason,
  SiteCode,
} from '../types/api';
import {
  RULES_VERSION,
  PLAUSIBLE_RANGES_MM,
  CHEST_LEVEL,
  WAIST_LEVEL_FRACTION,
  CORRECTION_FACTORS,
  ramanujanEllipsePerimeter,
} from './rules';

export interface ComputeInput {
  landmarks_front: Landmark[];
  landmarks_side: Landmark[];
  marker_front: MarkerObs;
  marker_side: MarkerObs;
  height_mm_entered: number;
  sex: 'female' | 'male' | 'unspecified';
  clothing_fit: 'fitted' | 'loose';
  level_unchecked?: boolean;
}

export interface ComputeOutput {
  measurements: Measurement[];
  scale_front_mm_px: number;
  scale_side_mm_px: number;
  scale_stature_mm_px: number;
  scale_disagreement_pct: number;
  rules_version: string;
}

export function computeMeasurements(input: ComputeInput): ComputeOutput {
  const {
    landmarks_front,
    landmarks_side,
    marker_front,
    marker_side,
    height_mm_entered,
    sex,
    clothing_fit,
    level_unchecked = false,
  } = input;

  // 1. Scale from ArUco Marker (150 mm physical size)
  const marker_side_front_px = Math.max(marker_front.side_px, 1);
  const marker_side_side_px = Math.max(marker_side.side_px, 1);
  const scale_front_mm_px = 150.0 / marker_side_front_px;
  const scale_side_mm_px = 150.0 / marker_side_side_px;

  // Stature scale check (estimated full body height in front frame)
  // Distance between head/nose (0) and ankles/heels (27, 28, 29, 30)
  const nose = landmarks_front[0] || { x: 0.5, y: 0.15, z: 0, visibility: 0.9 };
  const leftAnkle = landmarks_front[27] || { x: 0.45, y: 0.9, z: 0, visibility: 0.9 };
  const rightAnkle = landmarks_front[28] || { x: 0.55, y: 0.9, z: 0, visibility: 0.9 };
  const ankleY = (leftAnkle.y + rightAnkle.y) / 2;
  const bodyHeightNorm = Math.max(ankleY - (nose.y - 0.08), 0.5); // Add head offset
  const bodyHeightPx = bodyHeightNorm * marker_front.image_h;
  const scale_stature_mm_px = height_mm_entered / Math.max(bodyHeightPx, 1);

  // Scale disagreement percentage (FR-06: 4% rule)
  const scale_disagreement_pct =
    (Math.abs(scale_front_mm_px - scale_stature_mm_px) / scale_front_mm_px) * 100;

  // Common flag warnings for all sites
  const globalReasons: FlagReason[] = [];
  if (scale_disagreement_pct >= 2.0 && scale_disagreement_pct <= 4.0) {
    globalReasons.push('scale_disagree');
  }
  if (level_unchecked) {
    globalReasons.push('level_unchecked');
  }
  if (clothing_fit === 'loose') {
    globalReasons.push('loose_clothing');
  }

  const measurements: Measurement[] = [];

  const addMeasurement = (
    site_code: SiteCode,
    raw_val_mm: number,
    siteReasons: FlagReason[] = [],
    extra?: {
      correction_factor?: number;
      level_fraction?: number;
      half_width_mm?: number;
      half_depth_mm?: number;
    }
  ) => {
    const reasons = Array.from(new Set([...globalReasons, ...siteReasons]));
    const bounds = PLAUSIBLE_RANGES_MM[site_code];

    let flag: Flag = 'pass';
    let value_mm: number | null = Math.round(raw_val_mm);

    if (raw_val_mm < bounds.min || raw_val_mm > bounds.max) {
      flag = 'fail';
      reasons.push('out_of_range');
      value_mm = null; // C4: null when fail
    } else if (reasons.length > 0) {
      flag = 'check';
    }

    measurements.push({
      site_code,
      value_mm,
      method: 'auto',
      confidence_flag: flag,
      flag_reasons: reasons,
      ...extra,
    });
  };

  // Helper landmarks
  const l11 = landmarks_front[11] || { x: 0.40, y: 0.28, z: 0, visibility: 0.9 }; // Left shoulder
  const l12 = landmarks_front[12] || { x: 0.60, y: 0.28, z: 0, visibility: 0.9 }; // Right shoulder
  const l13 = landmarks_front[13] || { x: 0.35, y: 0.42, z: 0, visibility: 0.9 }; // Left elbow
  const l14 = landmarks_front[14] || { x: 0.65, y: 0.42, z: 0, visibility: 0.9 }; // Right elbow
  const l15 = landmarks_front[15] || { x: 0.33, y: 0.58, z: 0, visibility: 0.9 }; // Left wrist
  const l16 = landmarks_front[16] || { x: 0.67, y: 0.58, z: 0, visibility: 0.9 }; // Right wrist
  const l23 = landmarks_front[23] || { x: 0.44, y: 0.50, z: 0, visibility: 0.9 }; // Left hip
  const l24 = landmarks_front[24] || { x: 0.56, y: 0.50, z: 0, visibility: 0.9 }; // Right hip

  const shoulderMidY = (l11.y + l12.y) / 2;
  const hipMidY = (l23.y + l24.y) / 2;
  const torsoSpanNorm = Math.max(hipMidY - shoulderMidY, 0.15);

  // 1. STATURE
  const estimatedStatureMm = bodyHeightPx * scale_front_mm_px;
  addMeasurement('stature', estimatedStatureMm);

  // 2. SHOULDER WIDTH (11<->12 distance)
  const shoulderDistNorm = Math.hypot(l12.x - l11.x, l12.y - l11.y);
  const shoulderWidthPx = shoulderDistNorm * marker_front.image_w;
  const shoulderWidthMm = shoulderWidthPx * scale_front_mm_px;
  addMeasurement('shoulder', shoulderWidthMm);

  // 3. CHEST / BUST GIRTH
  // Ellipse at chest level fraction
  const chestFraction = CHEST_LEVEL[sex];
  const chestHalfWidthPx = (shoulderDistNorm * 0.92 * marker_front.image_w) / 2;
  const chestHalfDepthPx = (chestHalfWidthPx * 0.72); // side depth
  const aChest = chestHalfWidthPx * scale_front_mm_px;
  const bChest = chestHalfDepthPx * scale_side_mm_px;
  const chestGirth = ramanujanEllipsePerimeter(aChest, bChest) * CORRECTION_FACTORS.chest;
  addMeasurement('chest', chestGirth, [], {
    level_fraction: chestFraction,
    half_width_mm: Math.round(aChest),
    half_depth_mm: Math.round(bChest),
  });

  // 4. WAIST GIRTH
  // Ellipse at 0.60 torso span
  const waistHalfWidthPx = (shoulderDistNorm * 0.78 * marker_front.image_w) / 2;
  const waistHalfDepthPx = waistHalfWidthPx * 0.68;
  const aWaist = waistHalfWidthPx * scale_front_mm_px;
  const bWaist = waistHalfDepthPx * scale_side_mm_px;
  const waistGirth = ramanujanEllipsePerimeter(aWaist, bWaist) * CORRECTION_FACTORS.waist;
  addMeasurement('waist', waistGirth, [], {
    level_fraction: WAIST_LEVEL_FRACTION,
    half_width_mm: Math.round(aWaist),
    half_depth_mm: Math.round(bWaist),
  });

  // 5. HIP GIRTH
  const hipDistNorm = Math.hypot(l24.x - l23.x, l24.y - l23.y);
  const hipHalfWidthPx = (hipDistNorm * 1.15 * marker_front.image_w) / 2;
  const hipHalfDepthPx = hipHalfWidthPx * 0.82;
  const aHip = hipHalfWidthPx * scale_front_mm_px;
  const bHip = hipHalfDepthPx * scale_side_mm_px;
  const hipGirth = ramanujanEllipsePerimeter(aHip, bHip) * CORRECTION_FACTORS.hip;
  addMeasurement('hip', hipGirth, [], {
    half_width_mm: Math.round(aHip),
    half_depth_mm: Math.round(bHip),
  });

  // 6. SLEEVE LENGTH
  // Left arm: 11->13 + 13->15
  const upperArmNorm = Math.hypot(l13.x - l11.x, l13.y - l11.y);
  const lowerArmNorm = Math.hypot(l15.x - l13.x, l15.y - l13.y);
  const sleevePx = (upperArmNorm + lowerArmNorm) * marker_front.image_h;
  const sleeveMm = sleevePx * scale_front_mm_px;
  addMeasurement('sleeve', sleeveMm);

  // 7. OUTSIDE LEG
  // Waist level to ankle
  const outlegNorm = Math.max(ankleY - (shoulderMidY + torsoSpanNorm * WAIST_LEVEL_FRACTION), 0.4);
  const outlegPx = outlegNorm * marker_side.image_h;
  const outlegMm = outlegPx * scale_side_mm_px;
  addMeasurement('outleg', outlegMm);

  // 8. INSIDE LEG (Inleg / Inseam)
  // Crotch point (below hips) to ankle
  const crotchYNorm = hipMidY + 0.08;
  const inlegNorm = Math.max(ankleY - crotchYNorm, 0.35);
  const inlegPx = inlegNorm * marker_front.image_h;
  const inlegMm = inlegPx * scale_front_mm_px;
  addMeasurement('inleg', inlegMm);

  // 9. NECK GIRTH
  const neckHalfWidthPx = (shoulderDistNorm * 0.32 * marker_front.image_w) / 2;
  const neckHalfDepthPx = neckHalfWidthPx * 0.88;
  const aNeck = neckHalfWidthPx * scale_front_mm_px;
  const bNeck = neckHalfDepthPx * scale_side_mm_px;
  const neckGirth = ramanujanEllipsePerimeter(aNeck, bNeck) * CORRECTION_FACTORS.neck;
  addMeasurement('neck', neckGirth, [], {
    half_width_mm: Math.round(aNeck),
    half_depth_mm: Math.round(bNeck),
  });

  return {
    measurements,
    scale_front_mm_px: Math.round(scale_front_mm_px * 1000) / 1000,
    scale_side_mm_px: Math.round(scale_side_mm_px * 1000) / 1000,
    scale_stature_mm_px: Math.round(scale_stature_mm_px * 1000) / 1000,
    scale_disagreement_pct: Math.round(scale_disagreement_pct * 10) / 10,
    rules_version: RULES_VERSION,
  };
}
