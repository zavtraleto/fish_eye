import { describe, expect, it } from 'vitest';
import { rect } from '../src/sim/level/geometry';
import { cellAt, cellCenter, frameAround, nodePoint, sampleNodes } from '../src/sim/level/raster';
import { openRockIslands } from '../src/sim/level/rock';
import { boxShape, labelCells, polygonShape, sampleField, stripShape } from '../src/sim/level/shapes';

describe('raster (GDD §7, §8)', () => {
  it('frames bounds on multiples of the cell, with a margin', () => {
    const f = frameAround(-3.2, 1.1, 4.9, 6, 0.5, 2);
    expect(f.x0).toBe(-5.5);
    expect(f.z0).toBe(-1);
    expect(f.x0 + f.w * f.cell).toBeGreaterThanOrEqual(6.9);
    expect(f.z0 + f.h * f.cell).toBeGreaterThanOrEqual(8);
  });

  it('maps points to cells and back', () => {
    const f = frameAround(0, 0, 10, 10, 1, 0);
    expect(cellAt(f, 3.5, 2.5)).toBe(2 * f.w + 3);
    expect(cellCenter(f, 2 * f.w + 3)).toEqual({ x: 3.5, z: 2.5 });
    expect(cellAt(f, -0.1, 5)).toBe(-1);
    expect(nodePoint(f, 2, 3)).toEqual({ x: 2, z: 3 });
  });

  it('box depth: distance to the nearest side inside, negative outside', () => {
    const b = boxShape(rect(0, 0, 10, 4));
    expect(b.inside(5, 2)).toBe(2);
    expect(b.inside(1, 2)).toBe(1);
    expect(b.inside(0, 2)).toBe(0);
    expect(b.inside(-3, 2)).toBe(-3);
    expect(b.inside(13, 8)).toBeCloseTo(-5);
  });

  it('the union field is open across overlapping shapes', () => {
    const shapes = [boxShape(rect(0, 0, 10, 10)), boxShape(rect(9, 3, 20, 7))];
    const f = frameAround(0, 0, 20, 10, 0.5, 2);
    const field = sampleField(shapes, f);
    expect(sampleNodes(f, field, 10, 5)).toBeGreaterThan(0.5); // the joint
    expect(sampleNodes(f, field, 15, 1)).toBeLessThan(0); // rock beside the corridor
    expect(sampleNodes(f, field, 5, 5)).toBeCloseTo(5);
  });

  it('labels each cell with the deepest shape', () => {
    const shapes = [boxShape(rect(0, 0, 10, 10)), boxShape(rect(9, 3, 20, 7))];
    const f = frameAround(0, 0, 20, 10, 0.5, 2);
    const owner = labelCells(shapes, f);
    expect(owner[cellAt(f, 5, 5)]).toBe(0);
    expect(owner[cellAt(f, 15, 5)]).toBe(1);
    expect(owner[cellAt(f, -1.9, -1.9)]).toBe(-1);
  });
});

describe('skeleton shapes (GDD §6)', () => {
  it('a polygon is deepest inside and negative outside', () => {
    const tri = polygonShape([
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 0, z: 10 },
    ]);
    expect(tri.inside(1, 1)).toBeCloseTo(1);
    expect(tri.inside(-2, 1)).toBeCloseTo(-2);
    expect(tri.inside(10, 10)).toBeCloseTo(-Math.SQRT2 * 5);
  });

  it('a strip matches a box when axis-aligned, and works at any angle', () => {
    const s = stripShape({ x: 0, z: 0 }, { x: 10, z: 0 }, 4);
    const b = boxShape(rect(0, -2, 10, 2));
    for (const [x, z] of [
      [5, 0],
      [1, 1.5],
      [-1, 0],
      [12, 5],
    ] as const)
      expect(s.inside(x, z)).toBeCloseTo(b.inside(x, z));
    const d = stripShape({ x: 0, z: 0 }, { x: 10, z: 10 }, 4);
    expect(d.inside(5, 5)).toBeCloseTo(2);
    expect(d.inside(5 - 2 * Math.SQRT1_2, 5 + 2 * Math.SQRT1_2)).toBeCloseTo(0);
    expect(d.bounds.x0).toBeCloseTo(-Math.SQRT2);
  });
});

describe('rock islands (GDD §6)', () => {
  // A ring corridor around a pillar: the pillar is an island.
  const ring = (pillar: number) => {
    const s = 40;
    const h = pillar / 2;
    return [
      boxShape(rect(0, 0, s, 20 - h)),
      boxShape(rect(0, 20 + h, s, s)),
      boxShape(rect(0, 0, 20 - h, s)),
      boxShape(rect(20 + h, 0, s, s)),
    ];
  };
  const islandCells = (f: ReturnType<typeof frameAround>, field: Float32Array) => {
    let solid = 0;
    for (let x = 18; x <= 22; x++) for (let z = 18; z <= 22; z++) if (sampleNodes(f, field, x, z) <= 0) solid++;
    return solid;
  };

  it('opens a thin column and keeps a thick one', () => {
    const f = frameAround(0, 0, 40, 40, 1, 2);
    const thin = sampleField(ring(2), f);
    expect(islandCells(f, thin)).toBeGreaterThan(0);
    expect(openRockIslands(f, thin, 60, 3)).toBe(1);
    expect(islandCells(f, thin)).toBe(0);
    const thick = sampleField(ring(12), f);
    expect(openRockIslands(f, thick, 60, 3)).toBe(0);
    expect(islandCells(f, thick)).toBeGreaterThan(0);
  });

  it('never opens the outer rock', () => {
    const f = frameAround(0, 0, 10, 10, 1, 2);
    const field = sampleField([boxShape(rect(0, 0, 10, 10))], f);
    expect(openRockIslands(f, field, 1e6, 1e6)).toBe(0);
    expect(sampleNodes(f, field, -1, -1)).toBeLessThan(0);
  });
});
