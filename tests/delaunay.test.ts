import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { delaunay, triangleEdges } from '../src/sim/level/gen/delaunay';
import { scatterPoints } from '../src/sim/level/gen/scatter';

/** Is p strictly inside the circumcircle of a, b, c? */
function inCircle(a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }, p: { x: number; z: number }): boolean {
  const ax = a.x - p.x;
  const az = a.z - p.z;
  const bx = b.x - p.x;
  const bz = b.z - p.z;
  const cx = c.x - p.x;
  const cz = c.z - p.z;
  const det = (ax * ax + az * az) * (bx * cz - cx * bz) - (bx * bx + bz * bz) * (ax * cz - cx * az) + (cx * cx + cz * cz) * (ax * bz - bx * az);
  const orient = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  return orient > 0 ? det > 1e-6 : det < -1e-6;
}

describe('scatter and Delaunay (GDD §7 steps 2–3)', () => {
  it('scatters points no closer than their spacing', () => {
    const pts = scatterPoints(new Rng(3), 40, 35, 70);
    expect(pts.length).toBeGreaterThanOrEqual(30);
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z)).toBeGreaterThanOrEqual(35 - 1e-9);
    }
  });

  it('splits a square into two triangles', () => {
    const tris = delaunay([
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 11 },
      { x: 0, z: 10 },
    ]);
    expect(tris.length).toBe(2);
    expect(triangleEdges(tris).length).toBe(5);
  });

  it('leaves every circumcircle empty', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const pts = scatterPoints(new Rng(seed), 40, 35, 70);
      const tris = delaunay(pts);
      // A planar triangulation of n points with h on the hull has 2n - 2 - h triangles.
      expect(tris.length).toBeGreaterThan(pts.length);
      for (const [a, b, c] of tris) {
        pts.forEach((p, k) => {
          if (k === a || k === b || k === c) return;
          expect(inCircle(pts[a]!, pts[b]!, pts[c]!, p)).toBe(false);
        });
      }
    }
  });
});
