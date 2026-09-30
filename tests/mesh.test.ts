import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { buildLevelMesh, gridCuts } from '../src/render/levelMesh';
import { buildLevel } from '../src/sim/level/build';
import { fixedLevel } from '../src/sim/level/fixed';

describe('level mesh cuts (VISUAL.md §11)', () => {
  it('cuts on the world grid so neighbours share seam vertices', () => {
    expect(gridCuts(-3.5, 3.5, 1)).toEqual([-3.5, -3, -2, -1, 0, 1, 2, 3, 3.5]);
    expect(gridCuts(37, 40, 1)).toEqual([37, 38, 39, 40]);
    // A corridor edge inside a room edge reuses the room's vertices.
    const room = gridCuts(-10, 14, 1);
    for (const v of gridCuts(-4, 4, 1)) expect(room).toContain(v);
  });

  it('never makes an empty piece', () => {
    const c = gridCuts(0.9999999, 2.0000001, 1);
    for (let i = 0; i + 1 < c.length; i++) expect(c[i + 1]! - c[i]!).toBeGreaterThan(0);
  });
});

describe('level mesh (VISUAL.md §11)', () => {
  it('draws every floor piece twice (floor and ceiling) and the white wall in its own mesh', () => {
    const level = buildLevel(fixedLevel());
    const group = buildLevelMesh(level, 1);
    const [world, signal] = group.children as THREE.Mesh[];
    const floorTris = level.floor.reduce((s, p) => s + p.points.length - 2, 0);
    expect(world!.geometry.getAttribute('position').count / 3).toBeGreaterThan(2 * floorTris);
    expect(signal!.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });
});
