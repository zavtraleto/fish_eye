import type { Point } from '../geometry';

// Delaunay triangulation (GDD §7 step 3), Bowyer–Watson. O(n²) is plenty for
// the few dozen anchor points of a level. The graph is planar by construction.

export type Triangle = readonly [number, number, number];

export interface Edge {
  a: number;
  b: number;
}

interface Tri {
  v: [number, number, number];
  cx: number;
  cz: number;
  r2: number;
}

function circum(p: readonly Point[], a: number, b: number, c: number): Tri {
  const A = p[a]!;
  const B = p[b]!;
  const C = p[c]!;
  const d = 2 * (A.x * (B.z - C.z) + B.x * (C.z - A.z) + C.x * (A.z - B.z));
  const a2 = A.x * A.x + A.z * A.z;
  const b2 = B.x * B.x + B.z * B.z;
  const c2 = C.x * C.x + C.z * C.z;
  const cx = (a2 * (B.z - C.z) + b2 * (C.z - A.z) + c2 * (A.z - B.z)) / d;
  const cz = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / d;
  return { v: [a, b, c], cx, cz, r2: (A.x - cx) ** 2 + (A.z - cz) ** 2 };
}

/** Triangles as index triples into `points`. */
export function delaunay(points: readonly Point[]): Triangle[] {
  const n = points.length;
  if (n < 3) return [];
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxZ = Math.max(maxZ, p.z);
  }
  const span = Math.max(maxX - minX, maxZ - minZ, 1) * 20;
  const mx = (minX + maxX) / 2;
  const mz = (minZ + maxZ) / 2;
  // A super-triangle holding every point; its corners are indices n, n+1, n+2.
  const p = [...points, { x: mx - span, z: mz - span }, { x: mx + span, z: mz - span }, { x: mx, z: mz + span }];
  let tris: Tri[] = [circum(p, n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const q = p[i]!;
    const bad: Tri[] = [];
    const keep: Tri[] = [];
    for (const t of tris) ((q.x - t.cx) ** 2 + (q.z - t.cz) ** 2 < t.r2 ? bad : keep).push(t);
    // The hole's boundary: edges of bad triangles that only one bad triangle has.
    const count = new Map<string, [number, number, number]>();
    for (const t of bad) {
      for (let k = 0; k < 3; k++) {
        const a = t.v[k]!;
        const b = t.v[(k + 1) % 3]!;
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        const c = count.get(key);
        count.set(key, c ? [c[0], c[1], c[2] + 1] : [a, b, 1]);
      }
    }
    tris = keep;
    for (const [a, b, times] of count.values()) if (times === 1) tris.push(circum(p, a, b, i));
  }
  return tris.filter((t) => t.v.every((v) => v < n)).map((t) => [t.v[0], t.v[1], t.v[2]] as const);
}

/** Each triangle edge once, a < b. */
export function triangleEdges(tris: readonly Triangle[]): Edge[] {
  const seen = new Set<string>();
  const out: Edge[] = [];
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const a = Math.min(t[k]!, t[(k + 1) % 3]!);
      const b = Math.max(t[k]!, t[(k + 1) % 3]!);
      const key = `${a},${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a, b });
    }
  }
  return out;
}
