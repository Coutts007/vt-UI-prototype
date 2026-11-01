#!/usr/bin/env node
// Writes apps/web/public/vision-manifest.json: every self-hosted vision file, its size and checksum.
// Run after changing a model, WASM or OpenCV file. A unit test fails if this is out of date.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const PUBLIC = 'apps/web/public';
const FILES = [
  ['/models/pose_landmarker_lite.task', 'core'],
  ['/models/pose_landmarker_full.task', 'full'],
  ['/wasm/vision_wasm_internal.js', 'core'],
  ['/wasm/vision_wasm_internal.wasm', 'core'],
  ['/opencv/opencv.js', 'core'],
];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = FILES.map(([url, tier]) => {
  const bytes = readFileSync(PUBLIC + url);
  return { url, bytes: bytes.length, sha256: sha(bytes), tier };
});
const version = sha(files.map((file) => file.sha256).join()).slice(0, 12);
writeFileSync(`${PUBLIC}/vision-manifest.json`, `${JSON.stringify({ version, files }, null, 2)}\n`);
console.log(`vision manifest ${version}: ${files.length} files`);
