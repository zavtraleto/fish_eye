import { describe, expect, it } from 'vitest';
import { contour } from '../src/sim/level/contour';
import { rect, segmentLength } from '../src/sim/level/geometry';
import { frameAround } from '../src/sim/level/raster';
import { boxShape, sampleField } from '../src/sim/level/shapes';

const key = (p: { x: number; z: number }) => `${p.x},${p.z}`;

function polyArea(pts: readonly { x: number; z: number }[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
}

describe('contour (GDD §7 step 10, VISUAL.md §11)', () => {
  it('traces a grid-aligned box exactly on its sides; each corner is cut by one cell diagonal', () => {
    const c = 0.5;
    const f = frameAround(1, 1, 4, 3, c, 1);
    const { walls, pieces } = contour(f, sampleField([boxShape(rect(1, 1, 4, 3))], f));
    const onSide = (x: number, z: number) => x === 1 || x === 4 || z === 1 || z === 3;
    for (const w of walls) expect(onSide(w.seg.ax, w.seg.az) && onSide(w.seg.bx, w.seg.bz)).toBe(true);
    // Nodes on the boundary read 0, which is rock: the corner cell keeps one triangle.
    expect(walls.reduce((s, w) => s + segmentLength(w.seg), 0)).toBeCloseTo(10 - 8 * c + 4 * c * Math.SQRT2, 6);
    expect(pieces.reduce((s, p) => s + polyArea(p.points), 0)).toBeCloseTo(6 - 2 * c * c, 6);
  });

  it('follows an off-grid box within a fraction of a cell', () => {
    const r = rect(0.3, 0.2, 5.7, 3.9);
    const f = frameAround(r.x0, r.z0, r.x1, r.z1, 0.5, 1);
    const { walls, pieces } = contour(f, sampleField([boxShape(r)], f));
    const off = (x: number, z: number) => -boxShape(r).inside(x, z);
    for (const w of walls) {
      expect(Math.abs(off(w.seg.ax, w.seg.az))).toBeLessThan(0.25);
      expect(Math.abs(off(w.seg.bx, w.seg.bz))).toBeLessThan(0.25);
    }
    expect(Math.abs(pieces.reduce((s, p) => s + polyArea(p.points), 0) - 5.4 * 3.7)).toBeLessThan(1);
  });

  it('points wall normals into the open', () => {
    const f = frameAround(1, 1, 4, 3, 0.5, 1);
    const { walls } = contour(f, sampleField([boxShape(rect(1, 1, 4, 3))], f));
    for (const w of walls) {
      const mx = (w.seg.ax + w.seg.bx) / 2 + w.nx * 0.1;
      const mz = (w.seg.az + w.seg.bz) / 2 + w.nz * 0.1;
      expect(boxShape(rect(1, 1, 4, 3)).inside(mx, mz)).toBeGreaterThan(0);
    }
  });

  it('shares every wall endpoint with the floor pieces exactly', () => {
    const shapes = [boxShape(rect(0.3, 0.2, 9.7, 8.1)), boxShape(rect(8.6, 3.1, 20.2, 6.7))];
    const f = frameAround(0, 0, 21, 9, 0.5, 1);
    const { walls, pieces } = contour(f, sampleField(shapes, f));
    const verts = new Set(pieces.flatMap((p) => p.points.map(key)));
    for (const w of walls) {
      expect(verts.has(key({ x: w.seg.ax, z: w.seg.az }))).toBe(true);
      expect(verts.has(key({ x: w.seg.bx, z: w.seg.bz }))).toBe(true);
    }
  });

  it('resolves saddles by the cell centre', () => {
    const f = { x0: 0, z0: 0, cell: 1, w: 1, h: 1 };
    // Nodes: (0,0) (1,0) / (0,1) (1,1); free on one diagonal.
    const joined = contour(f, Float32Array.from([1, -0.2, -0.2, 1]));
    expect(joined.pieces.length).toBe(1);
    expect(joined.walls.length).toBe(2);
    const split = contour(f, Float32Array.from([0.2, -1, -1, 0.2]));
    expect(split.pieces.length).toBe(2);
    expect(split.walls.length).toBe(2);
  });
});
