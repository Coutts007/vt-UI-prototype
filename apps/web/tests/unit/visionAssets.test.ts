// The self-hosted vision files match their manifest, and fit the first-load budget (spec 18).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CaptureSession } from '../../src/capture/session';
import * as paths from '../../src/vision/paths';
import type { VisionManifest } from '../../src/vision/download';

const PUBLIC = resolve(import.meta.dirname, '../../public');
const manifest = JSON.parse(
  readFileSync(resolve(PUBLIC, 'vision-manifest.json'), 'utf8'),
) as VisionManifest;
const MB = 1024 * 1024;

describe('vision files', () => {
  it.each(manifest.files.map((file) => [file.url, file] as const))(
    '%s matches its checksum and size',
    (_url, file) => {
      const bytes = readFileSync(PUBLIC + file.url);
      expect(bytes.length).toBe(file.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    },
  );
  it('every path the code asks for is in the manifest', () => {
    const urls = manifest.files.map((file) => file.url);
    for (const url of [
      paths.MODEL_URLS.lite,
      paths.MODEL_URLS.full,
      paths.WASM_LOADER_URL,
      paths.WASM_BINARY_URL,
      paths.OPENCV_URL,
    ]) {
      expect(urls).toContain(url);
    }
  });
  it('the models are the pinned official files (recorded in docs/opencv-build.md)', () => {
    const sha = (url: string) => manifest.files.find((file) => file.url === url)?.sha256;
    expect(sha(paths.MODEL_URLS.lite)).toBe(
      '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
    );
    expect(sha(paths.MODEL_URLS.full)).toBe(
      '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1',
    );
  });
  it('first load stays within 30 MB with the full model too', () => {
    const total = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
    expect(total / MB).toBeLessThan(30);
  });
  it('the Apache licence travels with each vision folder', () => {
    for (const dir of ['models', 'wasm', 'opencv']) {
      expect(readFileSync(resolve(PUBLIC, dir, 'LICENSE'), 'utf8')).toContain('Apache License');
    }
  });
});

describe('golden rules in the vision code', () => {
  const SRC = resolve(import.meta.dirname, '../../src/vision');
  const files = readdirSync(SRC).filter((name) => /\.ts$/.test(name));
  const code = (name: string) => readFileSync(resolve(SRC, name), 'utf8');

  it('no third-party origin in the vision code', () => {
    for (const name of files) expect(code(name), name).not.toMatch(/https?:\/\//);
  });
  it('the vision files themselves name no CDN to load from', () => {
    const loader = readFileSync(PUBLIC + paths.WASM_LOADER_URL, 'utf8');
    expect(loader).not.toMatch(/(cdn\.jsdelivr|unpkg\.com|storage\.googleapis)/);
    if (existsSync(PUBLIC + paths.OPENCV_URL)) {
      expect(readFileSync(PUBLIC + paths.OPENCV_URL, 'utf8').slice(0, 200_000)).not.toMatch(
        /(cdn\.jsdelivr|unpkg\.com)/,
      );
    }
  });
  it('workers post numbers and masks only: no toBlob, data URL or image posted back', () => {
    for (const name of files.filter((n) => n.endsWith('.worker.ts'))) {
      const text = code(name);
      expect(text, name).not.toMatch(
        /toBlob|convertToBlob|toDataURL|transferToImageBitmap|indexedDB|localStorage|caches\.open/,
      );
      expect(text, name).not.toMatch(/postMessage\([^)]*bitmap/);
    }
  });
  it('the session keeps masks away from the stored views', () => {
    const session = new CaptureSession();
    session.holdMask('front', { width: 1, height: 1, data: new Uint8Array([1]) });
    expect(Object.keys(session.views)).toEqual([]);
    session.clear();
  });
});
