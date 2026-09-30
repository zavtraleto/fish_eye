import type { LevelDef, ShapeDef } from './build';
import { rect, type Rect } from './geometry';
import type { LevelGraph } from './graph';
import { boxShape } from './shapes';

// Hand-made test level until generation (phase 6) exists, built by the same
// raster pipeline. Cell pitch 48 m. Big loop of 10 rooms: the green line runs
// START → A1 → A2 → A3 → B3 → EYE, the way back the player has not seen is
// EYE → C2 → C1 → C0 → B0 → START. The junction B1 cuts the loop; no dead ends.
//
//   z=96   [C0] ---- [C1] ---- [C2] ---- [C3 EYE]
//           |          |                    |
//   z=48   [B0] ---- [B1]                 [B3]
//           |          |                    |
//   z=0    [S ] ---- [A1] ---- [A2] ---- [A3]

const ID = { S: 0, A1: 1, A2: 2, A3: 3, B3: 4, EYE: 5, C2: 6, C1: 7, C0: 8, B0: 9, B1: 10 } as const;

/** Corridors reach this far into both rooms: shapes must overlap where they join (build.ts). */
const OVERLAP = 1;
/** Least wall left between an opening and a room corner, meters. */
const MIN_JAMB = 0.5;

const GRAPH: LevelGraph = {
  rooms: [
    { id: ID.S, cx: 0, cz: 0 },
    { id: ID.A1, cx: 1, cz: 0 },
    { id: ID.A2, cx: 2, cz: 0 },
    { id: ID.A3, cx: 3, cz: 0 },
    { id: ID.B3, cx: 3, cz: 1 },
    { id: ID.EYE, cx: 3, cz: 2 },
    { id: ID.C2, cx: 2, cz: 2 },
    { id: ID.C1, cx: 1, cz: 2 },
    { id: ID.C0, cx: 0, cz: 2 },
    { id: ID.B0, cx: 0, cz: 1 },
    { id: ID.B1, cx: 1, cz: 1 },
  ],
  edges: [
    { a: ID.S, b: ID.A1 },
    { a: ID.A1, b: ID.A2 },
    { a: ID.A2, b: ID.A3 },
    { a: ID.A3, b: ID.B3 },
    { a: ID.B3, b: ID.EYE },
    { a: ID.EYE, b: ID.C2 },
    { a: ID.C2, b: ID.C1 },
    { a: ID.C1, b: ID.C0 },
    { a: ID.C0, b: ID.B0 },
    { a: ID.B0, b: ID.S },
    { a: ID.B1, b: ID.A1 },
    { a: ID.B1, b: ID.C1 },
    { a: ID.B1, b: ID.B0 },
  ],
  start: ID.S,
  eye: ID.EYE,
  route: [ID.S, ID.A1, ID.A2, ID.A3, ID.B3, ID.EYE],
};

const ROOMS: { id: number; rect: Rect; height: number }[] = [
  { id: ID.S, rect: rect(-9, -11, 9, 11), height: 8 },
  { id: ID.A1, rect: rect(37, -10, 63, 14), height: 10 },
  { id: ID.A2, rect: rect(85, -17, 107, 13), height: 12 },
  { id: ID.A3, rect: rect(130, -11, 158, 11), height: 9 },
  { id: ID.B3, rect: rect(136, 35, 156, 61), height: 8 },
  { id: ID.EYE, rect: rect(128, 83, 160, 113), height: 14 },
  { id: ID.C2, rect: rect(84, 86, 108, 106), height: 7 },
  { id: ID.C1, rect: rect(37, 86, 59, 114), height: 10 },
  { id: ID.C0, rect: rect(-10, 86, 10, 106), height: 9 },
  { id: ID.B0, rect: rect(-11, 36, 7, 60), height: 7 },
  { id: ID.B1, rect: rect(36, 36, 64, 64), height: 12 },
];

const CORRIDORS: { a: number; b: number; width: number; height: number }[] = [
  { a: ID.S, b: ID.A1, width: 8, height: 6 },
  { a: ID.A1, b: ID.A2, width: 7, height: 6 },
  { a: ID.A2, b: ID.A3, width: 9, height: 7 },
  { a: ID.A3, b: ID.B3, width: 7, height: 5 },
  { a: ID.B3, b: ID.EYE, width: 8, height: 6 },
  { a: ID.EYE, b: ID.C2, width: 7, height: 6 },
  { a: ID.C2, b: ID.C1, width: 6, height: 5 },
  { a: ID.C1, b: ID.C0, width: 8, height: 6 },
  { a: ID.C0, b: ID.B0, width: 7, height: 6 },
  { a: ID.B0, b: ID.S, width: 7, height: 5 },
  { a: ID.B1, b: ID.A1, width: 8, height: 7 },
  { a: ID.B1, b: ID.C1, width: 6, height: 5 },
  { a: ID.B1, b: ID.B0, width: 6, height: 5 },
];

/** Straight corridor between two rooms separated along exactly one axis, centred on their overlap, reaching OVERLAP into both. */
export function corridorRect(a: Rect, b: Rect, width: number): Rect {
  const alongX = a.x1 <= b.x0 || b.x1 <= a.x0;
  const alongZ = a.z1 <= b.z0 || b.z1 <= a.z0;
  if (alongX === alongZ) throw new Error('corridor needs rooms separated along exactly one axis');
  const lo0 = alongX ? Math.max(a.z0, b.z0) : Math.max(a.x0, b.x0);
  const hi0 = alongX ? Math.min(a.z1, b.z1) : Math.min(a.x1, b.x1);
  if (hi0 - lo0 < width + 2 * MIN_JAMB) throw new Error('rooms overlap too little for a straight corridor');
  const mid = (lo0 + hi0) / 2;
  const lo = mid - width / 2;
  const hi = mid + width / 2;
  if (alongX) {
    const [l, r] = a.x1 <= b.x0 ? [a, b] : [b, a];
    return rect(l.x1 - OVERLAP, lo, r.x0 + OVERLAP, hi);
  }
  const [d, u] = a.z1 <= b.z0 ? [a, b] : [b, a];
  return rect(lo, d.z1 - OVERLAP, hi, u.z0 + OVERLAP);
}

export function fixedLevel(): LevelDef {
  const rooms = new Map(ROOMS.map((r) => [r.id, r]));
  const shapes: ShapeDef[] = ROOMS.map((r) => ({
    shape: boxShape(r.rect),
    ref: { kind: 'node', node: r.id },
    module: r.id === ID.S ? 'start' : r.id === ID.EYE ? 'heart' : 'hall',
    height: r.height,
  }));
  for (const c of CORRIDORS) {
    shapes.push({
      shape: boxShape(corridorRect(rooms.get(c.a)!.rect, rooms.get(c.b)!.rect, c.width)),
      ref: { kind: 'edge', a: c.a, b: c.b },
      module: 'gallery',
      height: c.height,
    });
  }
  // START's west side: no corridor leaves it, and it is the farthest from the route's first opening.
  return { graph: GRAPH, shapes, startWall: { ax: -9, az: -11, bx: -9, bz: 11 } };
}
