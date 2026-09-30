import type { Point, Segment } from './geometry';
import type { Level, Zone } from './level';
import { cellAt } from './raster';
import type { SegmentIndex } from './wallIndex';

// Questions the enemy asks about a built level (GDD §11.1).

/** The zone under a point, or null in rock. */
export function locate(level: Level, x: number, z: number): Zone | null {
  const c = cellAt(level.frame, x, z);
  const id = c < 0 ? -1 : level.cellZone[c]!;
  return id < 0 ? null : level.zones[id]!;
}

/** The graph node of a zone: its own for a space, the first end for a passage. */
export function zoneNode(zone: Zone): number {
  return zone.ref.kind === 'node' ? zone.ref.node : zone.ref.a;
}

/** A point deep inside graph node `id`'s zone. */
export function nodeAnchor(level: Level, id: number): Point {
  const z = level.zones.find((x) => x.ref.kind === 'node' && x.ref.node === id);
  if (!z) throw new Error(`no zone for node ${id}`);
  return z.anchor;
}

/** Graph steps from `from` to every room, breadth first. */
export function graphDistances(level: Level, from: number): Map<number, number> {
  const dist = new Map<number, number>([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const r = queue.shift()!;
    for (const e of level.graph.edges) {
      const n = e.a === r ? e.b : e.b === r ? e.a : null;
      if (n === null || dist.has(n)) continue;
      dist.set(n, dist.get(r)! + 1);
      queue.push(n);
    }
  }
  return dist;
}

/** Shortest room path from `from` to `to`, both included; ties go to the lower room id. */
export function graphPath(level: Level, from: number, to: number): number[] {
  const dist = graphDistances(level, to);
  if (!dist.has(from)) return [];
  const path = [from];
  let r = from;
  while (r !== to) {
    let next = -1;
    for (const e of level.graph.edges) {
      const n = e.a === r ? e.b : e.b === r ? e.a : null;
      if (n === null || dist.get(n) !== dist.get(r)! - 1) continue;
      if (next < 0 || n < next) next = n;
    }
    path.push(next);
    r = next;
  }
  return path;
}

/** Proper intersection of segment p–q with a wall (touching does not count). */
export function crossesWall(px: number, pz: number, qx: number, qz: number, w: Segment): boolean {
  const cross = (ox: number, oz: number, ax: number, az: number, bx: number, bz: number) => (ax - ox) * (bz - oz) - (az - oz) * (bx - ox);
  const d1 = cross(w.ax, w.az, w.bx, w.bz, px, pz);
  const d2 = cross(w.ax, w.az, w.bx, w.bz, qx, qz);
  const d3 = cross(px, pz, qx, qz, w.ax, w.az);
  const d4 = cross(px, pz, qx, qz, w.bx, w.bz);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * A "thick ray" (GDD §11.3): the centre line and two lines `halfWidth` to
 * either side all pass no wall.
 */
export function lineOfSight(walls: SegmentIndex, a: Point, b: Point, halfWidth = 0): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const nx = len > 1e-9 ? (-dz / len) * halfWidth : 0;
  const nz = len > 1e-9 ? (dx / len) * halfWidth : 0;
  const offsets = halfWidth > 0 ? [0, 1, -1] : [0];
  for (const k of offsets) {
    const ax = a.x + nx * k;
    const az = a.z + nz * k;
    const bx = b.x + nx * k;
    const bz = b.z + nz * k;
    const near = walls.near(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
    for (const w of near) if (crossesWall(ax, az, bx, bz, w)) return false;
  }
  return true;
}
