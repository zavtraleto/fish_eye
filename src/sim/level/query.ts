import type { Point, Segment } from './geometry';
import type { Area, Door, Level } from './level';

// Questions the enemy asks about a built level (GDD §11.1).

/** The room or corridor under a point, or null outside the floor. */
export function locate(level: Level, x: number, z: number): Area | null {
  for (const a of level.areas) {
    const r = a.rect;
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return a;
  }
  return null;
}

export function sameArea(a: Area | null, b: Area | null): boolean {
  return a !== null && a === b;
}

export function roomCenter(level: Level, id: number): Point {
  for (const a of level.areas) {
    if (a.kind === 'room' && a.room === id) return { x: (a.rect.x0 + a.rect.x1) / 2, z: (a.rect.z0 + a.rect.z1) / 2 };
  }
  throw new Error(`no room ${id}`);
}

/** The door of edge a–b as [point on a, point on b]. */
export function doorBetween(level: Level, a: number, b: number): [Point, Point] {
  const d: Door | undefined = level.doors.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  if (!d) throw new Error(`no door ${a}-${b}`);
  return d.a === a ? [d.pa, d.pb] : [d.pb, d.pa];
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
export function lineOfSight(walls: readonly Segment[], a: Point, b: Point, halfWidth = 0): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const nx = len > 1e-9 ? (-dz / len) * halfWidth : 0;
  const nz = len > 1e-9 ? (dx / len) * halfWidth : 0;
  const offsets = halfWidth > 0 ? [0, 1, -1] : [0];
  for (const k of offsets) {
    const ox = nx * k;
    const oz = nz * k;
    for (const w of walls) if (crossesWall(a.x + ox, a.z + oz, b.x + ox, b.z + oz, w)) return false;
  }
  return true;
}
