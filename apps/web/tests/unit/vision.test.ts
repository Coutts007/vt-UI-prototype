import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { combineBurst } from '../../src/capture/burst';
import { CaptureSession } from '../../src/capture/session';
import {
  binariseMask,
  frameGeometry,
  laplacianVariance,
  majorityMask,
  meanLuminance,
  toGray,
} from '../../src/vision/frameMath';
import { liveFrames, resetLedger, trackFrame } from '../../src/vision/ledger';
import {
  boxOf,
  emptySilhouette,
  RealDeps,
  RealVisionWorker,
  stillToFrame,
  withMaskBounds,
} from '../../src/vision/realVision';
import type { VisionReply } from '../../src/vision/types';
import {
  WorkerClient,
  WorkerCrash,
  WorkerPort,
  WorkerTimeout,
} from '../../src/vision/workerClient';

describe('frame numbers', () => {
  it('reads luminance inside the box only', () => {
    const gray = new Uint8Array([0, 0, 200, 200]);
    expect(meanLuminance(gray, 4, 1, { left: 0.5, right: 1, top: 0, bottom: 1 })).toBe(200);
    expect(meanLuminance(gray, 4, 1, null)).toBe(100);
  });
  it('a sharp edge has a higher Laplacian variance than a flat frame', () => {
    const flat = new Uint8Array(100).fill(120);
    const edge = flat.map((_, i) => (i % 10 < 5 ? 0 : 255));
    expect(laplacianVariance(flat, 10, 10)).toBe(0);
    expect(laplacianVariance(edge, 10, 10)).toBeGreaterThan(1000);
  });
  it('turns RGBA to grey', () => {
    expect(toGray(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1)[1]).toBe(0);
    expect(toGray(new Uint8Array([255, 255, 255, 255]), 1, 1)[0]).toBeGreaterThan(250);
  });
  it('binarises at one half, optionally smaller', () => {
    const mask = binariseMask(new Float32Array([0.9, 0.1, 0.2, 0.6]), 2, 2);
    expect([...mask.data]).toEqual([1, 0, 0, 1]);
    expect(binariseMask(new Float32Array(16).fill(1), 4, 4, 2).width).toBe(2);
    expect(mask.data).toBeInstanceOf(Uint8Array);
  });
  it('majority of the masks, per pixel (10.4)', () => {
    const m = (a: number[]) => ({ width: 2, height: 1, data: new Uint8Array(a) });
    expect([...majorityMask([m([1, 0]), m([1, 1]), m([0, 0])])!.data]).toEqual([1, 0]);
    expect(majorityMask([])).toBeNull();
  });
  it('turns a landscape delivery to portrait in the pipeline (10.1.4)', () => {
    expect(frameGeometry(1920, 1080, 1280, true)).toEqual({ w: 720, h: 1280, rotate: true });
    expect(frameGeometry(1080, 1920, 1920, true)).toEqual({ w: 1080, h: 1920, rotate: false });
    expect(frameGeometry(720, 1280, 1920, true)).toEqual({ w: 720, h: 1280, rotate: false });
  });
});

