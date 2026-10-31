import React from 'react';

// DICT_4X4_50 id 0, row by row. The same bits as scripts/make-sheet.mjs (D15).
const BITS = ['1011', '0101', '0011', '0010'];

export const ArucoMarker: React.FC<{ label: string; size?: number }> = ({ label, size = 128 }) => (
  <svg viewBox="0 0 6 6" width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges">
    <rect width="6" height="6" fill="#000" />
    {BITS.flatMap((row, y) =>
      [...row].map((bit, x) =>
        bit === '1' ? <rect key={`${x}-${y}`} x={x + 1} y={y + 1} width="1" height="1" fill="#fff" /> : null,
      ),
    )}
  </svg>
);
