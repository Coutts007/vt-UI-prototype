// Finds the sheet's ArUco marker and reads light and sharpness from the frame (10.3, 10.5).
// Runs as a classic worker, because the OpenCV.js build is a classic script.
import { CAPTURE_CONFIG } from '../capture/config';
import { ArucoFinder, readyOpenCv } from './arucoDetect';
import { laplacianVariance, meanLuminance, toGray } from './frameMath';
import { OPENCV_URL } from './paths';
import { closing, MarkerRequest, MarkerResult, WorkerReply } from './protocol';

declare function importScripts(...urls: string[]): void;

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<MarkerRequest>) => void) | null;
  postMessage(message: WorkerReply<MarkerResult | null>): void;
  cv?: unknown;
};

let finder: ArucoFinder | null = null;
let inFlight = 0;

async function init(): Promise<void> {
  if (finder) return;
  importScripts(OPENCV_URL);
  finder = new ArucoFinder(await readyOpenCv(scope.cv));
}

function find(bitmap: ImageBitmap, box: MarkerRequest & { cmd: 'find' }): MarkerResult {
  if (!finder) throw new Error('not_ready');
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no_canvas');
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, width, height);
  const gray = toGray(pixels.data, width, height);
  canvas.width = 0;
  canvas.height = 0;
  const minSide = CAPTURE_CONFIG.marker.sideMinPx * (height / 1920);
  const { marker, occluded } = finder.findSheet(gray, width, height, minSide);
  return {
    marker,
    occluded,
    luminance: meanLuminance(gray, width, height, box.box),
    sharpness: laplacianVariance(gray, width, height),
    width,
    height,
  };
}

scope.onmessage = ({ data }) => {
  if (data.cmd === 'find') inFlight += 1;
  const work: Promise<MarkerResult | null> =
    data.cmd === 'init' ? init().then(() => null) : closing(data.bitmap, () => find(data.bitmap, data));
  void work
    .then((result) => {
      if (data.cmd === 'find') inFlight -= 1;
      scope.postMessage({ id: data.id, ok: true, result, liveBitmaps: inFlight });
    })
    .catch((error: unknown) => {
      if (data.cmd === 'find') inFlight -= 1;
      scope.postMessage({ id: data.id, ok: false, error: String(error), liveBitmaps: inFlight });
    });
};
