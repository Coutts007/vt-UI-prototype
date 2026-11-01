// What a vision worker hands back: numbers and small masks only, never a frame (golden rule 1).
import type { components } from '@vt/contracts';

export type Landmark = components['schemas']['Landmark'];
export type MarkerObs = components['schemas']['MarkerObs'];
export type SilhouetteFront = components['schemas']['SilhouetteFront'];
export type SilhouetteSide = components['schemas']['SilhouetteSide'];
export type ViewChecks = components['schemas']['ViewChecks'];
export type View = 'front' | 'side';

/** A person mask as 0 or 1 per cell, top row first. */
export interface PersonMask {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface VisionSample {
  image_w: number;
  image_h: number;
  landmarks: Landmark[] | null;
  mask: PersonMask | null;
  marker: MarkerObs | null;
  /** The marker is partly covered, so the correction can name the fingers. */
  markerOccluded?: boolean;
  luminance: number;
  sharpness: number;
  /** Fake vision supplies the tilt on a laptop. A real phone uses its sensors. */
  orientation?: { beta: number; gamma: number };
}

export interface BurstFrame {
  landmarks: Landmark[] | null;
  marker: MarkerObs | null;
  silhouette: SilhouetteFront | SilhouetteSide;
}

/** A burst: the frames, and the marker from the full-resolution still where one was taken (10.4). */
export interface BurstResult {
  frames: BurstFrame[];
  still?: MarkerObs | null;
  /** Pixel-wise majority of the frames' masks. M7 reads it before it is released. */
  mask?: PersonMask | null;
}

export type VisionRequest =
  | { id: number; cmd: 'init'; heightMm: number }
  | { id: number; cmd: 'reset'; view: View }
  | { id: number; cmd: 'live' }
  | { id: number; cmd: 'burst'; view: View }
  | { id: number; cmd: 'compute' };

export type VisionReply =
  | { id: number; ok: true; sample?: VisionSample; frames?: BurstFrame[]; still?: MarkerObs | null; mask?: PersonMask | null }
  | { id: number; ok: false; error: string };

/** The same shape as a Web Worker, so M6 can swap in real workers behind VisionClient. */
export interface WorkerLike {
  postMessage(message: VisionRequest): void;
  onmessage: ((event: { data: VisionReply }) => void) | null;
  terminate(): void;
}
