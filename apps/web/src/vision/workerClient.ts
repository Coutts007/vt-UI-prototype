// Promise wrapper for a vision worker: timeouts, crash detection, restart, one retry (10.5).
export class WorkerCrash extends Error {}
export class WorkerTimeout extends Error {}
export class WorkerDisposed extends Error {}

export interface WorkerPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
}

interface Pending {
  resolve: (reply: Reply) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
export type Reply = { id: number; ok: boolean; error?: string; result?: unknown; liveBitmaps?: number; [key: string]: unknown };
type Built = { message: Record<string, unknown>; transfer?: Transferable[] };
export type Build = () => Built | Promise<Built>;

export class WorkerClient {
  private worker: WorkerPort | null = null;
  private pending = new Map<number, Pending>();
  private next = 1;
  /** What the worker last said it still holds. Only the dev counter reads this. */
  liveBitmaps = 0;
  /** Set by dispose(): the capture is over, so nothing may bring the worker back. */
  private disposed = false;

  constructor(
    private readonly make: () => WorkerPort,
    private readonly onRestart: () => Promise<void> = async () => {},
  ) {}

  private port(): WorkerPort {
    if (this.worker) return this.worker;
    const worker = this.make();
    worker.onmessage = ({ data }) => {
      const reply = data as Reply;
      this.liveBitmaps = reply.liveBitmaps ?? 0;
      const waiting = this.pending.get(reply.id);
      if (!waiting) return;
      this.pending.delete(reply.id);
      clearTimeout(waiting.timer);
      waiting.resolve(reply);
    };
    worker.onerror = () => this.crashed();
    worker.onmessageerror = () => this.crashed();
    this.worker = worker;
    return worker;
  }

  private crashed(): void {
    this.worker?.terminate();
    this.worker = null;
    this.liveBitmaps = 0;
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(new WorkerCrash('worker_crash'));
    }
    this.pending.clear();
  }

  private async once(build: Build, timeoutMs: number): Promise<Reply> {
    if (this.disposed) throw new WorkerDisposed('worker_disposed');
    const id = this.next++;
    const { message, transfer } = await build();
    if (this.disposed) {
      // A bitmap made for this call was never handed over, so close it here.
      (transfer ?? []).forEach((item) => (item as { close?: () => void }).close?.());
      throw new WorkerDisposed('worker_disposed');
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new WorkerTimeout('worker_timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.port().postMessage({ id, ...message }, transfer ?? []);
    });
  }

  /**
   * One call. After a crash, or a timeout when `restartOnTimeout` is set, the worker restarts and the
   * call runs once more. `build` runs again for that, because a transferred bitmap is gone.
   */
  async call(build: Build, timeoutMs: number, restartOnTimeout = false): Promise<Reply> {
    let reply: Reply;
    try {
      reply = await this.once(build, timeoutMs);
    } catch (error) {
      if (this.disposed || error instanceof WorkerDisposed) throw error;
      if (error instanceof WorkerTimeout && !restartOnTimeout) throw error;
      this.crashed();
      await this.onRestart();
      reply = await this.once(build, timeoutMs);
    }
    if (!reply.ok) throw new Error(reply.error ?? 'worker_error');
    return reply;
  }

  /** Frees the worker's memory. The next call starts a new worker. */
  terminate(): void {
    this.crashed();
  }

  /** Ends this client for good. Calls in flight fail at once and no worker restarts. */
  dispose(): void {
    this.disposed = true;
    this.crashed();
  }
}
