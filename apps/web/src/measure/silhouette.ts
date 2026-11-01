// Turns a person mask into the 101-sample profiles, before the mask is released (A5 F1, A14).
// Everything after this point works from these numbers, so the server can re-derive them.
import type { Arm, Point } from './derive';

export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}
export interface ProfileArgs {
  mask: Mask;
  landmarks: readonly Point[];
  /** Millimetres per image pixel in this view. */
  scale: number;
  imageW: number;
  imageH: number;
}

const SAMPLES = 101;
/** Fewer contiguous mask pixels than this is not body (frontend-spec 11.3). */
const MIN_RUN = 3;
/** The contract's limit for one profile value. */
const MAX_MM = 400;
/*
 * PROVISIONAL (D39): these three are not measured yet. Tune them on real captures.
 * A hole this wide in a mask is a segmentation fault, not air. The free arm stands farther out (A14).
 */
const MAX_HOLE_MM = 30;
/** Half an arm's thickness, as a share of the shoulder-to-hip span. */
const ARM_HALF_OF_SPAN = 0.04;
/** How far a hand reaches below the wrist, as a share of the shoulder-to-hip span. */
const HAND_OF_SPAN = 0.2;
/** Rows of body in a row that close the leg gap, so one noisy pixel does not. */
const CROTCH_ROWS = 3;

const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const ARM_POINTS: Record<Arm, readonly [number, number, number]> = { left: [11, 13, 15], right: [12, 14, 16] };

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const tenth = (value: number) => Math.round(value * 10) / 10;

/**
 * The tallest unbroken block of rows with body in them, in mask rows. A stray pixel away from the
 * body must not set the height.
 */
export function maskRows(mask: Mask): { top: number; bottom: number } | null {
  let best: { top: number; bottom: number } | null = null;
  let start = -1;
  for (let row = 0; row <= mask.height; row++) {
    const from = row * mask.width;
    let on = 0;
    if (row < mask.height) {
      for (let x = 0; x < mask.width; x++) if (mask.data[from + x]) on += 1;
    }
    if (on >= MIN_RUN) {
      if (start < 0) start = row;
    } else if (start >= 0) {
      if (!best || row - start > best.bottom - best.top) best = { top: start, bottom: row };
      start = -1;
    }
  }
  return best;
}

class Grid {
  constructor(private readonly mask: Mask) {}
  on(x: number, row: number): boolean {
    const { width, height, data } = this.mask;
    return x >= 0 && x < width && row >= 0 && row < height && data[row * width + x] !== 0;
  }
  /** The body's edge as a position between pixels, walking from x in direction dir. */
  edge(x: number, row: number, dir: 1 | -1, maxHole: number): number {
    let at = x;
    for (;;) {
      while (this.on(at, row)) at += dir;
      let next = at;
      while (Math.abs(next - at) <= maxHole && !this.on(next, row)) next += dir;
      if (!this.on(next, row)) return dir === 1 ? at : at + 1;
      at = next;
    }
  }
  /** The nearest body pixel to x within maxHole, or null. */
  near(x: number, row: number, maxHole: number): number | null {
    for (let d = 0; d <= maxHole; d++) {
      if (this.on(x + d, row)) return x + d;
      if (this.on(x - d, row)) return x - d;
    }
    return null;
  }
}

/** The x of a line through points at a given y, level with its ends beyond them. */
function lineX(points: readonly { x: number; y: number }[], y: number): number {
  if (y <= points[0].y) return points[0].x;
  for (let i = 1; i < points.length; i++) {
    const [p, q] = [points[i - 1], points[i]];
    if (y <= q.y) return q.y === p.y ? q.x : p.x + ((q.x - p.x) * (y - p.y)) / (q.y - p.y);
  }
  return points[points.length - 1].x;
}

const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const profileOf = (fill: (i: number) => number | null) =>
  Array.from({ length: SAMPLES }, (_, i) => {
    const value = fill(i);
    return value === null || value > MAX_MM ? null : tenth(value);
  });

