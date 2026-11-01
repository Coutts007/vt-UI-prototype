// MediaPipe pose and person mask, self-hosted (frontend-spec 10.5). Never posts an image back.
import { PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { binariseMask } from './frameMath';
import { MODEL_URLS, WASM_BINARY_URL, WASM_LOADER_URL } from './paths';
import { closing, ModelVariant, PoseRequest, PoseResult, WorkerReply } from './protocol';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PoseRequest>) => void) | null;
  postMessage(message: WorkerReply<PoseResult | null>, transfer?: Transferable[]): void;
};

// A live mask only has to give bounds and the waist row, so it stays small.
const LIVE_MASK_STEP = 4;

let live: PoseLandmarker | null = null;
let image: PoseLandmarker | null = null;
let delegate: 'GPU' | 'CPU' = 'GPU';
let imageVariant: ModelVariant = 'lite';
let inFlight = 0;
let emptyMasks = 0;
let swapping = false;
// Under some GL drivers the GPU run finds the pose but reads back an empty mask (seen with SwiftShader).
const EMPTY_MASKS_BEFORE_CPU = 3;

async function swapToCpu(): Promise<void> {
  swapping = true;
  delegate = 'CPU';
  const oldLive = live;
  const oldImage = image;
  try {
    live = await create('lite', 'VIDEO');
    image = await create(imageVariant, 'IMAGE');
    oldLive?.close();
    oldImage?.close();
  } finally {
    swapping = false;
    emptyMasks = 0;
  }
}

async function modelBytes(variant: ModelVariant): Promise<Uint8Array> {
  const url = MODEL_URLS[variant];
  const hit = 'caches' in self ? await caches.match(url) : undefined;
  const response = hit ?? (await fetch(url));
  if (!response.ok) throw new Error('model_missing');
  return new Uint8Array(await response.arrayBuffer());
}

async function create(variant: ModelVariant, mode: 'VIDEO' | 'IMAGE'): Promise<PoseLandmarker> {
  const fileset = { wasmLoaderPath: WASM_LOADER_URL, wasmBinaryPath: WASM_BINARY_URL };
  const modelAssetBuffer = await modelBytes(variant);
  const options = (chosen: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetBuffer, delegate: chosen },
    runningMode: mode,
    numPoses: 1,
    outputSegmentationMasks: true,
  });
  if (delegate === 'GPU') {
    try {
      const made = await PoseLandmarker.createFromOptions(fileset, options('GPU'));
      warmUp(made, mode); // A GPU that loads can still fail on its first run.
      return made;
    } catch {
      delegate = 'CPU';
    }
  }
  const made = await PoseLandmarker.createFromOptions(fileset, options('CPU'));
  warmUp(made, mode);
  return made;
}

function warmUp(landmarker: PoseLandmarker, mode: 'VIDEO' | 'IMAGE'): void {
  const blank = new OffscreenCanvas(64, 64);
  blank.getContext('2d')?.fillRect(0, 0, 64, 64);
  const done = (result: { close(): void }) => result.close();
  if (mode === 'VIDEO') landmarker.detectForVideo(blank as unknown as HTMLCanvasElement, 0, done);
  else landmarker.detect(blank as unknown as HTMLCanvasElement, done);
  blank.width = 0;
}

function read(result: PoseLandmarkerResult, step: number): PoseResult {
  const first = result.landmarks[0];
  const landmarks = first
    ? first.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0 }))
    : null;
  const raw = result.segmentationMasks?.[0];
  const mask = raw ? binariseMask(raw.getAsFloat32Array(), raw.width, raw.height, step) : null;
  result.close();
  if (delegate === 'GPU' && landmarks && mask) {
    emptyMasks = mask.data.some(Boolean) ? 0 : emptyMasks + 1;
    if (emptyMasks >= EMPTY_MASKS_BEFORE_CPU && !swapping) void swapToCpu();
  }
  return { landmarks, mask };
}

async function run(message: PoseRequest): Promise<PoseResult | null> {
  switch (message.cmd) {
    case 'init':
      live ??= await create('lite', 'VIDEO');
      if (message.alsoFull) {
        try {
          image ??= await create('full', 'IMAGE');
          imageVariant = 'full';
        } catch {
          image = null; // The full model is optional. Lite does the burst instead.
        }
      }
      image ??= await create('lite', 'IMAGE');
      return null;
    case 'detectLive': {
      const landmarker = live;
      if (!landmarker) throw new Error('not_ready');
      const { bitmap, ts } = message;
      return closing(bitmap, () => {
        if (swapping) return { landmarks: null, mask: null };
        let out: PoseResult = { landmarks: null, mask: null };
        landmarker.detectForVideo(bitmap, ts, (result) => {
          out = read(result, LIVE_MASK_STEP);
        });
        return out;
      });
    }
    case 'detectImage': {
      if (!image) throw new Error('not_ready');
      const { bitmap } = message;
      return closing(bitmap, async () => {
        while (swapping) await new Promise((resolve) => setTimeout(resolve, 50));
        let out: PoseResult = { landmarks: null, mask: null };
        image?.detect(bitmap, (result) => {
          out = read(result, 1);
        });
        return out;
      });
    }
  }
}

scope.onmessage = ({ data }) => {
  if ('bitmap' in data) inFlight += 1;
  void run(data)
    .then((result) => {
      if ('bitmap' in data) inFlight -= 1;
      const transfer = result?.mask ? [result.mask.data.buffer as ArrayBuffer] : [];
      scope.postMessage(
        { id: data.id, ok: true, result, liveBitmaps: inFlight, delegate, variant: imageVariant },
        transfer,
      );
    })
    .catch((error: unknown) => {
      if ('bitmap' in data) inFlight -= 1;
      scope.postMessage({ id: data.id, ok: false, error: String(error), liveBitmaps: inFlight });
    });
};
