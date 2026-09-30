import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { buildLevelMesh, chunkDistance, gridCuts, type ChunkBounds } from '../src/render/levelMesh';
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

describe('level mesh (VISUAL.md §11, GDD §15.4)', () => {
  it('draws every floor piece twice in world chunks and the white wall in signal chunks', () => {
    const level = buildLevel(fixedLevel());
    const meshes = buildLevelMesh(level, 1, 24).children as THREE.Mesh[];
    const tris = (m: THREE.Mesh) => m.geometry.getAttribute('position').count / 3;
    const world = meshes.filter((m) => !(m.userData.bounds as ChunkBounds).signal);
    const signal = meshes.filter((m) => (m.userData.bounds as ChunkBounds).signal);
    const floorTris = level.floor.reduce((s, p) => s + p.points.length - 2, 0);
    expect(world.length).toBeGreaterThan(10);
    expect(world.reduce((s, m) => s + tris(m), 0)).toBeGreaterThan(2 * floorTris);
    expect(signal.reduce((s, m) => s + tris(m), 0)).toBeGreaterThan(0);
  });

  it('measures the plan distance to a chunk', () => {
    const b: ChunkBounds = { x0: 0, z0: 0, x1: 10, z1: 10, signal: false };
    expect(chunkDistance(b, 5, 5)).toBe(0);
    expect(chunkDistance(b, 13, 14)).toBe(5);
    expect(chunkDistance(b, -2, 5)).toBe(2);
  });
});