interface Frame {
  rows: { top: number; bottom: number };
  top: number;
  bottom: number;
  rowOf: (i: number) => number;
}

function frameOf({ mask, imageH }: ProfileArgs): Frame | null {
  const rows = maskRows(mask);
  if (!rows) return null;
  const factor = imageH / mask.height;
  const top = Math.round(rows.top * factor);
  const bottom = Math.round(rows.bottom * factor);
  return {
    rows,
    top,
    bottom,
    rowOf: (i) => clamp(Math.floor(((top + (i / 100) * (bottom - top)) / imageH) * mask.height), 0, mask.height - 1),
  };
}

const empty = () => Array.from({ length: SAMPLES }, () => null as number | null);

/**
 * Torso half-width with arms removed, measured on the free-arm side of the centre line, because the
 * arm holding the sheet can merge with the torso on its own side (A14).
 */
function frontWidths(args: ProfileArgs, frame: Frame, arm: Arm): (number | null)[] {
  const { mask, landmarks: lm, scale, imageW } = args;
  const grid = new Grid(mask);
  const toRow = (y: number) => y * mask.height;
  const toX = (x: number) => x * mask.width;
  const shoulders = mid(lm[LEFT_SHOULDER], lm[RIGHT_SHOULDER]);
  const hips = mid(lm[23], lm[24]);
  const knees = mid(lm[25], lm[26]);
  const centreLine = [shoulders, hips].map((p) => ({ x: toX(p.x), y: toRow(p.y) }));
  const hipRow = toRow(hips.y);
  const kneeRow = toRow(knees.y);
  const [armShoulder, armElbow, armWrist] = ARM_POINTS[arm];
  const armLine = [armShoulder, armElbow, armWrist].map((i) => ({ x: toX(lm[i].x), y: toRow(lm[i].y) }));
  const dir: 1 | -1 = lm[armShoulder].x >= shoulders.x ? 1 : -1;
  const spanRows = Math.max(hipRow - toRow(shoulders.y), 1);
  const armHalf = ARM_HALF_OF_SPAN * spanRows;
  const armEnd = armLine[2].y + HAND_OF_SPAN * spanRows;
  const mmPerCell = (scale * imageW) / mask.width;
  const maxHole = Math.round(MAX_HOLE_MM / mmPerCell);

  return profileOf((i) => {
    const row = frame.rowOf(i);
    if (row > kneeRow) return null; // Below the knee no measurement uses it.
    const centre = Math.round(lineX(centreLine, row));
    let from: number | null = grid.near(centre, row, maxHole);
    if (from === null) {
      // Between the legs the width runs to the outside of the thigh. Anywhere else it is a gap.
      if (row <= hipRow) return null;
      for (let x = centre; x >= 0 && x < mask.width && from === null; x += dir) {
        if (grid.on(x, row)) from = x;
      }
      if (from === null) return null;
    }
    const end = grid.edge(from, row, dir, maxHole);
    if (Math.abs(end - from) < MIN_RUN) return null;
    if (row >= armLine[0].y && row <= armEnd) {
      // The arm or hand has merged with the body here. Where the torso ends cannot be read from
      // this row, so it is left null and fails visibly rather than becoming an estimate.
      const armX = lineX(armLine, row);
      if ((end - armX) * dir > -armHalf && (armX - centre) * dir > 0) return null;
    }
    return Math.max(0, (end - centre) * dir) * mmPerCell;
  });
}

/**
 * The first row, scanning up from the ankles, where the leg gap closes (10.2), in image px. Closed
 * means unbroken body from one knee's column to the other's, so a speck in the gap does not count.
 */
