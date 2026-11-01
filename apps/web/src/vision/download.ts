// The first-time download of models and WASM (9.6). Loaded on demand. Files are checked against
// the manifest and go to Cache Storage, where the service worker serves them offline.
import { CAPTURE_CONFIG } from '../capture/config';
import { MANIFEST_URL } from './paths';

export interface VisionFile {
  url: string;
  bytes: number;
  sha256: string;
  tier: 'core' | 'full';
}
export interface VisionManifest {
  version: string;
  files: VisionFile[];
}
export interface Progress {
  doneBytes: number;
  totalBytes: number;
}

const MAX_TRIES = 3;
export const visionCacheName = (version: string) => `vt-vision-${version}`;

export async function fetchManifest(): Promise<VisionManifest> {
  const response = await fetch(MANIFEST_URL);
  if (!response.ok) throw new Error('manifest_missing');
  return (await response.json()) as VisionManifest;
}

/** Floor phones skip the full model, because they use the lite model for the burst too (10.2). */
export function filesFor(manifest: VisionManifest, memoryGb: number | null): VisionFile[] {
  const big = memoryGb === null || memoryGb >= CAPTURE_CONFIG.frames.fullModelMinGb;
  return manifest.files.filter((file) => file.tier === 'core' || big);
}

export const sumBytes = (files: VisionFile[]) => files.reduce((sum, file) => sum + file.bytes, 0);

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** One file, resuming from the bytes already here when the server allows it (9.6). */
async function fetchFile(file: VisionFile, onBytes: (n: number) => void): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let have = 0;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    try {
      const response = await fetch(file.url, have ? { headers: { Range: `bytes=${have}-` } } : undefined);
      if (!response.ok) throw new Error('download_failed');
      if (have && response.status !== 206) {
        onBytes(-have); // The server sent the whole file again.
        parts.length = 0;
        have = 0;
      }
      if (!response.body) throw new Error('no_body');
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        have += value.length;
        onBytes(value.length);
      }
      const whole = new Uint8Array(have);
      let at = 0;
      for (const part of parts) {
        whole.set(part, at);
        at += part.length;
      }
      const digest = hex(await crypto.subtle.digest('SHA-256', whole));
      if (digest !== file.sha256) {
        onBytes(-have);
        parts.length = 0;
        have = 0;
        throw new Error('checksum_mismatch');
      }
      return whole;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('download_failed');
}

/** Which files are missing. Offline this needs only the manifest and the cache. */
export async function missingFiles(manifest: VisionManifest, memoryGb: number | null): Promise<VisionFile[]> {
  const cache = await caches.open(visionCacheName(manifest.version));
  const wanted = filesFor(manifest, memoryGb);
  const found = await Promise.all(wanted.map((file) => cache.match(file.url)));
  return wanted.filter((_, i) => !found[i]);
}

/** Fetches what is missing and reports progress. Files already cached are not fetched again. */
export async function downloadVision(memoryGb: number | null, onProgress: (progress: Progress) => void): Promise<void> {
  const manifest = await fetchManifest();
  const cache = await caches.open(visionCacheName(manifest.version));
  const wanted = filesFor(manifest, memoryGb);
  const missing = await missingFiles(manifest, memoryGb);
  const totalBytes = sumBytes(wanted);
  let doneBytes = totalBytes - sumBytes(missing);
  onProgress({ doneBytes, totalBytes });
  for (const file of missing) {
    const body = await fetchFile(file, (n) => {
      doneBytes += n;
      onProgress({ doneBytes, totalBytes });
    });
    await cache.put(
      file.url,
      new Response(body as BlobPart, {
        headers: { 'Content-Type': file.url.endsWith('.js') ? 'text/javascript' : file.url.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' },
      }),
    );
  }
}
