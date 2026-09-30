import type { Point, Segment } from './geometry';
import { nodePoint, type GridFrame } from './raster';

// Marching squares over the free-space field (GDD §7 step 10): wall segments
// and the free part of every cell. A crossing is computed the same way from
// both cells of a grid edge, so floor, ceiling and walls share exact vertices:
// the fisheye bends only vertices, and a T-junction opens a crack (VISUAL.md §11).

export interface WallEdge {
  seg: Segment;
  cell: number;
  /** Unit normal toward the open side. */
  nx: number;
  nz: number;
}

/** The free part of a cell: a convex polygon. */
export interface CellPiece {
  cell: number;
  points: Point[];
}

/** Where the field crosses zero on the edge between two neighbouring nodes. */
export function edgeCrossing(f: GridFrame, field: Float32Array, ia: number, ja: number, ib: number, jb: number): Point {
  const n = f.w + 1;
  let a = ja * n + ia;
  let b = jb * n + ib;
  let pa = nodePoint(f, ia, ja);
  let pb = nodePoint(f, ib, jb);
  if (b < a) {
    [a, b] = [b, a];
    [pa, pb] = [pb, pa];
  }
  const va = field[a]!;
  const t = va / (va - field[b]!);
  return { x: pa.x + (pb.x - pa.x) * t, z: pa.z + (pb.z - pa.z) * t };
}

export function contour(f: GridFrame, field: Float32Array): { walls: WallEdge[]; pieces: CellPiece[] } {
  const n = f.w + 1;
  const walls: WallEdge[] = [];
  const pieces: CellPiece[] = [];

  const addPiece = (cell: number, pts: Point[]) => {
    const out: Point[] = [];
    for (const p of pts) {
      const last = out[out.length - 1];
      if (!last || last.x !== p.x || last.z !== p.z) out.push(p);
    }
    if (out.length > 1 && out[0]!.x === out[out.length - 1]!.x && out[0]!.z === out[out.length - 1]!.z) out.pop();
    if (out.length >= 3) pieces.push({ cell, points: out });
  };
  const addWall = (cell: number, a: Point, b: Point, open: Point) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) return;
    let nx = -dz / len;
    let nz = dx / len;
    if ((open.x - a.x) * nx + (open.z - a.z) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    walls.push({ seg: { ax: a.x, az: a.z, bx: b.x, bz: b.z }, cell, nx, nz });
  };

  for (let j = 0; j < f.h; j++) {
    for (let i = 0; i < f.w; i++) {
      // Fast path: most cells are all rock or all open.
      const k0 = j * n + i;
      const openCorners = +(field[k0]! > 0) + +(field[k0 + 1]! > 0) + +(field[k0 + n]! > 0) + +(field[k0 + n + 1]! > 0);
      if (openCorners === 0) continue;
      if (openCorners === 4) {
        const p = nodePoint(f, i, j);
        const q = nodePoint(f, i + 1, j + 1);
        pieces.push({ cell: j * f.w + i, points: [p, { x: q.x, z: p.z }, q, { x: p.x, z: q.z }] });
        continue;
      }
      const corners: [number, number][] = [
        [i, j],
        [i + 1, j],
        [i + 1, j + 1],
        [i, j + 1],
      ];
      const v = corners.map(([ci, cj]) => field[cj * n + ci]!);
      const free = v.map((x) => x > 0);
      const count = free.filter(Boolean).length;
      if (count === 0) continue;
      const cell = j * f.w + i;
      if (count === 4) {
        pieces.push({ cell, points: corners.map(([ci, cj]) => nodePoint(f, ci, cj)) });
        continue;
      }
      // Walk the cell's boundary: free corners and the crossings between them.
      const ring: { p: Point; cross: boolean }[] = [];
      for (let k = 0; k < 4; k++) {
        const [ai, aj] = corners[k]!;
        const [bi, bj] = corners[(k + 1) % 4]!;
        if (free[k]) ring.push({ p: nodePoint(f, ai, aj), cross: false });
        if (free[k] !== free[(k + 1) % 4]) ring.push({ p: edgeCrossing(f, field, ai, aj, bi, bj), cross: true });
      }
      const saddle = count === 2 && free[0] === free[2];
      if (saddle && (v[0]! + v[1]! + v[2]! + v[3]!) / 4 <= 0) {
        // Solid centre: each free corner is its own triangle.
        ring.forEach((r, k) => {
          if (r.cross) return;
          const prev = ring[(k + ring.length - 1) % ring.length]!.p;
          const next = ring[(k + 1) % ring.length]!.p;
          addPiece(cell, [prev, r.p, next]);
          addWall(cell, prev, next, r.p);
        });
        continue;
      }
      const pts = ring.map((r) => r.p);
      addPiece(cell, pts);
      const open = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length };
      ring.forEach((a, k) => {
        const b = ring[(k + 1) % ring.length]!;
        if (a.cross && b.cross) addWall(cell, a.p, b.p, open);
      });
    }
  }
  return { walls, pieces };
}
