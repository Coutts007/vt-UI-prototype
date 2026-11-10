#!/usr/bin/env node
// Serves a web build the way Caddy does for Lighthouse (frontend-spec 18, M16): static files
// with gzip, the shell for every deep link, no-cache on the shell. No dependency beyond Node.
// Usage: node scripts/serve-dist.mjs [dist dir] [port]
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createGzip } from 'node:zlib';

const dist = resolve(process.argv[2] ?? 'apps/web/dist');
const port = Number(process.argv[3] ?? process.env.PORT ?? 4180);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.task': 'application/octet-stream',
  '.tflite': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|manifest|wasm))/;
// As the Caddyfile: the shell and the worker are checked on every visit, hashed assets are not.
const FRESH = new Set(['/', '/index.html', '/sw.js', '/manifest.webmanifest']);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }
  let path = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  let file = join(dist, path);
  const isFile = existsSync(file) && statSync(file).isFile();
  if (!isFile) {
    path = '/index.html';
    file = join(dist, 'index.html');
  }
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    'Cache-Control':
      FRESH.has(path) || path === '/index.html' ? 'no-cache' : 'public, max-age=31536000',
    Vary: 'Accept-Encoding',
  };
  const gzip = COMPRESSIBLE.test(type) && /\bgzip\b/.test(request.headers['accept-encoding'] ?? '');
  if (gzip) headers['Content-Encoding'] = 'gzip';
  response.writeHead(200, headers);
  const stream = createReadStream(file);
  if (gzip) stream.pipe(createGzip()).pipe(response);
  else stream.pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`serving ${dist} at http://127.0.0.1:${port}`);
});