function crotchRow(args: ProfileArgs): number | null {
  const { mask, landmarks: lm, imageH } = args;
  const grid = new Grid(mask);
  const columns = [lm[25].x, lm[26].x].map((x) => Math.round(x * mask.width));
  const [from, to] = [Math.min(...columns), Math.max(...columns)];
  const closedAt = (row: number) => {
    for (let x = from; x <= to; x++) if (!grid.on(x, row)) return false;
    return true;
  };
  const ankles = mid(lm[27], lm[28]);
  const hipRow = mid(lm[23], lm[24]).y * mask.height;
  let sawGap = false;
  let run = 0;
  for (let row = Math.min(Math.floor(ankles.y * mask.height), mask.height - 1); row >= 0; row--) {
    if (closedAt(row)) {
      run += 1;
      if (sawGap && run >= CROTCH_ROWS) {
        const bottom = row + CROTCH_ROWS;
        return bottom > hipRow ? Math.round((bottom / mask.height) * imageH) : null;
      }
    } else {
      sawGap = true;
      run = 0;
    }
  }
  return null;
}

export function frontProfile(args: ProfileArgs, arm: Arm) {
  const frame = frameOf(args);
  const shared = {
    samples: SAMPLES as typeof SAMPLES,
    mask_top_px: frame?.top ?? 0,
    mask_bottom_px: frame?.bottom ?? 0,
    image_w: args.imageW,
    image_h: args.imageH,
  };
  if (!frame) return { ...shared, half_width_mm: empty(), crotch_y_px: null };
  return { ...shared, half_width_mm: frontWidths(args, frame, arm), crotch_y_px: crotchRow(args) };
}

/** Half-depth along the body's near side, and how far the front edge sits ahead of the centre line. */
export function sideProfile(args: ProfileArgs) {
  const frame = frameOf(args);
  const shared = {
    samples: SAMPLES as typeof SAMPLES,
    mask_top_px: frame?.top ?? 0,
    mask_bottom_px: frame?.bottom ?? 0,
    image_w: args.imageW,
    image_h: args.imageH,
  };
  if (!frame) return { ...shared, half_depth_mm: empty(), anterior_mm: empty() };
  const { mask, landmarks: lm, scale, imageW } = args;
  const grid = new Grid(mask);
  const useRight = lm[12].visibility + lm[24].visibility >= lm[11].visibility + lm[23].visibility;
  const [s, h, k] = useRight ? [lm[12], lm[24], lm[26]] : [lm[11], lm[23], lm[25]];
  const axis = [s, h, k].map((p) => ({ x: p.x * mask.width, y: p.y * mask.height }));
  const kneeRow = axis[2].y;
  const facing: 1 | -1 = lm[0].x >= s.x ? 1 : -1;
  const mmPerCell = (scale * imageW) / mask.width;
  const maxHole = Math.round(MAX_HOLE_MM / mmPerCell);
  const spanRows = Math.max(axis[1].y - axis[0].y, 1);
  const armHalf = ARM_HALF_OF_SPAN * spanRows;
  const forearms = [[13, 15], [14, 16]].map(([elbow, wrist]) =>
    [lm[elbow], lm[wrist]].map((p) => ({ x: p.x * mask.width, y: p.y * mask.height })),
  );
  const depth = empty();
  const anterior = empty();
  for (let i = 0; i < SAMPLES; i++) {
    const row = frame.rowOf(i);
    if (row > kneeRow) continue;
    const centre = Math.round(lineX(axis, row));
    const from = grid.near(centre, row, maxHole);
    if (from === null) continue;
    const right = grid.edge(from, row, 1, maxHole);
    const left = grid.edge(from, row, -1, maxHole);
    if (right - left < MIN_RUN) continue;
    // A forearm held off the body's line adds to the depth here, and the hip search takes the most.
    const armHere = forearms.some(([elbow, wrist]) => {
      if (wrist.y <= elbow.y || row < elbow.y || row > wrist.y + HAND_OF_SPAN * spanRows) return false;
      const armX = lineX([elbow, wrist], row);
      return Math.abs(armX - centre) > armHalf && armX >= left && armX <= right;
    });
    if (armHere) continue;
    const half = ((right - left) / 2) * mmPerCell;
    const forward = ((facing === 1 ? right : left) - centre) * facing * mmPerCell;
    if (half <= MAX_MM) depth[i] = tenth(half);
    if (forward <= MAX_MM) anterior[i] = tenth(forward);
  }
  return { ...shared, half_depth_mm: depth, anterior_mm: anterior };
}
