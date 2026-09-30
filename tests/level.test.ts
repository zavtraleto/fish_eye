import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import { buildLevel } from '../src/sim/level/build';
import { corridorRect, fixedLevel } from '../src/sim/level/fixed';
import { closestOnSegment, rect, segmentLength } from '../src/sim/level/geometry';
import { crossesWall, locate, nodeAnchor } from '../src/sim/level/query';
import { cellAt } from '../src/sim/level/raster';
import { wallClearance } from './helpers';

const key = (x: number, z: number) => `${x},${z}`;

describe('level build (GDD §7, §8, §10)', () => {
  beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

  it('keeps the green line clear of every wall', () => {
    const level = buildLevel(fixedLevel());
    for (let i = 0; i + 1 < level.route.length; i++) {
      const a = level.route[i]!;
      const b = level.route[i + 1]!;
      for (const w of level.walls) expect(crossesWall(a.x, a.z, b.x, b.z, w)).toBe(false);
    }
  });

  it('runs the route from the START zone to the EYE', () => {
    const level = buildLevel(fixedLevel());
    const first = locate(level, level.route[0]!.x, level.route[0]!.z);
    expect(first?.ref).toEqual({ kind: 'node', node: level.graph.start });
    expect(level.route.at(-1)).toEqual(level.eye);
    expect(level.eye).toEqual(nodeAnchor(level, level.graph.eye));
  });

  it('puts the white wall on the START contour, full length', () => {
    const level = buildLevel(fixedLevel());
    const white = level.faces.filter((f) => f.kind === 'start');
    expect(white.length).toBeGreaterThan(0);
    for (const f of white) {
      expect(f.y0).toBe(0);
      for (const [x, z] of [
        [f.seg.ax, f.seg.az],
        [f.seg.bx, f.seg.bz],
      ] as const) {
        const c = closestOnSegment(level.startWall, x, z);
        expect(Math.hypot(x - c.x, z - c.z)).toBeLessThan(1e-6);
      }
    }
    // The contour cuts the two corners by up to one cell each.
    const whiteLen = white.reduce((s, f) => s + segmentLength(f.seg), 0);
    expect(whiteLen).toBeGreaterThanOrEqual(segmentLength(level.startWall) - 2 * level.frame.cell - 1e-6);
    expect(whiteLen).toBeLessThanOrEqual(segmentLength(level.startWall) + 1e-6);
  });

  it('rejects a white wall that is not on the contour', () => {
    const def = fixedLevel();
    def.startWall = { ax: 0, az: -5, bx: 0, bz: 5 };
    expect(() => buildLevel(def)).toThrow();
  });

  it('spawns inside START, SPAWN_DISTANCE from the white wall, facing the route', () => {
    const level = buildLevel(fixedLevel());
    const { spawn, startWall } = level;
    const c = closestOnSegment(startWall, spawn.x, spawn.z);
    expect(Math.hypot(spawn.x - c.x, spawn.z - c.z)).toBeCloseTo(tuning.start.SPAWN_DISTANCE);
    expect(wallClearance(level.walls, spawn.x, spawn.z)).toBeGreaterThan(tuning.player.WALL_RADIUS);
    const next = level.route[1]!;
    expect(Math.atan2(-(next.x - spawn.x), -(next.z - spawn.z))).toBeCloseTo(spawn.yaw);
  });

  it('opens every graph edge: each corridor zone meets its two rooms', () => {
    const level = buildLevel(fixedLevel());
    for (const z of level.zones.filter((x) => x.ref.kind === 'edge')) {
      const touching = level.portals.filter((p) => p.a === z.id || p.b === z.id);
      expect(touching.length, `zone ${z.id}`).toBe(2);
      for (const p of touching) expect(wallClearance(level.walls, p.mid.x, p.mid.z)).toBeGreaterThan(tuning.player.WALL_RADIUS);
    }
  });

  it('shares wall and floor vertices exactly (VISUAL.md §11)', () => {
    const level = buildLevel(fixedLevel());
    const verts = new Set(level.floor.flatMap((p) => p.points.map((q) => key(q.x, q.z))));
    for (const w of level.walls) {
      expect(verts.has(key(w.ax, w.az))).toBe(true);
      expect(verts.has(key(w.bx, w.bz))).toBe(true);
    }
  });

  it('locates every zone at its anchor and nothing in the rock', () => {
    const level = buildLevel(fixedLevel());
    for (const z of level.zones) expect(locate(level, z.anchor.x, z.anchor.z)).toBe(z);
    expect(locate(level, 20, 30)).toBeNull(); // between START, A1, B0 and B1
    expect(level.cellZone[cellAt(level.frame, 20, 30)]).toBe(-1);
  });

  it('measures nav clearance: the distance to walls in the open, zero in rock', () => {
    const level = buildLevel(fixedLevel());
    const { frame, clearance } = level.nav;
    expect(clearance[cellAt(frame, 20, 30)]).toBe(0);
    const a = nodeAnchor(level, level.graph.eye);
    expect(clearance[cellAt(frame, a.x, a.z)]).toBeGreaterThanOrEqual(tuning.enemy.RADIUS * 3); // measured up to a cap
  });

  it('the fixed level has no dead ends', () => {
    const { graph } = fixedLevel();
    for (const r of graph.rooms) {
      const degree = graph.edges.filter((e) => e.a === r.id || e.b === r.id).length;
      expect(degree, `room ${r.id}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('rejects a corridor between rooms that do not face each other', () => {
    expect(() => corridorRect(rect(0, 0, 8, 8), rect(20, 20, 28, 28), 4)).toThrow();
  });
});
