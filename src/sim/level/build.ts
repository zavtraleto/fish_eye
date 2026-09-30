import { tuning } from '../../config/tuning';
import { yawTo } from '../look';
import { contour, edgeCrossing } from './contour';
import { closestOnSegment, segmentLength, type Point, type Rect, type Segment } from './geometry';
import type { LevelGraph } from './graph';
import type { FloorPiece, Level, ModuleKind, Portal, WallFace, Zone, ZoneRef } from './level';
import type { NavGrid } from './nav';
import { cellAt, cellCenter, frameAround, sampleNodes, type GridFrame } from './raster';
import { labelCells, sampleField, type Shape } from './shapes';
import { SegmentIndex } from './wallIndex';

// Skeleton shapes → Level (GDD §7 steps 8–11, §8): the free-space field on a
// raster, its contour as walls and floor, zones by the deepest shape in each
// cell, portals where zones meet, nav clearance, the white wall, spawn, route.

export interface ShapeDef {
  shape: Shape;
  ref: ZoneRef;
  module: ModuleKind;
  /** Ceiling; render only. */
  height: number;
}

export interface LevelDef {
  graph: LevelGraph;
  /** Shapes must overlap where they join: edges that only touch leave a zero-width wall. */
  shapes: readonly ShapeDef[];
  /** A straight side of the START shape with no portal on it (GDD §10). */
  startWall: Segment;
}

/** Rock around the shapes, meters. */
const MARGIN = 2;
/** Nav clearance is measured only this far, meters. */
const CLEARANCE_MAX = 8;
/** No portal of START may come this close to the white wall, meters. */
const START_WALL_GAP = 1;

export function refKey(r: ZoneRef): string {
  return r.kind === 'node' ? `n${r.node}` : `e${Math.min(r.a, r.b)}-${Math.max(r.a, r.b)}`;
}

function union(rects: readonly Rect[]): Rect {
  return {
    x0: Math.min(...rects.map((r) => r.x0)),
    z0: Math.min(...rects.map((r) => r.z0)),
    x1: Math.max(...rects.map((r) => r.x1)),
    z1: Math.max(...rects.map((r) => r.z1)),
  };
}

/** Per zone: its centroid if it lies deep enough inside it, else its deepest cell centre. One pass over the raster. */
function anchors(f: GridFrame, field: Float32Array, cellZone: Int16Array, count: number): Point[] {
  const sx = new Float64Array(count);
  const sz = new Float64Array(count);
  const cells = new Int32Array(count);
  const best = new Int32Array(count).fill(-1);
  const depth = new Float64Array(count).fill(-Infinity);
  for (let c = 0; c < cellZone.length; c++) {
    const z = cellZone[c]!;
    if (z < 0) continue;
    const p = cellCenter(f, c);
    sx[z] = sx[z]! + p.x;
    sz[z] = sz[z]! + p.z;
    cells[z] = cells[z]! + 1;
    const d = sampleNodes(f, field, p.x, p.z);
    if (d > depth[z]!) {
      depth[z] = d;
      best[z] = c;
    }
  }
  return Array.from({ length: count }, (_, z) => {
    if (!cells[z]) throw new Error(`zone ${z} has no floor`);
    const centroid = { x: sx[z]! / cells[z]!, z: sz[z]! / cells[z]! };
    const cc = cellAt(f, centroid.x, centroid.z);
    if (cc >= 0 && cellZone[cc] === z && sampleNodes(f, field, centroid.x, centroid.z) >= depth[z]! / 2) return centroid;
    return cellCenter(f, best[z]!);
  });
}

/** Open part of the grid edge between two nodes, or null if it is rock. */
function openSpan(f: GridFrame, field: Float32Array, ia: number, ja: number, ib: number, jb: number): [Point, Point] | null {
  const n = f.w + 1;
  const fa = field[ja * n + ia]! > 0;
  const fb = field[jb * n + ib]! > 0;
  const pa = { x: f.x0 + ia * f.cell, z: f.z0 + ja * f.cell };
  const pb = { x: f.x0 + ib * f.cell, z: f.z0 + jb * f.cell };
  if (fa && fb) return [pa, pb];
  if (!fa && !fb) return null;
  const x = edgeCrossing(f, field, ia, ja, ib, jb);
  return fa ? [pa, x] : [x, pb];
}

