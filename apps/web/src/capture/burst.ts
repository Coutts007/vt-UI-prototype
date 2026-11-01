// Combines the burst into one result per view (frontend-spec 10.4). Frames go no further than here.
import type { BurstFrame, BurstResult, Landmark, MarkerObs, PersonMask, SilhouetteFront, SilhouetteSide } from '../vision/types';
import { CAPTURE_CONFIG } from './config';

export interface CombinedView {
  landmarks: Landmark[];
  marker: MarkerObs;
  silhouette: SilhouetteFront | SilhouetteSide;
  marker_confidence: number;
  still_source: 'imagecapture' | 'canvas';
  /** Held in memory for M7 and released by the session. It never joins the profile. */
  mask: PersonMask | null;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Null means more than two frames were unusable, so the client is asked to try again. */
export function combineBurst({ frames, still, mask = null }: BurstResult): CombinedView | null {
  const good = frames.filter((frame) => frame.landmarks && frame.marker);
  if (frames.length - good.length > CAPTURE_CONFIG.burst.maxBadFrames || !good.length) return null;

  const landmarks = good[0].landmarks!.map((_, i) => {
    const points = good.map((frame) => frame.landmarks![i]);
    return {
      x: median(points.map((p) => p.x)),
      y: median(points.map((p) => p.y)),
      z: median(points.map((p) => p.z)),
      visibility: median(points.map((p) => p.visibility)),
    };
  });

  const markers = good.map((frame) => frame.marker!);
  const medians = markers[0].corners.map((_, i) => [
    median(markers.map((m) => m.corners[i][0])),
    median(markers.map((m) => m.corners[i][1])),
  ]);
  const side = median(markers.map((m) => m.side_px));
  // The still gives sharper corners, but only if it agrees with the frames (D37).
  const useStill =
    !!still &&
    still.corners.every(
      (corner, i) =>
        Math.hypot(corner[0] - medians[i][0], corner[1] - medians[i][1]) <= CAPTURE_CONFIG.burst.stillAgreeSides * side,
    );
  const corners = useStill ? still.corners : medians;
  let spread = 0;
  for (const marker of markers) {
    marker.corners.forEach((corner, i) => {
      spread = Math.max(spread, Math.hypot(corner[0] - medians[i][0], corner[1] - medians[i][1]));
    });
  }
  const validFraction = good.length / frames.length;
  const seen = median(markers.map((m) => m.confidence));
  const marker_confidence = Math.max(0, Math.min(1, validFraction * (1 - spread / Math.max(side, 1)) * seen));

  return {
    landmarks,
    marker: {
      corners,
      image_w: markers[0].image_w,
      image_h: markers[0].image_h,
      side_px: useStill ? still.side_px : side,
      confidence: marker_confidence,
    },
    silhouette: good[good.length - 1].silhouette,
    marker_confidence,
    still_source: useStill ? 'imagecapture' : 'canvas',
    mask,
  };
}
