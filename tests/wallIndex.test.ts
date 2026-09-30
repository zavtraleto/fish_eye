import { describe, expect, it } from 'vitest';
import { closestOnSegment, type Segment } from '../src/sim/level/geometry';
import { SegmentIndex } from '../src/sim/level/wallIndex';

/** Deterministic test numbers in [0, 1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

function randomWalls(n: number, rnd: () => number): Segment[] {
  return Array.from({ length: n }, () => {
    const ax = rnd() * 200 - 100;
    const az = rnd() * 200 - 100;
    return { ax, az, bx: ax + rnd() * 6 - 3, bz: az + rnd() * 6 - 3 };
  });
}

const touches = (s: Segment, x0: number, z0: number, x1: number, z1: number) =>
  Math.max(s.ax, s.bx) >= x0 && Math.min(s.ax, s.bx) <= x1 && Math.max(s.az, s.bz) >= z0 && Math.min(s.az, s.bz) <= z1;

describe('wall index (GDD §8)', () => {
  it('returns every wall near a box, each once', () => {
    const rnd = lcg(7);
    const walls = randomWalls(500, rnd);
    const index = new SegmentIndex(walls);
    for (let k = 0; k < 200; k++) {
      const x = rnd() * 260 - 130;
      const z = rnd() * 260 - 130;
      const r = rnd() * 10;
      const got = new Set(index.near(x - r, z - r, x + r, z + r));
      expect(got.size).toBe(index.near(x - r, z - r, x + r, z + r).length);
      for (const w of walls) if (touches(w, x - r, z - r, x + r, z + r)) expect(got.has(w)).toBe(true);
    }
  });

  it('measures the distance to the nearest wall like brute force', () => {
    const rnd = lcg(11);
    const walls = randomWalls(300, rnd);
    const index = new SegmentIndex(walls);
    for (let k = 0; k < 200; k++) {
      const x = rnd() * 200 - 100;
      const z = rnd() * 200 - 100;
      let best = 8;
      for (const w of walls) {
        const c = closestOnSegment(w, x, z);
        best = Math.min(best, Math.hypot(x - c.x, z - c.z));
      }
      expect(index.distance(x, z, 8)).toBeCloseTo(best, 9);
    }
  });

  it('works with no walls', () => {
    const index = new SegmentIndex([]);
    expect(index.near(-5, -5, 5, 5)).toEqual([]);
    expect(index.distance(0, 0, 3)).toBe(3);
  });
});
