// Replays synthetic landmarks, masks and markers through each check state (frontend-spec 20.4).
// Dev and mock builds only. It never touches a camera, and every value here is made up.
import { CAPTURE_CONFIG } from '../capture/config';
import { FAKE_VISION_KEY } from './client';
import type {
  BurstFrame,
  Landmark,
  MarkerObs,
  PersonMask,
  SilhouetteFront,
  SilhouetteSide,
  View,
  VisionReply,
  VisionRequest,
  VisionSample,
  WorkerLike,
} from './types';

export const SCENARIOS = [
  'good',
  'level_fail',
  'no_person',
  'cut_off',
  'too_far',
  'too_close',
  'not_facing',
  'arms_tucked',
  'sheet_missing',
  'sheet_fingers',
  'sheet_tilted',
  'sheet_small',
  'too_dark',
  'too_bright',
  'blurry',
  'unsteady',
  'burst_bad',
  'scale_disagree',
  'no_crotch',
  'compute_crash_once',
  'compute_crash_twice',
] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface FakeOptions {
  scenario: Scenario;
  /** Fail for the first samples of each view, then behave as "good". */
  recover: boolean;
  /** Below 1 runs every wait faster, for tests. */
  speed: number;
  /** Use the real camera and models instead (/dev/capture-tuning). */
  real?: boolean;
}

export const DEFAULT_FAKE: FakeOptions = { scenario: 'good', recover: false, speed: 1 };
export const RECOVER_AFTER_SAMPLES = 10;

export function readFakeOptions(): FakeOptions {
  try {
    const stored = sessionStorage.getItem(FAKE_VISION_KEY);
    return stored ? { ...DEFAULT_FAKE, ...(JSON.parse(stored) as Partial<FakeOptions>) } : DEFAULT_FAKE;
  } catch {
    return DEFAULT_FAKE;
  }
}

const IMAGE_W = 1080;
const IMAGE_H = 1920;
const MASK_W = 72;
const MASK_H = 128;
const MARKER_MM = 150;

interface Body {
  /** Person height as a fraction of the frame. */
  frac: number;
  top: number;
  markerPx: number;
}

/** Sizes that agree with the entered height, so the scale check passes in the good case. */
export function bodyFor(heightMm: number): Body {
  const frac = 0.53 + (heightMm - 1700) / 6000;
  const scale = heightMm / (frac * IMAGE_H);
  return { frac, top: (1 - frac) / 2, markerPx: MARKER_MM / scale };
}

function blankLandmarks(): Landmark[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
}

function poseFront(b: Body, wristOut: number): Landmark[] {
  const lm = blankLandmarks();
  const f = b.frac;
  const y = (r: number) => b.top + r * f;
  const set = (i: number, x: number, r: number) => (lm[i] = { x, y: y(r), z: 0, visibility: 0.95 });
  const c = 0.5;
  lm[0] = { x: c, y: b.top + 0.08, z: 0, visibility: 0.98 };
  // The subject's left is on the right of the picture, because the rear camera does not mirror.
  set(11, c + 0.22 * f, 0.19);
  set(12, c - 0.22 * f, 0.19);
  set(13, c + 0.25 * f, 0.36);
  set(15, c + wristOut * f, 0.5); // Free arm (A14).
  set(14, c - 0.22 * f, 0.34);
  set(16, c - 0.02 * f, 0.31); // This hand holds the sheet on the chest.
  set(23, c + 0.17 * f, 0.53);
  set(24, c - 0.17 * f, 0.53);
  set(25, c + 0.1 * f, 0.73);
  set(26, c - 0.1 * f, 0.73);
  set(27, c + 0.1 * f, 0.99);
  set(28, c - 0.1 * f, 0.99);
  set(29, c + 0.1 * f, 0.995);
  set(30, c - 0.1 * f, 0.995);
  return lm;
}

function poseSide(b: Body, shoulderGap: number): Landmark[] {
  const lm = blankLandmarks();
  const f = b.frac;
  const y = (r: number) => b.top + r * f;
  const set = (i: number, x: number, r: number) => (lm[i] = { x, y: y(r), z: 0, visibility: 0.95 });
  const c = 0.5;
  lm[0] = { x: c + 0.03 * f, y: b.top + 0.08, z: 0, visibility: 0.98 };
  set(11, c - shoulderGap / 2, 0.19);
  set(12, c + shoulderGap / 2, 0.19);
  set(13, c + 0.02 * f, 0.36);
  set(14, c + 0.02 * f, 0.36);
  set(15, c + 0.05 * f, 0.5);
  set(16, c + 0.05 * f, 0.5); // Forward of the hip.
  set(23, c - 0.005, 0.53);
  set(24, c + 0.005, 0.53);
  set(25, c, 0.73);
  set(26, c, 0.73);
  set(27, c, 0.99);
  set(28, c, 0.99);
  set(29, c, 0.995);
  set(30, c, 0.995);
  return lm;
}

