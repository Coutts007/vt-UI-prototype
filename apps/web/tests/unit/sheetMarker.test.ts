// The measuring sheet's marker, read by the real detector from the generated PDF itself (D15, D36).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { ArucoFinder, OpenCv, readyOpenCv } from '../../src/vision/arucoDetect';

const PUBLIC = resolve(import.meta.dirname, '../../public');
const DPI_SCALE = 3; // Pixels per PDF point.

/** Rasterises the filled rectangles of the sheet's plain vector PDF, as a printer would. */
function rasterise(pdf: string): { gray: Uint8Array; width: number; height: number } {
  const box = /\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/.exec(pdf);
  if (!box) throw new Error('no MediaBox');
  const width = Math.ceil(Number(box[1]) * DPI_SCALE);
  const height = Math.ceil(Number(box[2]) * DPI_SCALE);
  const gray = new Uint8Array(width * height).fill(255);
  let fill = 0;
  let filled = 0;
  for (const line of pdf.split('\n')) {
    const colour = /^([\d.]+) [\d.]+ [\d.]+ rg/.exec(line);
    if (colour) fill = Number(colour[1]) * 255;
    const rect = /^(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+) re f/.exec(line);
    if (!rect) continue;
    const [x, y, w, h] = rect.slice(1).map((n) => Number(n) * DPI_SCALE);
    for (let row = Math.round(height - y - h); row < Math.round(height - y); row++) {
      gray.fill(fill, row * width + Math.round(x), row * width + Math.round(x + w));
    }
    filled += 1;
  }
  expect(filled).toBeGreaterThan(5);
  return { gray, width, height };
}

/** The same page, as a phone at about 2 m would see it: smaller, on a grey wall. */
function shrink(page: { gray: Uint8Array; width: number; height: number }, by: number) {
  const width = Math.floor(page.width / by);
  const height = Math.floor(page.height / by);
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) gray[y * width + x] = page.gray[y * by * page.width + x * by];
  }
  return { gray, width, height };
}

describe('generated measuring sheet', () => {
  let finder: ArucoFinder;
  let page: ReturnType<typeof rasterise>;

  beforeAll(async () => {
    const sandbox: Record<string, unknown> = {
      console,
      WebAssembly,
      performance,
      setTimeout,
      clearTimeout,
      TextDecoder,
      Uint8Array,
      atob,
      URL,
    };
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    runInNewContext(readFileSync(resolve(PUBLIC, 'opencv/opencv.js'), 'utf8'), sandbox);
    const cv: OpenCv = await readyOpenCv(sandbox.cv);
    finder = new ArucoFinder(cv);
    page = rasterise(readFileSync(resolve(PUBLIC, 'vt-measuring-sheet-A4.pdf'), 'latin1'));
  }, 60_000);

  it('the detector reads DICT_4X4_50 id 0 from the page', () => {
    const { found } = finder.find(page.gray, page.width, page.height);
    expect(found.map((f) => f.id)).toEqual([0]);
  });

  it('the marker measures 150 mm on the page, with its corners in order', () => {
    const { marker } = finder.findSheet(page.gray, page.width, page.height, 0);
    expect(marker).not.toBeNull();
    const mm = (marker!.side_px / DPI_SCALE) * (25.4 / 72);
    expect(mm).toBeGreaterThan(149);
    expect(mm).toBeLessThan(151);
    const [tl, tr, br, bl] = marker!.corners;
    expect(tl[0]).toBeLessThan(tr[0]);
    expect(tl[1]).toBeLessThan(bl[1]);
    expect(br[0]).toBeGreaterThan(bl[0]);
  });

  it('it is still read at a size a phone sees at 2 m', () => {
    const small = shrink(page, 12);
    const { marker } = finder.findSheet(small.gray, small.width, small.height, 0);
    expect(marker).not.toBeNull();
  });

  it('a page with the marker turned upside down still reads as id 0 (it is not symmetric)', () => {
    const flipped = page.gray.slice().reverse();
    expect(finder.find(flipped, page.width, page.height).found.map((f) => f.id)).toEqual([0]);
  });

  it('a blank page has no marker', () => {
    const blank = new Uint8Array(400 * 400).fill(200);
    expect(finder.findSheet(blank, 400, 400, 0).marker).toBeNull();
  });
});
