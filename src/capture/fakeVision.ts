import { Landmark, MarkerObs } from '../types/api';

export interface VisionFrameData {
  landmarks: Landmark[];
  marker: MarkerObs;
  luminance: number;
  sharpness: number;
}

export function generateSyntheticPose(view: 'front' | 'side', modifier: 'good' | 'arms_tucked' | 'too_close' | 'too_far' | 'cut_off' = 'good'): Landmark[] {
  const landmarks: Landmark[] = [];

  // Base y positions
  let noseY = 0.16;
  let shoulderY = 0.28;
  let elbowY = 0.42;
  let wristY = 0.58;
  let hipY = 0.50;
  let kneeY = 0.70;
  let ankleY = 0.90;

  if (modifier === 'too_close') {
    noseY = 0.04;
    shoulderY = 0.22;
    ankleY = 0.98;
  } else if (modifier === 'too_far') {
    noseY = 0.35;
    shoulderY = 0.44;
    ankleY = 0.75;
  } else if (modifier === 'cut_off') {
    noseY = 0.01;
    ankleY = 0.99;
  }

  const isFront = view === 'front';

  // Generate 33 standard landmarks
  for (let i = 0; i < 33; i++) {
    landmarks.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 });
  }

  // Head
  landmarks[0] = { x: 0.5, y: noseY, z: 0, visibility: 0.98 };

  if (isFront) {
    // Shoulders
    landmarks[11] = { x: 0.40, y: shoulderY, z: 0, visibility: 0.95 }; // Left shoulder
    landmarks[12] = { x: 0.60, y: shoulderY, z: 0, visibility: 0.95 }; // Right shoulder

    // Arms
    const wristSpread = modifier === 'arms_tucked' ? 0.02 : 0.08;
    landmarks[13] = { x: 0.36, y: elbowY, z: 0, visibility: 0.92 }; // Left elbow
    landmarks[14] = { x: 0.64, y: elbowY, z: 0, visibility: 0.92 }; // Right elbow
    landmarks[15] = { x: 0.44 - wristSpread, y: wristY, z: 0, visibility: 0.92 }; // Left wrist
    landmarks[16] = { x: 0.56 + wristSpread, y: wristY, z: 0, visibility: 0.92 }; // Right wrist

    // Hips
    landmarks[23] = { x: 0.44, y: hipY, z: 0, visibility: 0.94 };
    landmarks[24] = { x: 0.56, y: hipY, z: 0, visibility: 0.94 };

    // Knees
    landmarks[25] = { x: 0.45, y: kneeY, z: 0, visibility: 0.93 };
    landmarks[26] = { x: 0.55, y: kneeY, z: 0, visibility: 0.93 };

    // Ankles & Feet
    landmarks[27] = { x: 0.46, y: ankleY, z: 0, visibility: 0.95 };
    landmarks[28] = { x: 0.54, y: ankleY, z: 0, visibility: 0.95 };
    landmarks[29] = { x: 0.45, y: ankleY + 0.02, z: 0, visibility: 0.92 };
    landmarks[30] = { x: 0.55, y: ankleY + 0.02, z: 0, visibility: 0.92 };
  } else {
    // Side profile (facing right)
    landmarks[11] = { x: 0.49, y: shoulderY, z: 0, visibility: 0.88 };
    landmarks[12] = { x: 0.52, y: shoulderY, z: 0, visibility: 0.95 };

    landmarks[14] = { x: 0.54, y: elbowY, z: 0, visibility: 0.94 };
    landmarks[16] = { x: 0.57, y: wristY, z: 0, visibility: 0.92 }; // Slightly forward

    landmarks[23] = { x: 0.49, y: hipY, z: 0, visibility: 0.85 };
    landmarks[24] = { x: 0.51, y: hipY, z: 0, visibility: 0.95 };

    landmarks[26] = { x: 0.52, y: kneeY, z: 0, visibility: 0.95 };
    landmarks[28] = { x: 0.51, y: ankleY, z: 0, visibility: 0.95 };
    landmarks[30] = { x: 0.54, y: ankleY + 0.02, z: 0, visibility: 0.92 };
  }

  return landmarks;
}

export function generateSyntheticMarker(view: 'front' | 'side', missing = false): MarkerObs {
  if (missing) {
    return {
      corners: [],
      image_w: 1080,
      image_h: 1920,
      side_px: 0,
      confidence: 0,
    };
  }

  const cx = view === 'front' ? 540 : 580;
  const cy = view === 'front' ? 760 : 960; // Chest in front, hip in side
  const s = 110; // ~110px marker on 1080x1920 at ~2.2m

  return {
    corners: [
      [cx - s / 2, cy - s / 2],
      [cx + s / 2, cy - s / 2],
      [cx + s / 2, cy + s / 2],
      [cx - s / 2, cy + s / 2],
    ],
    image_w: 1080,
    image_h: 1920,
    side_px: s,
    confidence: 0.96,
  };
}