function drawMask(view: View, b: Body, armGap: boolean): PersonMask {
  const data = new Uint8Array(MASK_W * MASK_H);
  const fill = (x0: number, x1: number, r0: number, r1: number) => {
    const fromX = Math.max(0, Math.round(x0 * MASK_W));
    const toX = Math.min(MASK_W - 1, Math.round(x1 * MASK_W));
    const fromY = Math.max(0, Math.round((b.top + r0 * b.frac) * MASK_H));
    const toY = Math.min(MASK_H - 1, Math.round((b.top + r1 * b.frac) * MASK_H) - 1);
    for (let row = fromY; row <= toY; row++) {
      for (let col = fromX; col <= toX; col++) data[row * MASK_W + col] = 1;
    }
  };
  const f = b.frac;
  const c = 0.5;
  fill(c - 0.05 * f, c + 0.05 * f, 0, 0.14);
  if (view === 'front') {
    fill(c - 0.2 * f, c + 0.2 * f, 0.14, 0.56);
    fill(c - 0.17 * f, c - 0.02 * f, 0.56, 1);
    fill(c + 0.02 * f, c + 0.17 * f, 0.56, 1);
    fill(c - 0.27 * f, c - 0.2 * f, 0.17, 0.35);
    if (armGap) fill(c + 0.27 * f, c + 0.31 * f, 0.18, 0.52);
    else fill(c + 0.2 * f, c + 0.25 * f, 0.18, 0.52);
  } else {
    fill(c - 0.09 * f, c + 0.09 * f, 0.14, 0.56);
    fill(c - 0.07 * f, c + 0.07 * f, 0.56, 1);
  }
  return { width: MASK_W, height: MASK_H, data };
}

function square(cx: number, cy: number, w: number, h: number): MarkerObs {
  return {
    corners: [
      [cx - w / 2, cy - h / 2],
      [cx + w / 2, cy - h / 2],
      [cx + w / 2, cy + h / 2],
      [cx - w / 2, cy + h / 2],
    ],
    image_w: IMAGE_W,
    image_h: IMAGE_H,
    side_px: Math.max(w, h),
    confidence: 0.96,
  };
}

function curve(base: number, wave: number): (number | null)[] {
  return Array.from({ length: 101 }, (_, i) => {
    const value = base + wave * Math.sin((i / 100) * Math.PI * 3);
    return Math.round(Math.max(0, Math.min(400, value)) * 10) / 10;
  });
}

function silhouette(view: View, b: Body, crotch: boolean): SilhouetteFront | SilhouetteSide {
  const shared = {
    samples: 101 as const,
    mask_top_px: Math.round(b.top * IMAGE_H),
    mask_bottom_px: Math.round((b.top + b.frac) * IMAGE_H),
    image_w: IMAGE_W,
    image_h: IMAGE_H,
  };
  if (view === 'front') {
    return {
      ...shared,
      half_width_mm: curve(150, 30),
      crotch_y_px: crotch ? Math.round((b.top + 0.55 * b.frac) * IMAGE_H) : null,
    };
  }
  return { ...shared, half_depth_mm: curve(100, 20), anterior_mm: curve(90, 15) };
}

export class FakeVisionWorker implements WorkerLike {
  onmessage: ((event: { data: VisionReply }) => void) | null = null;
  private view: View = 'front';
  private samples = 0;
  private tick = 0;
  private body = bodyFor(1700);
  private computes = 0;
  private dead = false;

  /** `bursts` can outlive one worker, because a retake starts a new one and must see the earlier burst. */
  constructor(
    private readonly options: FakeOptions = DEFAULT_FAKE,
    private readonly bursts: Record<View, number> = { front: 0, side: 0 },
  ) {}

  postMessage(message: VisionRequest): void {
    const reply = this.handle(message);
    setTimeout(() => {
      if (!this.dead) this.onmessage?.({ data: reply });
    }, 0);
  }

  terminate(): void {
    this.dead = true;
  }

