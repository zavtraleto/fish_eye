import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import { buildLevel } from '../src/sim/level/build';
import { closestOnSegment, rect, type Point, type Segment } from '../src/sim/level/geometry';
import { fixedLayout } from '../src/sim/level/fixed';
import type { Layout } from '../src/sim/level/layout';
import { wallClearance } from './helpers';

/** Proper intersection of two segments (touching endpoints do not count). */
function crosses(a: Point, b: Point, s: Segment): boolean {
  const cross = (ox: number, oz: number, px: number, pz: number, qx: number, qz: number) => (px - ox) * (qz - oz) - (pz - oz) * (qx - ox);
  const d1 = cross(s.ax, s.az, s.bx, s.bz, a.x, a.z);
  const d2 = cross(s.ax, s.az, s.bx, s.bz, b.x, b.z);
  const d3 = cross(a.x, a.z, b.x, b.z, s.ax, s.az);
  const d4 = cross(a.x, a.z, b.x, b.z, s.bx, s.bz);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

const inside = (p: Point, r: { x0: number; z0: number; x1: number; z1: number }) => p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1;

describe('level build (GDD §8, §10)', () => {
  beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

  it('keeps the green line clear of every wall', () => {
    const level = buildLevel(fixedLayout());
    for (let i = 0; i + 1 < level.route.length; i++) {
      for (const w of level.walls) expect(crosses(level.route[i]!, level.route[i + 1]!, w)).toBe(false);
    }
  });

  it('runs the route from the START centre to the EYE', () => {
    const level = buildLevel(fixedLayout());
    const layout = fixedLayout();
    const startRect = layout.rooms.find((r) => r.id === layout.graph.start)!.rect;
    expect(inside(level.route[0]!, startRect)).toBe(true);
    expect(level.route.at(-1)).toEqual(level.eye);
  });

  it('puts the white wall on a START side without openings', () => {
    const level = buildLevel(fixedLayout());
    const white = level.faces.filter((f) => f.kind === 'start');
    expect(white.length).toBe(1);
    expect(white[0]!.y0).toBe(0);
    expect(level.walls).toContainEqual(level.startWall);
  });

  it('spawns inside START, SPAWN_DISTANCE from the white wall, facing the first opening', () => {
    const level = buildLevel(fixedLayout());
    const { spawn, startWall } = level;
    const c = closestOnSegment(startWall, spawn.x, spawn.z);
    expect(Math.hypot(spawn.x - c.x, spawn.z - c.z)).toBeCloseTo(tuning.start.SPAWN_DISTANCE);
    expect(wallClearance(level.walls, spawn.x, spawn.z)).toBeGreaterThan(tuning.player.WALL_RADIUS);
    const opening = level.route[1]!;
    expect(Math.atan2(-(opening.x - spawn.x), -(opening.z - spawn.z))).toBeCloseTo(spawn.yaw);
  });

  it('leaves openings free: every corridor floor connects to both rooms', () => {
    const level = buildLevel(fixedLayout());
    for (const a of level.areas.filter((x) => x.kind === 'corridor')) {
      const mid = { x: (a.rect.x0 + a.rect.x1) / 2, z: (a.rect.z0 + a.rect.z1) / 2 };
      expect(wallClearance(level.walls, mid.x, mid.z)).toBeGreaterThan(tuning.player.WALL_RADIUS);
    }
  });

  it('the fixed level has no dead ends', () => {
    const { graph } = fixedLayout();
    for (const r of graph.rooms) {
      const degree = graph.edges.filter((e) => e.a === r.id || e.b === r.id).length;
      expect(degree, `room ${r.id}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('rejects a corridor between rooms that do not face each other', () => {
    const layout: Layout = {
      graph: { rooms: [{ id: 0, cx: 0, cz: 0 }, { id: 1, cx: 1, cz: 1 }], edges: [{ a: 0, b: 1 }], start: 0, eye: 1, route: [0, 1] },
      rooms: [
        { id: 0, rect: rect(0, 0, 8, 8), height: 4 },
        { id: 1, rect: rect(20, 20, 28, 28), height: 4 },
      ],
      corridors: [{ a: 0, b: 1, width: 4, height: 3 }],
    };
    expect(() => buildLevel(layout)).toThrow();
  });
});
