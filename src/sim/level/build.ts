import { tuning } from '../../config/tuning';
import { yawTo } from '../player';
import { rect, type Point, type Rect, type Segment } from './geometry';
import { hasEdge } from './graph';
import type { Layout, LayoutRoom } from './layout';
import type { Area, Level, WallFace } from './level';

// Layout → Level (GDD §8): corridors between rooms, room sides minus openings
// become wall segments, lintels above openings, the white START wall, spawn
// and the green line. Straight corridors only; L-turns come with phase 7.

type Side = 'x0' | 'x1' | 'z0' | 'z1';
const SIDES: readonly Side[] = ['x0', 'x1', 'z0', 'z1'];

/** Least wall left between an opening and a room corner, meters. */
const MIN_JAMB = 0.5;

/** An opening in a room side, as an interval along the side. */
interface Opening {
  lo: number;
  hi: number;
  /** Corridor ceiling: the room wall above it is a lintel. */
  height: number;
}

interface PlacedCorridor {
  a: number;
  b: number;
  sideA: Side;
  sideB: Side;
  lo: number;
  hi: number;
}

function sideSegment(r: Rect, side: Side): Segment {
  switch (side) {
    case 'x0':
      return { ax: r.x0, az: r.z0, bx: r.x0, bz: r.z1 };
    case 'x1':
      return { ax: r.x1, az: r.z0, bx: r.x1, bz: r.z1 };
    case 'z0':
      return { ax: r.x0, az: r.z0, bx: r.x1, bz: r.z0 };
    case 'z1':
      return { ax: r.x0, az: r.z1, bx: r.x1, bz: r.z1 };
  }
}

/** Point on a side at coordinate `t` along it (z for x-sides, x for z-sides). */
function pointOnSide(r: Rect, side: Side, t: number): Point {
  if (side === 'x0') return { x: r.x0, z: t };
  if (side === 'x1') return { x: r.x1, z: t };
  if (side === 'z0') return { x: t, z: r.z0 };
  return { x: t, z: r.z1 };
}

function sideRange(r: Rect, side: Side): [number, number] {
  return side === 'x0' || side === 'x1' ? [r.z0, r.z1] : [r.x0, r.x1];
}

function inward(side: Side): Point {
  if (side === 'x0') return { x: 1, z: 0 };
  if (side === 'x1') return { x: -1, z: 0 };
  if (side === 'z0') return { x: 0, z: 1 };
  return { x: 0, z: -1 };
}

function center(r: Rect): Point {
  return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
}

/** Straight corridor between two rooms separated along x or z. */
function placeCorridor(a: Rect, b: Rect, width: number): { rect: Rect; sideA: Side; sideB: Side; lo: number; hi: number; alongX: boolean } {
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
    const aFirst = a.x1 <= b.x0;
    const r = aFirst ? rect(a.x1, lo, b.x0, hi) : rect(b.x1, lo, a.x0, hi);
    return { rect: r, sideA: aFirst ? 'x1' : 'x0', sideB: aFirst ? 'x0' : 'x1', lo, hi, alongX };
  }
  const aFirst = a.z1 <= b.z0;
  const r = aFirst ? rect(lo, a.z1, hi, b.z0) : rect(lo, b.z1, hi, a.z0);
  return { rect: r, sideA: aFirst ? 'z1' : 'z0', sideB: aFirst ? 'z0' : 'z1', lo, hi, alongX };
}

