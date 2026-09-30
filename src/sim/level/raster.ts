import type { Point } from './geometry';

// Regular grids over the level plane (GDD §7, §8): the free-space field at
// nodes, zones per cell, the enemy's nav cells.

/** Cell (i, j) spans [x0 + i·cell, x0 + (i+1)·cell] × [z0 + j·cell, …]; its corners are nodes. */
export interface GridFrame {
  x0: number;
  z0: number;
  cell: number;
  /** Cells along x and z; nodes are (w + 1) × (h + 1). */
  w: number;
  h: number;
}

/** A frame covering the bounds plus `margin`, its origin on a multiple of `cell`. */
export function frameAround(minX: number, minZ: number, maxX: number, maxZ: number, cell: number, margin: number): GridFrame {
  const x0 = Math.floor((minX - margin) / cell) * cell;
  const z0 = Math.floor((minZ - margin) / cell) * cell;
  return { x0, z0, cell, w: Math.ceil((maxX + margin - x0) / cell), h: Math.ceil((maxZ + margin - z0) / cell) };
}

/** Index of the cell under a point, or -1 outside the frame. */
export function cellAt(f: GridFrame, x: number, z: number): number {
  const i = Math.floor((x - f.x0) / f.cell);
  const j = Math.floor((z - f.z0) / f.cell);
  return i < 0 || j < 0 || i >= f.w || j >= f.h ? -1 : j * f.w + i;
}

export function cellCenter(f: GridFrame, c: number): Point {
  const i = c % f.w;
  return { x: f.x0 + (i + 0.5) * f.cell, z: f.z0 + ((c - i) / f.w + 0.5) * f.cell };
}

export function nodePoint(f: GridFrame, i: number, j: number): Point {
  return { x: f.x0 + i * f.cell, z: f.z0 + j * f.cell };
}

/** Bilinear value of a node field at (x, z), clamped to the frame. */
export function sampleNodes(f: GridFrame, nodes: Float32Array, x: number, z: number): number {
  const u = (x - f.x0) / f.cell;
  const v = (z - f.z0) / f.cell;
  const i = Math.min(f.w - 1, Math.max(0, Math.floor(u)));
  const j = Math.min(f.h - 1, Math.max(0, Math.floor(v)));
  const tu = Math.min(1, Math.max(0, u - i));
  const tv = Math.min(1, Math.max(0, v - j));
  const n = f.w + 1;
  const a = nodes[j * n + i]!;
  const b = nodes[j * n + i + 1]!;
  const c = nodes[(j + 1) * n + i]!;
  const d = nodes[(j + 1) * n + i + 1]!;
  return (a * (1 - tu) + b * tu) * (1 - tv) + (c * (1 - tu) + d * tu) * tv;
}
