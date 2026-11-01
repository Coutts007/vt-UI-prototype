// Dev-only count of live image objects (privacy invariant 2). Compiled out of production builds.
export type FrameKind = 'bitmap' | 'mask';
export type FrameCounts = Record<FrameKind, number>;

const COUNTING = import.meta.env.DEV || import.meta.env.MODE !== 'production';
const counts: FrameCounts = { bitmap: 0, mask: 0 };

export const trackFrame = (kind: FrameKind, n = 1): void => {
  if (COUNTING) counts[kind] += n;
};
export const untrackFrame = (kind: FrameKind, n = 1): void => {
  if (COUNTING) counts[kind] -= n;
};
export const liveFrames = (): FrameCounts => ({ ...counts });
export const resetLedger = (): void => {
  counts.bitmap = 0;
  counts.mask = 0;
};

if (COUNTING && typeof globalThis !== 'undefined') {
  (globalThis as unknown as { __vtFrames?: () => FrameCounts }).__vtFrames = liveFrames;
}
