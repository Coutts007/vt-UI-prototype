import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  downloadVision,
  filesFor,
  missingFiles,
  visionCacheName,
  VisionManifest,
} from '../../src/vision/download';

const body = (bytes: Uint8Array, status = 200) =>
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    { status },
  );

const A = new Uint8Array([1, 2, 3, 4]);
const B = new Uint8Array([5, 6]);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const manifest: VisionManifest = {
  version: 'v1',
  files: [
    { url: '/a', bytes: 4, sha256: sha(A), tier: 'core' },
    { url: '/b', bytes: 2, sha256: sha(B), tier: 'full' },
  ],
};

class FakeCache {
  store = new Map<string, Response>();
  async match(url: string) {
    return this.store.get(url);
  }
  async put(url: string, response: Response) {
    this.store.set(url, response);
  }
}

let cache: FakeCache;
let opened: string[];
beforeEach(() => {
  cache = new FakeCache();
  opened = [];
  vi.stubGlobal('caches', {
    open: async (name: string) => (opened.push(name), cache),
  });
});
afterEach(() => vi.unstubAllGlobals());

const serving = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) =>
      url === '/vision-manifest.json' ? new Response(JSON.stringify(manifest)) : handler(url, init),
    ),
  );

describe('model download (9.6)', () => {
  it('floor phones skip the full model', () => {
    expect(filesFor(manifest, 3).map((f) => f.url)).toEqual(['/a']);
    expect(filesFor(manifest, 4).map((f) => f.url)).toEqual(['/a', '/b']);
    expect(filesFor(manifest, null).map((f) => f.url)).toEqual(['/a', '/b']);
  });
  it('reports real progress and stores the files in the versioned cache', async () => {
    serving((url) => body(url === '/a' ? A : B));
    const seen: number[] = [];
    await downloadVision(4, ({ doneBytes }) => seen.push(doneBytes));
    expect(seen.at(-1)).toBe(6);
    expect(seen).toContain(4);
    expect(opened[0]).toBe(visionCacheName('v1'));
    expect(await missingFiles(manifest, 4)).toEqual([]);
  });
  it('does not fetch a file it already has', async () => {
    cache.store.set('/a', new Response(A));
    serving((url) => body(url === '/a' ? A : B));
    await downloadVision(4, () => {});
    expect(vi.mocked(fetch).mock.calls.map((c) => c[0])).not.toContain('/a');
  });
  it('resumes with a Range request after a broken connection', async () => {
    let calls = 0;
    let sent = false;
    serving((_url, init) => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(A.slice(0, 2));
            },
            pull(controller) {
              if (sent) controller.error(new Error('lost'));
              sent = true;
            },
          }),
        );
      }
      expect((init?.headers as Record<string, string>).Range).toBe('bytes=2-');
      return body(A.slice(2), 206);
    });
    await downloadVision(3, () => {});
    expect(calls).toBe(2);
    expect(cache.store.has('/a')).toBe(true);
  });
  it('rejects a corrupted file and stores nothing', async () => {
    serving(() => body(new Uint8Array([9, 9, 9, 9])));
    await expect(downloadVision(3, () => {})).rejects.toThrow('checksum_mismatch');
    expect(cache.store.size).toBe(0);
  });
  it('fails after three tries', async () => {
    serving(() => new Response('', { status: 503 }));
    await expect(downloadVision(3, () => {})).rejects.toThrow();
    expect(vi.mocked(fetch).mock.calls.filter((c) => c[0] === '/a')).toHaveLength(3);
  });
});
