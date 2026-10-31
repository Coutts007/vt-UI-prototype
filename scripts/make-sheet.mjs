#!/usr/bin/env node
// Writes the A4 measuring sheet as a plain vector PDF with no dependencies (frontend-spec 9.5, D15).
import { writeFileSync } from 'node:fs';

const MM = 72 / 25.4;
const PAGE_W = 210 * MM;
const PAGE_H = 297 * MM;
// DICT_4X4_50 id 0, row by row. 1 is a white cell.
const BITS = ['1011', '0101', '0011', '0010'];
const MARKER = 150 * MM;
const CELL = MARKER / 6;
const left = (PAGE_W - MARKER) / 2;
const top = PAGE_H - 45 * MM;
const bottom = top - MARKER;
const n = (value) => value.toFixed(3);
const out = [];

const text = (x, y, size, words) =>
  out.push(`BT /F1 ${size} Tf ${n(x)} ${n(y)} Td (${words}) Tj ET`);

text(
  left,
  PAGE_H - 20 * MM,
  13,
  'Virtual Tailor measuring sheet - hold flat, square facing camera',
);
text(
  left,
  PAGE_H - 28 * MM,
  10,
  'Print at 100% / Actual size, not Fit to page. Do not fold through the black square.',
);

out.push('0 0 0 rg', `${n(left)} ${n(bottom)} ${n(MARKER)} ${n(MARKER)} re f`, '1 1 1 rg');
BITS.forEach((row, y) => {
  [...row].forEach((bit, x) => {
    if (bit !== '1') return;
    const cellX = left + (x + 1) * CELL;
    const cellY = top - (y + 2) * CELL;
    out.push(`${n(cellX)} ${n(cellY)} ${n(CELL)} ${n(CELL)} re f`);
  });
});
out.push('0 0 0 rg 0 0 0 RG');

const lineY = bottom - 20 * MM;
const lineX = (PAGE_W - 100 * MM) / 2;
out.push('1 w', `${n(lineX)} ${n(lineY)} m ${n(lineX + 100 * MM)} ${n(lineY)} l S`);
for (const x of [lineX, lineX + 100 * MM]) {
  out.push(`${n(x)} ${n(lineY - 3 * MM)} m ${n(x)} ${n(lineY + 3 * MM)} l S`);
}
text(lineX, lineY - 8 * MM, 10, 'Print check: this line must be exactly 10 cm.');

const cardW = 85.6 * MM;
const cardH = 54 * MM;
const cardX = (PAGE_W - cardW) / 2;
const cardY = lineY - 16 * MM - cardH;
out.push(`${n(cardX)} ${n(cardY)} ${n(cardW)} ${n(cardH)} re S`);
text(cardX + 8 * MM, cardY + cardH / 2, 10, 'A bank card must fit exactly in this box.');

const stream = out.join('\n');
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(PAGE_W)} ${n(PAGE_H)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];
let pdf = '%PDF-1.4\n';
const offsets = objects.map((body, index) => {
  const at = Buffer.byteLength(pdf);
  pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  return at;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const at of offsets) pdf += `${String(at).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync('apps/web/public/vt-measuring-sheet-A4.pdf', pdf);