  private handle(message: VisionRequest): VisionReply {
    const { id } = message;
    switch (message.cmd) {
      case 'init':
        this.body = bodyFor(message.heightMm);
        return { id, ok: true };
      case 'reset':
        this.view = message.view;
        this.samples = 0;
        return { id, ok: true };
      case 'live':
        return { id, ok: true, sample: this.live() };
      case 'burst':
        return { id, ok: true, frames: this.burst(message.view) };
      case 'compute': {
        const { scenario } = this.options;
        this.computes += 1;
        const crash =
          scenario === 'compute_crash_twice'
            ? this.computes <= 2
            : scenario === 'compute_crash_once' && this.computes === 1;
        return crash ? { id, ok: false, error: 'worker_crash' } : { id, ok: true };
      }
    }
  }

  private active(): Scenario {
    const { scenario, recover } = this.options;
    return recover && this.samples > RECOVER_AFTER_SAMPLES ? 'good' : scenario;
  }

  /** One live sample for the current scenario. Exported through `live` for tests. */
  live(scenario: Scenario = this.active(), view: View = this.view): VisionSample {
    this.samples += 1;
    this.tick += 1;
    let body = this.body;
    if (scenario === 'too_far') body = { ...body, frac: 0.25, top: 0.35 };
    if (scenario === 'too_close') body = { ...body, frac: 0.75, top: 0.12 };
    if (scenario === 'cut_off') body = { ...body, top: 0.005 };

    const front = view === 'front';
    const tucked = scenario === 'arms_tucked';
    const landmarks = front
      ? poseFront(body, tucked ? 0.2 : 0.29)
      : poseSide(body, scenario === 'not_facing' ? 0.2 : 0.01);
    if (front && scenario === 'not_facing') {
      landmarks[24] = { ...landmarks[24], y: landmarks[24].y - 0.08 };
    }
    if (!front && tucked) {
      landmarks[16] = { ...landmarks[16], x: landmarks[24].x - 0.03 };
    }
    // A small, regular sway, and a large one for the unsteady case.
    const sway = (scenario === 'unsteady' ? 0.03 : 0.0005) * Math.sin(this.tick * 1.9) * body.frac;
    for (const point of landmarks) point.y += sway;

    const markerY = (body.top + (front ? 0.3 : 0.53) * body.frac) * IMAGE_H;
    const side = scenario === 'sheet_small' ? 70 : body.markerPx;
    let marker: MarkerObs | null = square(0.5 * IMAGE_W, markerY, side, scenario === 'sheet_tilted' ? side * 0.8 : side);
    if (scenario === 'sheet_missing' || scenario === 'sheet_fingers') marker = null;

    const orientation = scenario === 'level_fail' ? { beta: 80, gamma: 6 } : { beta: 90, gamma: 0 };
    if (scenario === 'no_person') {
      return { image_w: IMAGE_W, image_h: IMAGE_H, landmarks: null, mask: null, marker: null, luminance: 130, sharpness: 300, orientation };
    }
    return {
      image_w: IMAGE_W,
      image_h: IMAGE_H,
      landmarks,
      mask: drawMask(view, body, !tucked),
      marker,
      markerOccluded: scenario === 'sheet_fingers',
      luminance: scenario === 'too_dark' ? 30 : scenario === 'too_bright' ? 240 : 130,
      sharpness: scenario === 'blurry' ? 50 : 300,
      orientation,
    };
  }

  private burst(view: View): BurstFrame[] {
    const { scenario } = this.options;
    this.bursts[view] += 1;
    const first = this.bursts[view] === 1;
    const clean = this.live('good', view);
    const landmarks = clean.landmarks;
    let marker = clean.marker;
    // Only the first front burst is wrong, so a retake recovers.
    if (scenario === 'scale_disagree' && view === 'front' && first && marker) {
      const y = marker.corners[0][1] + marker.side_px / 2;
      marker = { ...square(0.5 * IMAGE_W, y, marker.side_px * 1.15, marker.side_px * 1.15), confidence: 0.7 };
    }
    const crotch = !(scenario === 'no_crotch' && first);
    const frames = Array.from({ length: CAPTURE_CONFIG.burst.frames }, (_, index) => {
      const bad = scenario === 'burst_bad' && first && index < 3;
      return {
        landmarks,
        marker: bad ? null : marker,
        silhouette: silhouette(view, this.body, crotch),
      };
    });
    return frames;
  }
}
