// 2D level geometry on the (x, z) plane, meters (GDD §8). Height is render data only.

/** Axis-aligned rectangle, min corner inclusive. */
export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** A wall: collision is two-sided, so winding does not matter. */
export interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

export function rect(x0: number, z0: number, x1: number, z1: number): Rect {
  return { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) };
}

/** The four sides of a rectangle. */
export function rectWalls(r: Rect): Segment[] {
  return [
    { ax: r.x0, az: r.z0, bx: r.x1, bz: r.z0 },
    { ax: r.x1, az: r.z0, bx: r.x1, bz: r.z1 },
    { ax: r.x1, az: r.z1, bx: r.x0, bz: r.z1 },
    { ax: r.x0, az: r.z1, bx: r.x0, bz: r.z0 },
  ];
}

export interface Point {
  x: number;
  z: number;
}

/** Closest point of the segment to (px, pz). */
export function closestOnSegment(s: Segment, px: number, pz: number): Point {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - s.ax) * dx + (pz - s.az) * dz) / len2)) : 0;
  return { x: s.ax + dx * t, z: s.az + dz * t };
}

export function segmentLength(s: Segment): number {
  return Math.hypot(s.bx - s.ax, s.bz - s.az);
}
