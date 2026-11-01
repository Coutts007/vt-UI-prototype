// ArUco detection over OpenCV.js, usable from the worker and from a Node test (D15).
import type { MarkerObs } from './types';

/* The small part of the OpenCV.js surface this file uses. */
interface CvMat {
  data: Uint8Array;
  data32F: Float32Array;
  data32S: Int32Array;
  rows: number;
  delete(): void;
}
interface CvMatVector {
  size(): number;
  get(i: number): CvMat;
  delete(): void;
}
interface CvDeletable {
  delete(): void;
}
export interface OpenCv {
  Mat: new (rows?: number, cols?: number, type?: number) => CvMat;
  MatVector: new () => CvMatVector;
  CV_8UC1: number;
  DICT_4X4_50: number;
  CORNER_REFINE_SUBPIX?: number | { value: number };
  getPredefinedDictionary(id: number): CvDeletable;
  aruco_DetectorParameters: new () => CvDeletable & { cornerRefinementMethod: number };
  aruco_RefineParameters: new (a: number, b: number, c: boolean) => CvDeletable;
  aruco_ArucoDetector: new (d: CvDeletable, p: CvDeletable, r: CvDeletable) => CvDeletable & {
    detectMarkers(image: CvMat, corners: CvMatVector, ids: CvMat, rejected: CvMatVector): void;
  };
}

const MARKER_ID = 0;
const CORNER_REFINE_SUBPIX = 1;

export interface ArucoFound {
  id: number;
  corners: number[][];
}

export class ArucoFinder {
  private readonly dictionary: CvDeletable;
  private readonly params: CvDeletable;
  private readonly refine: CvDeletable;
  private readonly detector: ReturnType<ArucoFinder['build']>;

  constructor(private readonly cv: OpenCv) {
    this.dictionary = cv.getPredefinedDictionary(cv.DICT_4X4_50);
    const params = new cv.aruco_DetectorParameters();
    params.cornerRefinementMethod = CORNER_REFINE_SUBPIX;
    this.params = params;
    this.refine = new cv.aruco_RefineParameters(10, 3, true);
    this.detector = this.build();
  }

  private build() {
    return new this.cv.aruco_ArucoDetector(this.dictionary, this.params, this.refine);
  }

  /** Every marker in a greyscale image, plus whether a marker-shaped candidate was rejected. */
  find(gray: Uint8Array, width: number, height: number, rejectedMinSide = 0): { found: ArucoFound[]; rejectedSquare: boolean } {
    const { cv } = this;
    const image = new cv.Mat(height, width, cv.CV_8UC1);
    const corners = new cv.MatVector();
    const rejected = new cv.MatVector();
    const ids = new cv.Mat();
    try {
      image.data.set(gray);
      this.detector.detectMarkers(image, corners, ids, rejected);
      const found: ArucoFound[] = [];
      for (let i = 0; i < ids.rows; i++) {
        const mat = corners.get(i);
        const c = mat.data32F;
        found.push({ id: ids.data32S[i], corners: [[c[0], c[1]], [c[2], c[3]], [c[4], c[5]], [c[6], c[7]]] });
        mat.delete();
      }
      let rejectedSquare = false;
      for (let i = 0; i < rejected.size() && !rejectedSquare; i++) {
        const mat = rejected.get(i);
        const c = mat.data32F;
        const sides = [0, 1, 2, 3].map((k) => {
          const n = (k + 1) % 4;
          return Math.hypot(c[k * 2] - c[n * 2], c[k * 2 + 1] - c[n * 2 + 1]);
        });
        rejectedSquare = Math.min(...sides) >= rejectedMinSide && Math.max(...sides) / Math.max(Math.min(...sides), 1) <= 1.3;
        mat.delete();
      }
      return { found, rejectedSquare };
    } finally {
      image.delete();
      corners.delete();
      rejected.delete();
      ids.delete();
    }
  }

  /** The sheet's marker (id 0) as the contract stores it, or null. */
  findSheet(gray: Uint8Array, width: number, height: number, rejectedMinSide: number): { marker: MarkerObs | null; occluded: boolean } {
    const { found, rejectedSquare } = this.find(gray, width, height, rejectedMinSide);
    const hit = found.find((f) => f.id === MARKER_ID);
    if (!hit) return { marker: null, occluded: rejectedSquare };
    const n = hit.corners.length;
    const side =
      hit.corners.reduce((sum, c, i) => {
        const next = hit.corners[(i + 1) % n];
        return sum + Math.hypot(c[0] - next[0], c[1] - next[1]);
      }, 0) / n;
    return {
      marker: { corners: hit.corners, image_w: width, image_h: height, side_px: side, confidence: 1 },
      occluded: false,
    };
  }
}

/** The OpenCV.js global can be ready, a promise, or waiting on a callback, depending on the build. */
export async function readyOpenCv(global: unknown): Promise<OpenCv> {
  const made = typeof global === 'function' ? await (global as () => unknown)() : await global;
  const module = made as OpenCv & { onRuntimeInitialized?: () => void };
  if (module.Mat) return module;
  await new Promise<void>((resolve) => {
    module.onRuntimeInitialized = resolve;
  });
  return module;
}
