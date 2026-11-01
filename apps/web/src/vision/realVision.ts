// The real vision pipeline behind the WorkerLike seam (10.2, 10.4). Loaded on demand. Frames live
// only for one pass through here: every bitmap is closed, and only numbers and masks come back.
import { captureCamera, CameraManager } from '../capture/cameraManager';
import { CAPTURE_CONFIG } from '../capture/config';
import { captureSession } from '../capture/session';
import { Box, majorityMask } from './frameMath';
import { untrackFrame } from './ledger';
import { maskRows } from '../measure/silhouette';
import { MODEL_URLS } from './paths';
import type { MarkerResult, ModelVariant, PoseResult } from './protocol';
import type {
  BurstFrame,
  BurstResult,
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
import { WorkerClient, WorkerPort } from './workerClient';

const { timing, burst: BURST, frames: FRAMES } = CAPTURE_CONFIG;
export const REAL_LIMITS = { initMs: timing.modelLoadMs, liveMs: timing.realLiveMs };

const nulls = (): null[] => Array.from({ length: 101 }, () => null);

/**
 * Empty until the mask is read. Bottom 0 means a view with no mask fails, instead of the frame's own
 * height passing for the person's. Null means not measured, never a made-up value.
 */
export function emptySilhouette(view: View, w: number, h: number): SilhouetteFront | SilhouetteSide {
  const shared = { samples: 101 as const, mask_top_px: 0, mask_bottom_px: 0, image_w: w, image_h: h };
  return view === 'front'
    ? { ...shared, half_width_mm: nulls(), crotch_y_px: null }
    : { ...shared, half_depth_mm: nulls(), anterior_mm: nulls() };
}

export function boxOf(sample: PoseResult): Box | null {
  const { mask } = sample;
  if (!mask) return null;
  let top = mask.height;
  let bottom = 0;
  let left = mask.width;
  let right = 0;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (!mask.data[y * mask.width + x]) continue;
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + 1);
      left = Math.min(left, x);
      right = Math.max(right, x + 1);
    }
  }
  if (bottom === 0) return null;
  return { top: top / mask.height, bottom: bottom / mask.height, left: left / mask.width, right: right / mask.width };
}

