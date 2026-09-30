import type { Rect } from './geometry';
import type { GridFrame } from './raster';

// Free-space shapes of the skeleton (GDD §7 steps 7–8). The level's open
// space is their union; walls are where the union field crosses zero.

export interface Shape {
  bounds: Rect;
  /** Depth inside: distance to the shape's edge, > 0 inside, ≤ 0 outside. */
  inside(x: number, z: number): number;
}

export function boxShape(r: Rect): Shape {
  return {
    bounds: r,
    inside(x, z) {
      const dx = Math.min(x - r.x0, r.x1 - x);
      const dz = Math.min(z - r.z0, r.z1 - z);
      if (dx >= 0 && dz >= 0) return Math.min(dx, dz);
      return -Math.hypot(Math.max(0, -dx), Math.max(0, -dz));
    },
  };
}

/** Frame cell or node index range covering a rect plus one cell. */
function span(f: GridFrame, r: Rect, nodes: boolean): [number, number, number, number] {
  const maxI = nodes ? f.w : f.w - 1;
  const maxJ = nodes ? f.h : f.h - 1;
  return [
    Math.max(0, Math.floor((r.x0 - f.x0) / f.cell) - 1),
    Math.max(0, Math.floor((r.z0 - f.z0) / f.cell) - 1),
    Math.min(maxI, Math.ceil((r.x1 - f.x0) / f.cell) + 1),
    Math.min(maxJ, Math.ceil((r.z1 - f.z0) / f.cell) + 1),
  ];
}

/** The union's depth at every node, > 0 in the open; rock far from every shape reads −cell. */
export function sampleField(shapes: readonly Shape[], f: GridFrame): Float32Array {
  const n = f.w + 1;
  const out = new Float32Array(n * (f.h + 1)).fill(-f.cell);
  for (const s of shapes) {
    const [i0, j0, i1, j1] = span(f, s.bounds, true);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const v = s.inside(f.x0 + i * f.cell, f.z0 + j * f.cell);
        if (v > out[j * n + i]!) out[j * n + i] = v;
      }
    }
  }
  return out;
}

/** Per cell, the index of the shape deepest at the cell's centre; -1 far from every shape. */
export function labelCells(shapes: readonly Shape[], f: GridFrame): Int16Array {
  const owner = new Int16Array(f.w * f.h).fill(-1);
  const best = new Float32Array(f.w * f.h).fill(-Infinity);
  shapes.forEach((s, k) => {
    const [i0, j0, i1, j1] = span(f, s.bounds, false);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * f.w + i;
        const v = s.inside(f.x0 + (i + 0.5) * f.cell, f.z0 + (j + 0.5) * f.cell);
        if (v > best[c]!) {
          best[c] = v;
          owner[c] = k;
        }
      }
    }
  });
  return owner;
}
