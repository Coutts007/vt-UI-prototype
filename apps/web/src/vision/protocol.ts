// Messages between the main thread and the vision workers. Replies hold numbers and masks only.
import type { Landmark, MarkerObs, PersonMask } from './types';
import type { Box } from './frameMath';

export type ModelVariant = 'lite' | 'full';

export type PoseRequest =
  | { id: number; cmd: 'init'; variant: ModelVariant; alsoFull: boolean }
  | { id: number; cmd: 'detectLive'; bitmap: ImageBitmap; ts: number }
  | { id: number; cmd: 'detectImage'; bitmap: ImageBitmap };

export interface PoseResult {
  landmarks: Landmark[] | null;
  mask: PersonMask | null;
}

export type MarkerRequest =
  | { id: number; cmd: 'init' }
  | { id: number; cmd: 'find'; bitmap: ImageBitmap; box: Box | null };

export interface MarkerResult {
  marker: MarkerObs | null;
  occluded: boolean;
  luminance: number;
  sharpness: number;
  width: number;
  height: number;
}

export type WorkerReply<T> =
  | { id: number; ok: true; result: T; liveBitmaps: number; delegate?: string; variant?: ModelVariant }
  | { id: number; ok: false; error: string; liveBitmaps: number };

/** Every path in a worker that receives a bitmap closes it. This helper is that promise. */
export async function closing<T>(bitmap: ImageBitmap, work: () => T | Promise<T>): Promise<T> {
  try {
    return await work();
  } finally {
    bitmap.close();
  }
}