export function buildLevel(layout: Layout): Level {
  const { graph } = layout;
  const rooms = new Map<number, LayoutRoom>(layout.rooms.map((r) => [r.id, r]));
  const room = (id: number): LayoutRoom => {
    const r = rooms.get(id);
    if (!r) throw new Error(`room ${id} missing from layout`);
    return r;
  };
  const openings = new Map<number, Record<Side, Opening[]>>(layout.rooms.map((r) => [r.id, { x0: [], x1: [], z0: [], z1: [] }]));
  const areas: Area[] = layout.rooms.map((r) => ({ kind: 'room', rect: r.rect, height: r.height }));
  const walls: Segment[] = [];
  const faces: WallFace[] = [];
  const placed: PlacedCorridor[] = [];

  const addWall = (seg: Segment, y0: number, y1: number, kind: WallFace['kind'] = 'wall', solid = true) => {
    if (solid) walls.push(seg);
    if (y1 > y0) faces.push({ seg, y0, y1, kind });
  };

  for (const c of layout.corridors) {
    if (!hasEdge(graph, c.a, c.b)) throw new Error(`corridor ${c.a}-${c.b} is not a graph edge`);
    const p = placeCorridor(room(c.a).rect, room(c.b).rect, c.width);
    areas.push({ kind: 'corridor', rect: p.rect, height: c.height });
    openings.get(c.a)![p.sideA].push({ lo: p.lo, hi: p.hi, height: c.height });
    openings.get(c.b)![p.sideB].push({ lo: p.lo, hi: p.hi, height: c.height });
    placed.push({ a: c.a, b: c.b, sideA: p.sideA, sideB: p.sideB, lo: p.lo, hi: p.hi });
    const r = p.rect;
    const sides: Side[] = p.alongX ? ['z0', 'z1'] : ['x0', 'x1'];
    for (const s of sides) addWall(sideSegment(r, s), 0, c.height);
  }

  /** Opening midpoints on both rooms for the corridor from `a` to `b`. */
  const doorway = (a: number, b: number): [Point, Point] => {
    const p = placed.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
    if (!p) throw new Error(`no corridor ${a}-${b}`);
    const mid = (p.lo + p.hi) / 2;
    const onA = pointOnSide(room(p.a).rect, p.sideA, mid);
    const onB = pointOnSide(room(p.b).rect, p.sideB, mid);
    return p.a === a ? [onA, onB] : [onB, onA];
  };

  // Route: START centre → opening → opening → room centre → … → EYE (GDD §10).
  if (graph.route[0] !== graph.start || graph.route.at(-1) !== graph.eye) throw new Error('route must run START → EYE');
  const route: Point[] = [center(room(graph.start).rect)];
  for (let i = 0; i + 1 < graph.route.length; i++) {
    const [from, to] = doorway(graph.route[i]!, graph.route[i + 1]!);
    route.push(from, to, center(room(graph.route[i + 1]!).rect));
  }

  // START wall: a side without openings, farthest from the route's first opening.
  const startRoom = room(graph.start);
  const firstOpening = route[1] ?? center(startRoom.rect);
  let startSide: Side | null = null;
  let best = -Infinity;
  for (const s of SIDES) {
    if (openings.get(graph.start)![s].length > 0) continue;
    const seg = sideSegment(startRoom.rect, s);
    const d = Math.hypot((seg.ax + seg.bx) / 2 - firstOpening.x, (seg.az + seg.bz) / 2 - firstOpening.z);
    if (d > best) {
      best = d;
      startSide = s;
    }
  }
  if (!startSide) throw new Error('START room has no wall without openings');

  for (const r of layout.rooms) {
    for (const s of SIDES) {
      const [s0, s1] = sideRange(r.rect, s);
      const at = (t: number) => pointOnSide(r.rect, s, t);
      const piece = (t0: number, t1: number): Segment => {
        const p0 = at(t0);
        const p1 = at(t1);
        return { ax: p0.x, az: p0.z, bx: p1.x, bz: p1.z };
      };
      const kind = r.id === graph.start && s === startSide ? 'start' : 'wall';
      let cursor = s0;
      for (const o of [...openings.get(r.id)![s]].sort((p, q) => p.lo - q.lo)) {
        if (o.lo > cursor) addWall(piece(cursor, o.lo), 0, r.height, kind);
        addWall(piece(o.lo, o.hi), o.height, r.height, kind, false);
        cursor = o.hi;
      }
      if (s1 > cursor) addWall(piece(cursor, s1), 0, r.height, kind);
    }
  }

  const startWall = sideSegment(startRoom.rect, startSide);
  const n = inward(startSide);
  const d = tuning.start.SPAWN_DISTANCE;
  const sx = (startWall.ax + startWall.bx) / 2 + n.x * d;
  const sz = (startWall.az + startWall.bz) / 2 + n.z * d;

  return {
    graph,
    areas,
    walls,
    faces,
    startWall,
    spawn: { x: sx, z: sz, yaw: yawTo(firstOpening.x - sx, firstOpening.z - sz) },
    eye: center(room(graph.eye).rect),
    route,
  };
}
