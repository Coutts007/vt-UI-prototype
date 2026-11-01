// Pure numbers from pixels, shared by the workers and their tests. Nothing here keeps a frame.
import type { PersonMask } from './types';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** RGBA to one luma byte per pixel (BT.601). */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
  }
  return gray;
}

/** Mean luminance inside a box given as fractions of the frame (10.3 check 8). */
export function meanLuminance(gray: Uint8Array, width: number, height: number, box: Box | null): number {
  const x0 = Math.max(0, Math.floor((box?.left ?? 0) * width));
  const x1 = Math.min(width, Math.ceil((box?.right ?? 1) * width));
  const y0 = Math.max(0, Math.floor((box?.top ?? 0) * height));
  const y1 = Math.min(height, Math.ceil((box?.bottom ?? 1) * height));
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      sum += gray[y * width + x];
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

/** Variance of the 4-neighbour Laplacian, the sharpness number in 10.3 check 8. */
export function laplacianVariance(gray: Uint8Array, width: number, height: number): number {
  let sum = 0;
  let squares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const value = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += value;
      squares += value * value;
      count += 1;
    }
  }
  if (!count) return 0;
  const mean = sum / count;
  return squares / count - mean * mean;
}

/** MediaPipe confidence (0 to 1) to a 0 or 1 mask, keeping every `step`-th cell. */
export function binariseMask(confidence: Float32Array, width: number, height: number, step = 1): PersonMask {
  const w = Math.floor(width / step);
  const h = Math.floor(height / step);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      data[y * w + x] = confidence[y * step * width + x * step] >= 0.5 ? 1 : 0;
    }
  }
  return { width: w, height: h, data };
}

/** Pixel-wise majority of same-sized masks (10.4). Null when there is nothing to combine. */
export function majorityMask(masks: PersonMask[]): PersonMask | null {
  const first = masks[0];
  if (!first) return null;
  const same = masks.filter((m) => m.width === first.width && m.height === first.height);
  const data = new Uint8Array(first.data.length);
  for (let i = 0; i < data.length; i++) {
    let votes = 0;
    for (const mask of same) votes += mask.data[i];
    data[i] = votes * 2 > same.length ? 1 : 0;
  }
  return { width: first.width, height: first.height, data };
}

/** Output size for a frame, and whether a landscape delivery must be turned to portrait (10.1.4). */
export function frameGeometry(
  videoW: number,
  videoH: number,
  longEdge: number,
  wantPortrait: boolean,
): { w: number; h: number; rotate: boolean } {
  const rotate = wantPortrait && videoW > videoH;
  const scale = Math.min(1, longEdge / Math.max(videoW, videoH));
  const w = Math.round(videoW * scale);
  const h = Math.round(videoH * scale);
  return rotate ? { w: h, h: w, rotate } : { w, h, rotate };
}
