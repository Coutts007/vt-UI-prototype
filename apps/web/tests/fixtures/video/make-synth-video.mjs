#!/usr/bin/env node
/* global Buffer, process, console */
// Draws a synthetic cartoon figure holding the measuring-sheet marker into a .y4m for Chromium's fake
// camera. Entirely generated: no photo and no real person. The .y4m is not committed.
// usage: make-synth-video.mjs <out dir>
import { mkdirSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';

const W = 720;
const H = 1280;
const BITS = ['1011', '0101', '0011', '0010']; // DICT_4X4_50 id 0, as in scripts/make-sheet.mjs.

function canvas() {
  const rgb = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const wall = y < H * 0.86;
      const shade = wall ? 205 - (y / H) * 20 : 120;
      const i = (y * W + x) * 3;
      rgb[i] = shade;
      rgb[i + 1] = shade - 4;
      rgb[i + 2] = shade - 12;
    }
  }
  return rgb;
}
const put = (rgb, x, y, c) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  rgb[i] = c[0];
  rgb[i + 1] = c[1];
  rgb[i + 2] = c[2];
};
function ellipse(rgb, cx, cy, rx, ry, c, light = 0.25) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      const f = 1 - light * (dx * dx);
      put(
        rgb,
        x,
        y,
        c.map((v) => v * f),
      );
    }
  }
}
/** A limb: a tapered capsule with rounded shading across it. */
function limb(rgb, x0, y0, x1, y1, r0, r1, c) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const r = Math.max(r0, r1);
  for (let y = Math.floor(Math.min(y0, y1) - r); y <= Math.max(y0, y1) + r; y++) {
    for (let x = Math.floor(Math.min(x0, x1) - r); x <= Math.max(x0, x1) + r; x++) {
      const t = Math.max(
        0,
        Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / (len * len)),
      );
      const d = Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0)));
      const radius = r0 + t * (r1 - r0);
      if (d > radius) continue;
      const f = 1 - 0.35 * (d / radius) ** 2;
      put(
        rgb,
        x,
        y,
        c.map((v) => v * f),
      );
    }
  }
}
function rect(rgb, x0, y0, w, h, c) {
  for (let y = Math.round(y0); y < Math.round(y0 + h); y++) {
    for (let x = Math.round(x0); x < Math.round(x0 + w); x++) put(rgb, x, y, c);
  }
}

const SKIN = [150, 105, 80];
const SHIRT = [45, 80, 130];
const TROUSERS = [50, 50, 60];
const SHOE = [25, 22, 22];
const HAIR = [20, 16, 14];

function head(rgb, cx, cy, u, side) {
  ellipse(rgb, cx, cy - u * 0.04, u * 0.36, u * 0.46, HAIR, 0.1);
  limb(rgb, cx, cy + u * 0.3, cx, cy + u * 0.62, u * 0.17, u * 0.19, SKIN);
  ellipse(rgb, cx, cy + u * 0.03, u * 0.32, u * 0.42, SKIN);
  const look = side ? u * 0.2 : 0;
  for (const dx of side ? [0.1] : [-0.13, 0.13]) {
    const ex = cx + look + dx * u;
    ellipse(rgb, ex, cy - u * 0.02, u * 0.075, u * 0.045, [240, 240, 240], 0);
    ellipse(rgb, ex, cy - u * 0.02, u * 0.035, u * 0.04, [20, 15, 15], 0);
    ellipse(rgb, ex, cy - u * 0.1, u * 0.085, u * 0.018, HAIR, 0);
  }
  ellipse(
    rgb,
    cx + look * 1.3,
    cy + u * 0.1,
    u * 0.04,
    u * 0.06,
    SKIN.map((v) => v * 0.8),
    0,
  );
  ellipse(rgb, cx + look, cy + u * 0.23, u * 0.1, u * 0.025, [100, 45, 45], 0);
}

function marker(rgb, cx, cy, side) {
  const paper = side * 1.5;
  rect(rgb, cx - paper / 2, cy - paper / 2, paper, paper, [245, 245, 245]);
  const cell = side / 6;
  const left = cx - side / 2;
  const top = cy - side / 2;
  rect(rgb, left, top, side, side, [0, 0, 0]);
  BITS.forEach((row, r) =>
    [...row].forEach((bit, c) => {
      if (bit === '1')
        rect(rgb, left + (c + 1) * cell, top + (r + 1) * cell, cell, cell, [255, 255, 255]);
    }),
  );
}