describe('worker client (10.5)', () => {
  class Port implements WorkerPort {
    onmessage: WorkerPort['onmessage'] = null;
    onerror: WorkerPort['onerror'] = null;
    onmessageerror: WorkerPort['onmessageerror'] = null;
    terminated = false;
    sent: Record<string, unknown>[] = [];
    constructor(private readonly behave: (port: Port, message: Record<string, unknown>) => void) {}
    postMessage(message: unknown) {
      this.sent.push(message as Record<string, unknown>);
      this.behave(this, message as Record<string, unknown>);
    }
    terminate() {
      this.terminated = true;
    }
  }
  const answer = (port: Port, m: Record<string, unknown>) =>
    setTimeout(() => port.onmessage?.({ data: { id: m.id, ok: true, result: 'yes' } }), 0);

  it('answers a call', async () => {
    const client = new WorkerClient(() => new Port(answer));
    expect((await client.call(() => ({ message: { cmd: 'x' } }), 100)).result).toBe('yes');
  });
  it('restarts after a crash and retries once, rebuilding the message', async () => {
    const ports: Port[] = [];
    const restart = vi.fn(async () => {});
    let builds = 0;
    const client = new WorkerClient(() => {
      const port = new Port(
        ports.length ? answer : (p) => setTimeout(() => p.onerror?.(new Event('error')), 0),
      );
      ports.push(port);
      return port;
    }, restart);
    const reply = await client.call(() => ((builds += 1), { message: {} }), 100);
    expect(reply.ok).toBe(true);
    expect(builds).toBe(2);
    expect(restart).toHaveBeenCalledOnce();
    expect(ports[0].terminated).toBe(true);
  });
  it('gives up after the second crash', async () => {
    const client = new WorkerClient(
      () => new Port((p) => setTimeout(() => p.onerror?.(new Event('error')), 0)),
    );
    await expect(client.call(() => ({ message: {} }), 100)).rejects.toBeInstanceOf(WorkerCrash);
  });
  it('a live timeout does not reload the models', async () => {
    const restart = vi.fn(async () => {});
    const client = new WorkerClient(() => new Port(() => {}), restart);
    await expect(client.call(() => ({ message: {} }), 10)).rejects.toBeInstanceOf(WorkerTimeout);
    expect(restart).not.toHaveBeenCalled();
  });
  it('a burst timeout restarts', async () => {
    const restart = vi.fn(async () => {});
    const client = new WorkerClient(() => new Port(() => {}), restart);
    await expect(client.call(() => ({ message: {} }), 10, true)).rejects.toBeInstanceOf(
      WorkerTimeout,
    );
    expect(restart).toHaveBeenCalledOnce();
  });
  it('a worker error is reported as an error', async () => {
    const client = new WorkerClient(
      () =>
        new Port((p, m) =>
          setTimeout(() => p.onmessage?.({ data: { id: m.id, ok: false, error: 'bad' } }), 0),
        ),
    );
    await expect(client.call(() => ({ message: {} }), 100)).rejects.toThrow('bad');
  });
  it('after dispose a call in flight fails at once, no worker restarts, and a late bitmap is closed', async () => {
    const restart = vi.fn(async () => {});
    let made = 0;
    const client = new WorkerClient(() => {
      made += 1;
      return new Port(() => {});
    }, restart);
    const flying = client.call(() => ({ message: {} }), 60_000, true);
    await Promise.resolve();
    await Promise.resolve();
    client.dispose();
    await expect(flying).rejects.toThrow();
    expect(restart).not.toHaveBeenCalled();
    expect(made).toBe(1);

    const close = vi.fn();
    const late = { close } as unknown as Transferable;
    const again = new WorkerClient(() => new Port(() => {}), restart);
    let release: (value: void) => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pending = again.call(async () => {
      await gate;
      return { message: {}, transfer: [late] };
    }, 60_000);
    again.dispose();
    release();
    await expect(pending).rejects.toThrow('worker_disposed');
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('real pipeline with stand-in workers', () => {
  class Bitmap {
    closed = false;
    constructor(
      public width = 720,
      public height = 1280,
    ) {}
    close() {
      this.closed = true;
    }
  }
  let made: Bitmap[] = [];
  const mint = (w = 720, h = 1280) => {
    const bitmap = new Bitmap(w, h);
    made.push(bitmap);
    return bitmap;
  };
  const LANDMARKS = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  const MARKER = {
    corners: [
      [10, 10],
      [110, 10],
      [110, 110],
      [10, 110],
    ],
    image_w: 720,
    image_h: 1280,
    side_px: 100,
    confidence: 1,
  };
  // Stands in for a worker: closes the bitmap it is handed and answers with numbers and a mask.
  const port = (
    kind: 'pose' | 'marker',
    markerResult: typeof MARKER | null = MARKER,
  ): WorkerPort => {
    const self: WorkerPort = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      terminate: () => {},
      postMessage: (message) => {
        const m = message as { id: number; bitmap?: Bitmap };
        m.bitmap?.close();
        const result =
          kind === 'pose'
            ? {
                landmarks: LANDMARKS,
                mask: { width: 2, height: 2, data: new Uint8Array([1, 1, 1, 0]) },
              }
            : {
                marker: markerResult,
                occluded: false,
                luminance: 120,
                sharpness: 300,
                width: 720,
                height: 1280,
              };
        setTimeout(
          () =>
            self.onmessage?.({
              data: { id: m.id, ok: true, result, liveBitmaps: 0, variant: 'lite' },
            }),
          0,
        );
      },
    };
    return self;
  };
  const deps = (over: Partial<RealDeps> = {}): RealDeps => ({
    camera: {
      applied: null,
      grab: async () => (trackFrame('bitmap'), mint() as unknown as ImageBitmap),
      still: async () => null,
    },
    pose: () => port('pose'),
    marker: () => port('marker'),
    memoryGb: 4,
    fullAvailable: async () => false,
    report: () => {},
    ...over,
  });
  const ask = (worker: RealVisionWorker, message: object) =>
    new Promise<VisionReply>((resolve) => {
      worker.onmessage = ({ data }) => resolve(data);
      worker.postMessage({ id: 1, ...message } as never);
    });

  beforeEach(() => {
    made = [];
    resetLedger();
    vi.stubGlobal('createImageBitmap', async (source: Bitmap) => mint(source.width, source.height));
  });
  afterEach(() => vi.unstubAllGlobals());

  // The memory-release test (2.1 invariant 2, milestone M6).
  it('a live sample and a burst close every bitmap, and the counter returns to zero', async () => {
    const worker = new RealVisionWorker(deps());
    await ask(worker, { cmd: 'init', heightMm: 1700 });
    const live = await ask(worker, { cmd: 'live' });
    expect(live.ok).toBe(true);
    const burst = await ask(worker, { cmd: 'burst', view: 'front' });
    expect(burst.ok && burst.frames).toHaveLength(5);
    expect(burst.ok && burst.mask?.data).toBeInstanceOf(Uint8Array);
    expect(made.length).toBeGreaterThan(5);
    expect(made.filter((bitmap) => !bitmap.closed)).toEqual([]);
    expect(liveFrames()).toEqual({ bitmap: 0, mask: 0 });
    worker.terminate();
  });

  it('frames are released when a worker fails mid-burst', async () => {
    const broken: WorkerPort = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      terminate: () => {},
      postMessage: (message) => {
        const m = message as { id: number; cmd: string; bitmap?: Bitmap };
        m.bitmap?.close();
        const data =
          m.cmd === 'init'
            ? { id: m.id, ok: true, result: null }
            : { id: m.id, ok: false, error: 'boom' };
        setTimeout(() => broken.onmessage?.({ data }), 0);
      },
    };
    const worker = new RealVisionWorker(deps({ pose: () => broken }));
    await ask(worker, { cmd: 'init', heightMm: 1700 });
    const reply = await ask(worker, { cmd: 'burst', view: 'side' });
    expect(reply.ok).toBe(false);
    expect(made.filter((bitmap) => !bitmap.closed)).toEqual([]);
    expect(liveFrames().bitmap).toBe(0);
  });

  it('a still is used for marker corners, then closed', async () => {
    const worker = new RealVisionWorker(
      deps({
        camera: {
          applied: null,
          grab: async () => (trackFrame('bitmap'), mint() as unknown as ImageBitmap),
          still: async () => (trackFrame('bitmap'), mint(1440, 2560) as unknown as ImageBitmap),
        },
        marker: () => port('marker', { ...MARKER, image_w: 1440, image_h: 2560, side_px: 200 }),
      }),
    );
    await ask(worker, { cmd: 'init', heightMm: 1700 });
    const reply = await ask(worker, { cmd: 'burst', view: 'front' });
    expect(reply.ok && reply.still?.image_w).toBe(720);
    expect(reply.ok && reply.still?.side_px).toBe(100);
    expect(made.filter((bitmap) => !bitmap.closed)).toEqual([]);
    expect(liveFrames().bitmap).toBe(0);
  });

  it('a floor phone uses the live size for the burst and lets the marker worker go', async () => {
    const edges: number[] = [];
    const terminate = vi.fn();
    const worker = new RealVisionWorker(
      deps({
        memoryGb: 3,
        camera: {
          applied: null,
          still: async () => null,
          grab: async (edge: number) => (
            edges.push(edge),
            trackFrame('bitmap'),
            mint() as unknown as ImageBitmap
          ),
        },
        marker: () => {
          const made = port('marker');
          made.terminate = terminate;
          return made;
        },
      }),
    );
    await ask(worker, { cmd: 'init', heightMm: 1700 });
    await ask(worker, { cmd: 'burst', view: 'front' });
    expect(new Set(edges)).toEqual(new Set([1280]));
    expect(terminate).toHaveBeenCalled();
  });

  it('asks for the full model only where memory allows and the file is cached', async () => {
    const asked: boolean[] = [];
    const pose = (): WorkerPort => {
      const base = port('pose');
      const send = base.postMessage;
      base.postMessage = (message, transfer) => {
        const m = message as { cmd: string; alsoFull?: boolean };
        if (m.cmd === 'init') asked.push(m.alsoFull === true);
        send(message, transfer);
      };
      return base;
    };
    for (const [memoryGb, fullAvailable] of [
      [4, true],
      [3, true],
      [4, false],
    ] as const) {
      const worker = new RealVisionWorker(
        deps({ pose, memoryGb, fullAvailable: async () => fullAvailable }),
      );
      await ask(worker, { cmd: 'init', heightMm: 1700 });
    }
    expect(asked).toEqual([true, false, false]);
  });

  it('a live sample before the models are ready says no person, not a failure', async () => {
    const worker = new RealVisionWorker(deps());
    const reply = await ask(worker, { cmd: 'live' });
    expect(reply.ok && reply.sample?.landmarks).toBeNull();
  });

  it('only numbers and masks come back', async () => {
    const worker = new RealVisionWorker(deps());
    await ask(worker, { cmd: 'init', heightMm: 1700 });
    const seen = (value: unknown): void => {
      expect(value).not.toBeInstanceOf(Bitmap);
      if (value instanceof Uint8Array) return;
      if (value && typeof value === 'object') Object.values(value).forEach(seen);
    };
    seen(await ask(worker, { cmd: 'live' }));
    seen(await ask(worker, { cmd: 'burst', view: 'front' }));
  });
});

describe('burst helpers', () => {
  it('a still of another shape cannot be compared with the frames', () => {
    const still = { corners: [[0, 0]], image_w: 3000, image_h: 4000, side_px: 100, confidence: 1 };
    expect(stillToFrame(still, 1080, 1920)).toBeNull();
  });
  it('boxOf finds the person, or nothing', () => {
    const data = new Uint8Array([0, 0, 0, 1]);
    expect(boxOf({ landmarks: null, mask: { width: 2, height: 2, data } })).toEqual({
      top: 0.5,
      bottom: 1,
      left: 0.5,
      right: 1,
    });
    expect(boxOf({ landmarks: null, mask: null })).toBeNull();
  });
  it('profiles stay empty until M7, and are never made up', () => {
    const front = emptySilhouette('front', 720, 1280) as {
      half_width_mm: unknown[];
      crotch_y_px: unknown;
    };
    expect(front.half_width_mm).toHaveLength(101);
    expect(front.half_width_mm.every((value) => value === null)).toBe(true);
    expect(front.crotch_y_px).toBeNull();
  });

  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  const marker = {
    corners: [
      [10, 10],
      [110, 10],
      [110, 110],
      [10, 110],
    ],
    image_w: 720,
    image_h: 1280,
    side_px: 100,
    confidence: 1,
  };
  const frame = () => ({
    landmarks: lm,
    marker,
    silhouette: emptySilhouette('front', 720, 1280),
  });

  it('reads the top and bottom of the combined mask in frame pixels', () => {
    const mask = {
      width: 4,
      height: 4,
      data: new Uint8Array([0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0]),
    };
    const out = withMaskBounds(frame(), mask, 1280);
    expect(out.silhouette.mask_top_px).toBe(320);
    expect(out.silhouette.mask_bottom_px).toBe(960);
    expect(combineBurst({ frames: [out, out, out], mask })?.mask).toBe(mask);
  });
  it('uses a still that agrees, and ignores one that does not', () => {
    const frames = [frame(), frame(), frame(), frame(), frame()];
    const near = { ...marker, corners: marker.corners.map(([x, y]) => [x + 1, y]), side_px: 101 };
    const far = { ...marker, corners: marker.corners.map(([x, y]) => [x + 50, y]) };
    expect(combineBurst({ frames, still: near })).toMatchObject({
      still_source: 'imagecapture',
      marker: { side_px: 101 },
    });
    expect(combineBurst({ frames, still: far })).toMatchObject({
      still_source: 'canvas',
      marker: { side_px: 100 },
    });
  });
  it('the session holds a mask until release, and never in its views', () => {
    resetLedger();
    const session = new CaptureSession();
    session.holdMask('front', { width: 1, height: 1, data: new Uint8Array([1]) });
    expect(liveFrames().mask).toBe(1);
    expect(session.masks.front).toBeDefined();
    expect(JSON.stringify(session.views)).not.toContain('data');
    session.releaseMasks();
    expect(session.masks).toEqual({});
    expect(liveFrames().mask).toBe(0);
    session.holdMask('side', { width: 1, height: 1, data: new Uint8Array([1]) });
    session.clear();
    expect(liveFrames().mask).toBe(0);
  });
});

describe('which vision a build uses', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  it('dev and mock builds replay fake vision unless real is asked for', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => JSON.stringify({ real: false }) });
    const { createVisionClient } = await import('../../src/vision/client');
    expect((await createVisionClient()).real).toBe(false);
  });
  it('the tuning switch selects the real pipeline in a mock build', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => JSON.stringify({ real: true }) });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', {});
    const { createVisionClient } = await import('../../src/vision/client');
    const made = await createVisionClient();
    expect(made.real).toBe(true);
    made.client.terminate();
  });
});