const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.z - q.z);

function onSegment(s: Segment, p: Point): boolean {
  return dist(closestOnSegment(s, p.x, p.z), p) < 1e-6;
}

export function buildLevel(def: LevelDef): Level {
  const { graph } = def;

  // One zone per graph reference, in first-shape order.
  const zoneByKey = new Map<string, number>();
  const zoneDefs: ShapeDef[] = [];
  const shapeZone = def.shapes.map((s) => {
    const k = refKey(s.ref);
    let z = zoneByKey.get(k);
    if (z === undefined) {
      z = zoneDefs.length;
      zoneByKey.set(k, z);
      zoneDefs.push(s);
    }
    return z;
  });
  const nodeZone = (id: number): number => {
    const z = zoneByKey.get(`n${id}`);
    if (z === undefined) throw new Error(`graph node ${id} has no shape`);
    return z;
  };

  const b = union(def.shapes.map((s) => s.shape.bounds));
  const frame = frameAround(b.x0, b.z0, b.x1, b.z1, tuning.gen.SDF_CELL, MARGIN);
  const shapes = def.shapes.map((s) => s.shape);
  const field = sampleField(shapes, frame);
  const owner = labelCells(shapes, frame);
  const { walls: edges, pieces } = contour(frame, field);

  const cellZone = new Int16Array(frame.w * frame.h).fill(-1);
  for (const p of pieces) {
    const o = owner[p.cell]!;
    if (o < 0) throw new Error(`open cell ${p.cell} outside every shape`);
    cellZone[p.cell] = shapeZone[o]!;
  }
  const anchorPoints = anchors(frame, field, cellZone, zoneDefs.length);
  const zones: Zone[] = zoneDefs.map((s, id) => ({ id, ref: s.ref, module: s.module, height: s.height, anchor: anchorPoints[id]! }));

  // Walls and the white wall.
  const walls: Segment[] = [];
  const faces: WallFace[] = [];
  let whiteLength = 0;
  for (const e of edges) {
    const zone = zones[cellZone[e.cell]!]!;
    const white = onSegment(def.startWall, { x: e.seg.ax, z: e.seg.az }) && onSegment(def.startWall, { x: e.seg.bx, z: e.seg.bz });
    if (white) whiteLength += segmentLength(e.seg);
    walls.push(e.seg);
    faces.push({ seg: e.seg, y0: 0, y1: zone.height, kind: white ? 'start' : 'wall', nx: e.nx, nz: e.nz });
  }
  // The contour cuts each corner by up to one cell.
  if (whiteLength < segmentLength(def.startWall) - 2 * frame.cell - 1e-6) throw new Error('the white wall is not on the contour');

  // Portals and ceiling steps along grid edges between cells of different zones.
  const spans = new Map<string, { a: number; b: number; pts: Point[]; mx: number; mz: number; len: number }>();
  for (let j = 0; j < frame.h; j++) {
    for (let i = 0; i < frame.w; i++) {
      const za = cellZone[j * frame.w + i]!;
      if (za < 0) continue;
      for (const [di, dj] of [
        [1, 0],
        [0, 1],
      ] as const) {
        if (i + di >= frame.w || j + dj >= frame.h) continue;
        const zb = cellZone[(j + dj) * frame.w + i + di]!;
        if (zb < 0 || zb === za) continue;
        // The shared edge: nodes (i+1, j)-(i+1, j+1) to the right, (i, j+1)-(i+1, j+1) above.
        const span = di ? openSpan(frame, field, i + 1, j, i + 1, j + 1) : openSpan(frame, field, i, j + 1, i + 1, j + 1);
        if (!span) continue;
        const [p, q] = span;
        const len = dist(p, q);
        const lo = Math.min(za, zb);
        const hi = Math.max(za, zb);
        const k = `${lo}-${hi}`;
        const s = spans.get(k) ?? { a: lo, b: hi, pts: [], mx: 0, mz: 0, len: 0 };
        s.pts.push(p, q);
        s.mx += ((p.x + q.x) / 2) * len;
        s.mz += ((p.z + q.z) / 2) * len;
        s.len += len;
        spans.set(k, s);
        const ha = zones[za]!.height;
        const hb = zones[zb]!.height;
        if (ha !== hb) faces.push({ seg: { ax: p.x, az: p.z, bx: q.x, bz: q.z }, y0: Math.min(ha, hb), y1: Math.max(ha, hb), kind: 'wall', nx: di, nz: dj });
      }
    }
  }
  const portals: Portal[] = [...spans.values()].map((s) => {
    const far = (from: Point) => s.pts.reduce((best, p) => (dist(p, from) > dist(best, from) ? p : best), s.pts[0]!);
    const p0 = far(s.pts[0]!);
    const p1 = far(p0);
    const mid = s.len > 0 ? { x: s.mx / s.len, z: s.mz / s.len } : { x: (p0.x + p1.x) / 2, z: (p0.z + p1.z) / 2 };
    return { a: s.a, b: s.b, p0, p1, mid };
  });
  const portal = (a: number, b: number): Portal | undefined => portals.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));

  // Every graph edge must open: room–corridor–room, or room–room directly.
  const hops = (u: number, v: number): Portal[] => {
    const e = zoneByKey.get(refKey({ kind: 'edge', a: u, b: v }));
    const zu = nodeZone(u);
    const zv = nodeZone(v);
    const list = e === undefined ? [portal(zu, zv)] : [portal(zu, e), portal(e, zv)];
    if (list.some((p) => !p)) throw new Error(`graph edge ${u}-${v} has no opening`);
    return list as Portal[];
  };
  for (const e of graph.edges) hops(e.a, e.b);

  const startZone = nodeZone(graph.start);
  for (const p of portals.filter((q) => q.a === startZone || q.b === startZone)) {
    for (const x of [p.p0, p.p1, p.mid]) {
      if (dist(closestOnSegment(def.startWall, x.x, x.z), x) < START_WALL_GAP) throw new Error('a portal opens in the white wall');
    }
  }

  // Route: START anchor → portals → anchors → … → EYE (GDD §10).
  if (graph.route[0] !== graph.start || graph.route.at(-1) !== graph.eye) throw new Error('route must run START → EYE');
  const route: Point[] = [zones[startZone]!.anchor];
  for (let i = 0; i + 1 < graph.route.length; i++) {
    for (const p of hops(graph.route[i]!, graph.route[i + 1]!)) route.push(p.mid);
    route.push(zones[nodeZone(graph.route[i + 1]!)]!.anchor);
  }

  // Spawn: SPAWN_DISTANCE off the white wall's middle, on the open side.
  const w = def.startWall;
  const wl = segmentLength(w);
  const d = tuning.start.SPAWN_DISTANCE;
  let nx = -(w.bz - w.az) / wl;
  let nz = (w.bx - w.ax) / wl;
  const mx = (w.ax + w.bx) / 2;
  const mz = (w.az + w.bz) / 2;
  if (sampleNodes(frame, field, mx + nx * d, mz + nz * d) <= 0) {
    nx = -nx;
    nz = -nz;
  }
  const sx = mx + nx * d;
  const sz = mz + nz * d;
  const next = route[1] ?? route[0]!;

  const wallIndex = new SegmentIndex(walls);
  const navFrame = frameAround(b.x0, b.z0, b.x1, b.z1, tuning.gen.NAV_CELL, MARGIN);
  const clearance = new Float32Array(navFrame.w * navFrame.h);
  for (let c = 0; c < clearance.length; c++) {
    const p = cellCenter(navFrame, c);
    if (sampleNodes(frame, field, p.x, p.z) > 0) clearance[c] = wallIndex.distance(p.x, p.z, CLEARANCE_MAX);
  }
  const nav: NavGrid = { frame: navFrame, clearance };
  const floor: FloorPiece[] = pieces.map((p) => ({ points: p.points, zone: cellZone[p.cell]! }));

  return {
    graph,
    zones,
    portals,
    frame,
    cellZone,
    walls,
    wallIndex,
    faces,
    floor,
    nav,
    startWall: def.startWall,
    spawn: { x: sx, z: sz, yaw: yawTo(next.x - sx, next.z - sz) },
    eye: zones[nodeZone(graph.eye)]!.anchor,
    route,
  };
}