/** Front view. Person about 53% of the frame, one hand holding the sheet on the chest (A14). */
function front() {
  const rgb = canvas();
  const c = W / 2;
  const top = H * 0.2;
  const P = H * 0.56; // Person height.
  const y = (r) => top + r * P;
  const u = P / 7.5; // Head unit.
  // Legs.
  limb(rgb, c - u * 0.45, y(0.52), c - u * 0.5, y(0.74), u * 0.42, u * 0.28, TROUSERS);
  limb(rgb, c - u * 0.5, y(0.74), c - u * 0.5, y(0.95), u * 0.28, u * 0.18, TROUSERS);
  limb(rgb, c + u * 0.45, y(0.52), c + u * 0.5, y(0.74), u * 0.42, u * 0.28, TROUSERS);
  limb(rgb, c + u * 0.5, y(0.74), c + u * 0.5, y(0.95), u * 0.28, u * 0.18, TROUSERS);
  ellipse(rgb, c - u * 0.52, y(0.975), u * 0.3, u * 0.14, SHOE);
  ellipse(rgb, c + u * 0.52, y(0.975), u * 0.3, u * 0.14, SHOE);
  // Torso.
  for (let row = y(0.17); row < y(0.55); row++) {
    const t = (row - y(0.17)) / (y(0.55) - y(0.17));
    const half = u * (0.92 - 0.3 * Math.sin(t * Math.PI) + 0.05 * t);
    const color = t > 0.92 ? TROUSERS : SHIRT;
    for (let col = Math.round(c - half); col <= c + half; col++) {
      const f = 1 - 0.3 * ((col - c) / half) ** 2;
      put(
        rgb,
        col,
        Math.round(row),
        color.map((v) => v * f),
      );
    }
  }
  // Free arm, on the picture's right, held clear of the body.
  limb(rgb, c + u * 0.95, y(0.2), c + u * 1.5, y(0.36), u * 0.2, u * 0.16, SHIRT);
  limb(rgb, c + u * 1.5, y(0.36), c + u * 1.85, y(0.5), u * 0.16, u * 0.12, SKIN);
  ellipse(rgb, c + u * 1.9, y(0.525), u * 0.14, u * 0.18, SKIN);
  // Head.
  head(rgb, c, y(0.075), u, false);
  // The sheet on the chest. 150 mm on a 1700 mm person.
  const side = P * (150 / 1700);
  marker(rgb, c, y(0.31), side);
  // Holding arm, bent, hand at the sheet's lower edge so the square stays clear.
  limb(rgb, c - u * 0.95, y(0.2), c - u * 1.3, y(0.36), u * 0.2, u * 0.16, SHIRT);
  limb(rgb, c - u * 1.3, y(0.36), c - side * 0.8, y(0.41), u * 0.16, u * 0.12, SKIN);
  ellipse(rgb, c - side * 0.72, y(0.41), u * 0.14, u * 0.12, SKIN);
  return rgb;
}

function toY4mFrame(rgb, seed) {
  const y = Buffer.alloc(W * H);
  const u = Buffer.alloc((W / 2) * (H / 2));
  const v = Buffer.alloc((W / 2) * (H / 2));
  let state = seed;
  const noise = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 24) / 255 - 0.5;
  };
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const i = (row * W + col) * 3;
      const [r, g, b] = [rgb[i], rgb[i + 1], rgb[i + 2]];
      // A little sensor noise, so the frame is not unnaturally clean.
      const luma = 0.257 * r + 0.504 * g + 0.098 * b + 16 + noise() * 6;
      y[row * W + col] = Math.max(0, Math.min(255, luma));
      if (row % 2 === 0 && col % 2 === 0) {
        const c = (row / 2) * (W / 2) + col / 2;
        u[c] = -0.148 * r - 0.291 * g + 0.439 * b + 128;
        v[c] = 0.439 * r - 0.368 * g - 0.071 * b + 128;
      }
    }
  }
  return [y, u, v];
}

function write(path, rgb) {
  const fd = openSync(path, 'w');
  writeSync(fd, `YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420\n`);
  for (let frame = 0; frame < 4; frame++) {
    writeSync(fd, 'FRAME\n');
    for (const plane of toY4mFrame(rgb, frame * 7 + 1)) writeSync(fd, plane);
  }
  closeSync(fd);
}

const out = process.argv[2];
mkdirSync(out, { recursive: true });
write(join(out, 'synth-front.y4m'), front());
console.log(`wrote ${out}/synth-front.y4m`);
