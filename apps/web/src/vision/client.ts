// Promise wrapper around a vision worker (frontend-spec 10.5).
import { CAPTURE_CONFIG } from '../capture/config';
import type { BurstFrame, VisionReply, VisionRequest, VisionSample, View, WorkerLike } from './types';

type Pending = { resolve: (reply: VisionReply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type Body<C extends VisionRequest['cmd']> = Omit<Extract<VisionRequest, { cmd: C }>, 'id'>;

export class VisionClient {
  private next = 1;
  private pending = new Map<number, Pending>();

  constructor(private readonly worker: WorkerLike) {
    worker.onmessage = ({ data }) => {
      const waiting = this.pending.get(data.id);
      if (!waiting) return;
      this.pending.delete(data.id);
      clearTimeout(waiting.timer);
      waiting.resolve(data);
    };
  }

  private call<C extends VisionRequest['cmd']>(body: Body<C>, timeoutMs: number): Promise<VisionReply> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('vision_timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, ...body } as VisionRequest);
    });
  }

  private async expect<C extends VisionRequest['cmd']>(body: Body<C>, timeoutMs: number) {
    const reply = await this.call(body, timeoutMs);
    if (!reply.ok) throw new Error(reply.error);
    return reply;
  }

  init(heightMm: number): Promise<unknown> {
    return this.expect<'init'>({ cmd: 'init', heightMm }, CAPTURE_CONFIG.timing.burstTimeoutMs);
  }

  reset(view: View): Promise<unknown> {
    return this.expect<'reset'>({ cmd: 'reset', view }, CAPTURE_CONFIG.timing.liveTimeoutMs);
  }

  async live(): Promise<VisionSample> {
    const reply = await this.expect<'live'>({ cmd: 'live' }, CAPTURE_CONFIG.timing.liveTimeoutMs);
    return (reply as { sample: VisionSample }).sample;
  }

  async burst(view: View): Promise<BurstFrame[]> {
    const reply = await this.expect<'burst'>({ cmd: 'burst', view }, CAPTURE_CONFIG.timing.burstTimeoutMs);
    return (reply as { frames: BurstFrame[] }).frames;
  }

  compute(): Promise<unknown> {
    return this.expect<'compute'>({ cmd: 'compute' }, CAPTURE_CONFIG.timing.burstTimeoutMs);
  }

  terminate(): void {
    for (const waiting of this.pending.values()) clearTimeout(waiting.timer);
    this.pending.clear();
    this.worker.terminate();
  }
}

export const FAKE_VISION_KEY = 'vt_fake_vision';

const fakeBursts = { front: 0, side: 0 };

/** Fake vision exists only in dev and mock builds. A production build has none until M6. */
export async function createVisionClient(): Promise<{ client: VisionClient; speed: number } | null> {
  if (!import.meta.env.DEV && import.meta.env.MODE !== 'mock') return null;
  const { FakeVisionWorker, readFakeOptions } = await import('./fakeVision');
  const options = readFakeOptions();
  return { client: new VisionClient(new FakeVisionWorker(options, fakeBursts)), speed: options.speed };
}