/** The top and bottom of the combined mask, in frame pixels. */
export function withMaskBounds(frame: BurstFrame, mask: PersonMask | null, imageH: number): BurstFrame {
  if (!mask) return frame;
  const rows = maskRows(mask);
  if (!rows) return frame;
  const { top, bottom } = rows;
  const scale = imageH / mask.height;
  return {
    ...frame,
    silhouette: { ...frame.silhouette, mask_top_px: Math.round(top * scale), mask_bottom_px: Math.round(bottom * scale) },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Puts a still's marker into the frames' coordinates. A still of another shape cannot be compared. */
export function stillToFrame(still: MarkerObs, w: number, h: number): MarkerObs | null {
  const same = Math.abs(still.image_w / still.image_h - w / h) <= 0.01;
  if (!same) return null;
  const scale = w / still.image_w;
  return {
    corners: still.corners.map(([x, y]) => [x * scale, y * scale]),
    image_w: w,
    image_h: h,
    side_px: still.side_px * scale,
    confidence: still.confidence,
  };
}

export interface RealDeps {
  camera: Pick<CameraManager, 'grab' | 'still' | 'applied'>;
  pose: () => WorkerPort;
  marker: () => WorkerPort;
  memoryGb: number | null;
  fullAvailable: () => Promise<boolean>;
  report: (facts: { variant: ModelVariant; stream: { width: number; height: number } | null }) => void;
}

const defaultDeps = (): RealDeps => ({
  camera: captureCamera,
  pose: () => new Worker(new URL('./pose.worker.ts', import.meta.url)) as unknown as WorkerPort,
  marker: () => new Worker(new URL('./marker.worker.ts', import.meta.url)) as unknown as WorkerPort,
  memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
  fullAvailable: async () => ('caches' in window ? !!(await caches.match(MODEL_URLS.full)) : false),
  report: ({ variant, stream }) => {
    captureSession.modelVariant = variant;
    captureSession.streamSize = stream;
  },
});

export class RealVisionWorker implements WorkerLike {
  onmessage: ((event: { data: VisionReply }) => void) | null = null;
  private readonly deps: RealDeps;
  private readonly pose: WorkerClient;
  private readonly marker: WorkerClient;
  private dead = false;
  private ready: Promise<void> | null = null;
  private isReady = false;
  private live: Promise<VisionSample> | null = null;
  private box: Box | null = null;
  private lastTs = 0;
  /** The model that really ran the burst, for the session record. */
  variant: ModelVariant = 'lite';

  constructor(deps: RealDeps = defaultDeps()) {
    this.deps = deps;
    this.pose = new WorkerClient(deps.pose, () => this.initPose());
    this.marker = new WorkerClient(deps.marker, () => this.initMarker());
    if (import.meta.env.MODE !== 'production') {
      (globalThis as unknown as { __vtWorkerBitmaps?: () => number }).__vtWorkerBitmaps = () =>
        this.pose.liveBitmaps + this.marker.liveBitmaps;
    }
  }

  private get lowMemory(): boolean {
    return this.deps.memoryGb !== null && this.deps.memoryGb <= FRAMES.lowMemoryGb;
  }

  private async initPose(): Promise<void> {
    const memory = this.deps.memoryGb;
    const big = memory === null || memory >= FRAMES.fullModelMinGb;
    const alsoFull = big && (await this.deps.fullAvailable());
    const reply = await this.pose.call(
      () => ({ message: { cmd: 'init', variant: 'lite', alsoFull } }),
      timing.modelLoadMs,
    );
    this.variant = (reply.variant as ModelVariant | undefined) ?? 'lite';
  }

  private async initMarker(): Promise<void> {
    await this.marker.call(() => ({ message: { cmd: 'init' } }), timing.modelLoadMs);
  }

  private init(): Promise<void> {
    this.ready ??= Promise.all([this.initPose(), this.initMarker()]).then(() => {
      this.isReady = true;
    });
    return this.ready;
  }

  /** A copy for the worker, made fresh for each attempt because a transferred bitmap is gone. */
  private ask(client: WorkerClient, frame: ImageBitmap, body: object, timeoutMs: number, restartOnTimeout = false) {
    return client.call(
      async () => {
        const bitmap = await createImageBitmap(frame);
        return { message: { ...body, bitmap }, transfer: [bitmap] };
      },
      timeoutMs,
      restartOnTimeout,
    );
  }

  private async sample(): Promise<VisionSample> {
    if (!this.isReady) {
      return { image_w: 0, image_h: 0, landmarks: null, mask: null, marker: null, luminance: 0, sharpness: 0 };
    }
    const frame = await this.deps.camera.grab(FRAMES.liveLongEdge);
    try {
      this.lastTs = Math.max(this.lastTs + 1, Math.round(performance.now()));
      const [pose, found] = await Promise.all([
        this.ask(this.pose, frame, { cmd: 'detectLive', ts: this.lastTs }, timing.liveTimeoutMs),
        this.ask(this.marker, frame, { cmd: 'find', box: this.box }, timing.liveTimeoutMs),
      ]);
      const poseResult = pose.result as PoseResult;
      const markerResult = found.result as MarkerResult;
      this.box = boxOf(poseResult);
      return {
        image_w: frame.width,
        image_h: frame.height,
        landmarks: poseResult.landmarks,
        mask: poseResult.mask,
        marker: markerResult.marker,
        markerOccluded: markerResult.occluded,
        luminance: markerResult.luminance,
        sharpness: markerResult.sharpness,
      };
    } finally {
      frame.close();
      untrackFrame('bitmap');
    }
  }

  /** One burst frame through both workers. The stored frame lets a restart run it again (9.9). */
  private async processFrame(frame: ImageBitmap, view: View): Promise<BurstFrame & { mask: PersonMask | null }> {
    const pose = await this.ask(this.pose, frame, { cmd: 'detectImage' }, timing.burstTimeoutMs, true);
    const found = await this.ask(this.marker, frame, { cmd: 'find', box: null }, timing.burstTimeoutMs, true);
    const poseResult = pose.result as PoseResult;
    return {
      landmarks: poseResult.landmarks,
      marker: (found.result as MarkerResult).marker,
      mask: poseResult.mask,
      silhouette: emptySilhouette(view, frame.width, frame.height),
    };
  }

  private async burst(view: View): Promise<BurstResult> {
    const { camera } = this.deps;
    const longEdge = this.lowMemory ? FRAMES.liveLongEdge : FRAMES.burstLongEdge;
    const held: ImageBitmap[] = [];
    const close = (bitmap: ImageBitmap) => {
      bitmap.close();
      untrackFrame('bitmap');
    };
    let photo: ImageBitmap | null = null;
    try {
      photo = await camera.still();
      for (let i = 0; i < BURST.frames; i++) {
        const started = performance.now();
        held.push(await camera.grab(longEdge));
        await sleep(Math.max(0, BURST.spacingMs - (performance.now() - started)));
      }
      const { width, height } = held[0];
      let still: MarkerObs | null = null;
      if (photo) {
        const reply = await this.ask(this.marker, photo, { cmd: 'find', box: null }, timing.burstTimeoutMs, true);
        const seen = (reply.result as MarkerResult).marker;
        still = seen && stillToFrame(seen, width, height);
        close(photo);
        photo = null;
      }
      const frames: BurstFrame[] = [];
      const masks: PersonMask[] = [];
      while (held.length) {
        const { mask, ...numbers } = await this.processFrame(held[0], view);
        if (mask && numbers.landmarks) masks.push(mask);
        frames.push(numbers);
        close(held.shift()!);
      }
      const mask = majorityMask(masks);
      // Floor phones give the marker worker's memory back between views (10.2).
      if (this.lowMemory) this.marker.terminate();
      this.deps.report({
        variant: this.variant,
        stream: camera.applied ? { width: camera.applied.width, height: camera.applied.height } : null,
      });
      return { frames: frames.map((frame) => withMaskBounds(frame, mask, height)), still, mask };
    } finally {
      held.forEach(close);
      if (photo) close(photo);
    }
  }

  private async handle(message: VisionRequest): Promise<VisionReply> {
    const { id } = message;
    switch (message.cmd) {
      case 'init':
        await this.init();
        return { id, ok: true };
      case 'reset':
        this.box = null;
        if (this.lowMemory && this.isReady) await this.initMarker(); // It may have gone after the last burst.
        return { id, ok: true };
      case 'live':
        this.live ??= this.sample().finally(() => {
          this.live = null;
        });
        return { id, ok: true, sample: await this.live };
      case 'burst': {
        await this.init();
        return { id, ok: true, ...(await this.burst(message.view)) };
      }
      case 'compute':
        return { id, ok: true };
    }
  }

  postMessage(message: VisionRequest): void {
    void this.handle(message)
      .catch((error: unknown): VisionReply => ({ id: message.id, ok: false, error: String(error) }))
      .then((data) => {
        if (!this.dead) this.onmessage?.({ data });
      });
  }

  terminate(): void {
    this.dead = true;
    this.pose.dispose();
    this.marker.dispose();
  }
}

