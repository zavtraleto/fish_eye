import { tuning } from '../../config/tuning';
import { yawTo } from '../look';
import { contour, edgeCrossing } from './contour';
import { closestOnSegment, segmentLength, type Point, type Rect, type Segment } from './geometry';
import { hasEdge, type LevelGraph } from './graph';
import type { FloorPiece, Level, ModuleKind, Portal, WallFace, Zone, ZoneRef } from './level';
import { NavField, type NavGrid } from './nav';
import { lineOfSight } from './query';
import { cellCenter, frameAround, sampleNodes, type GridFrame } from './raster';
import { openRockIslands } from './rock';
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
  /** Flesh (GDD §6): rewrites the open field in place, returns the flesh density per node (render tint). */
  deform?: (frame: GridFrame, field: Float32Array) => Float32Array;
}

/** Rock around the shapes, meters. */
const MARGIN = 2;
/** Nav clearance is measured only this far, meters: past the widest body that asks. */
const CLEARANCE_MAX = 4;
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

/**
 * Per zone, a point deep inside and central: of the cells at least 90% as deep
 * as the deepest, the one nearest the centroid (a bent passage's centroid can
 * sit at its inner corner). Null for a zone with no floor. Two passes over the raster.
 */
function anchors(f: GridFrame, field: Float32Array, cellZone: Int16Array, count: number): (Point | null)[] {
  const sx = new Float64Array(count);
  const sz = new Float64Array(count);
  const cells = new Int32Array(count);
  const depthMax = new Float64Array(count).fill(-Infinity);
  const depth = new Float32Array(cellZone.length);
  for (let c = 0; c < cellZone.length; c++) {
    const z = cellZone[c]!;
    if (z < 0) continue;
    const p = cellCenter(f, c);
    sx[z] = sx[z]! + p.x;
    sz[z] = sz[z]! + p.z;
    cells[z] = cells[z]! + 1;
    depth[c] = sampleNodes(f, field, p.x, p.z);
    depthMax[z] = Math.max(depthMax[z]!, depth[c]!);
  }
  const best = new Int32Array(count).fill(-1);
  const bestDist = new Float64Array(count).fill(Infinity);
  for (let c = 0; c < cellZone.length; c++) {
    const z = cellZone[c]!;
    if (z < 0 || depth[c]! < depthMax[z]! * 0.9) continue;
    const p = cellCenter(f, c);
    const d = Math.hypot(p.x - sx[z]! / cells[z]!, p.z - sz[z]! / cells[z]!);
    if (d < bestDist[z]!) {
      bestDist[z] = d;
      best[z] = c;
    }
  }
  return Array.from({ length: count }, (_, z) => (cells[z] ? cellCenter(f, best[z]!) : null));
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

/** Keeps the green line this far from walls where it has to bend, meters. */
const ROUTE_CLEARANCE = 1.5;

/**
 * Points after `from` up to `to`: just `to` if the way is clear, else a path
 * over the nav raster pulled taut (each step to the farthest visible cell).
 */
function detour(nav: NavGrid, walls: SegmentIndex, from: Point, to: Point): Point[] {
  if (lineOfSight(walls, from, to, 0.5)) return [to];
  const field = new NavField(nav);
  field.build(to.x, to.z, from.x, from.z, ROUTE_CLEARANCE);
  const cells = field.descend(from.x, from.z, Infinity).map((c) => cellCenter(nav.frame, c));
  if (!cells.length) throw new Error('the green line finds no way');
  const out: Point[] = [];
  let at = from;
  let i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !lineOfSight(walls, at, cells[j]!, 0.5)) j--;
    at = cells[j]!;
    out.push(at);
    i = j + 1;
    if (lineOfSight(walls, at, to, 0.5)) break;
  }
  out.push(to);
  return out;
}

function onSegment(s: Segment, p: Point): boolean {
  return dist(closestOnSegment(s, p.x, p.z), p) < 1e-4;
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
  openRockIslands(frame, field, tuning.gen.ROCK_MIN_AREA, tuning.gen.ROCK_MIN_THICKNESS);
  const density = def.deform ? def.deform(frame, field) : null;
  // Growths are not islands to open; anything else the flesh cut off is.
  if (def.deform) openRockIslands(frame, field, tuning.gen.ROCK_MIN_AREA * 0.25, tuning.gen.ROCK_MIN_THICKNESS * 0.5);
  const owner = labelCells(shapes, frame);
  const { walls: edges, pieces } = contour(frame, field);

  const cellZone = new Int16Array(frame.w * frame.h).fill(-1);
  for (const p of pieces) {
    // An opened rock island can lie beyond every shape's reach: take a nearby owner.
    let o = owner[p.cell]!;
    for (let r = 1; o < 0 && r <= 8; r++) {
      const i = p.cell % frame.w;
      const j = (p.cell - i) / frame.w;
      for (let dj = -r; dj <= r && o < 0; dj++) {
        for (let di = -r; di <= r && o < 0; di++) {
          const a = i + di;
          const b = j + dj;
          if (a >= 0 && b >= 0 && a < frame.w && b < frame.h) o = owner[b * frame.w + a]!;
        }
      }
    }
    if (o < 0) throw new Error(`open cell ${p.cell} outside every shape`);
    cellZone[p.cell] = shapeZone[o]!;
  }
  // A passage the halls swallow whole leaves no floor: its halls open to each other directly.
  const anchorPoints = anchors(frame, field, cellZone, zoneDefs.length);
  zoneDefs.forEach((s, id) => {
    if (!anchorPoints[id] && s.ref.kind === 'node') throw new Error(`space ${s.ref.node} has no floor`);
  });
  // Drop them and renumber the rest.
  const renumber = new Int16Array(zoneDefs.length).fill(-1);
  const zones: Zone[] = [];
  zoneDefs.forEach((s, old) => {
    const anchor = anchorPoints[old];
    if (!anchor) return;
    renumber[old] = zones.length;
    zones.push({ id: zones.length, ref: s.ref, module: s.module, height: s.height, anchor });
  });
  for (let c = 0; c < cellZone.length; c++) if (cellZone[c]! >= 0) cellZone[c] = renumber[cellZone[c]!]!;
  for (const [k, old] of zoneByKey) {
    if (renumber[old]! >= 0) zoneByKey.set(k, renumber[old]!);
    else zoneByKey.delete(k);
  }

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
  // The contour cuts each corner by up to two cells when the wall is not axis-aligned;
  // a passage through the wall takes far more (MIN_CLEARANCE).
  if (whiteLength < segmentLength(def.startWall) - 4 * frame.cell - 1e-6) throw new Error('the white wall is not on the contour');

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
  // No passage the graph does not have (GDD §7 step 9): zones may meet only if they share a node.
  // Flesh may eat through a thin wall (GDD §6): such extra openings stay, off the graph —
  // the green line and spawns use the skeleton's passages, the enemy's raster uses them all.
  const ends = (r: ZoneRef) => (r.kind === 'node' ? [r.node] : [r.a, r.b]);
  let extra = 0;
  for (const p of portals) {
    const ra = zones[p.a]!.ref;
    const rb = zones[p.b]!.ref;
    const ok = ra.kind === 'node' && rb.kind === 'node' ? hasEdge(graph, ra.node, rb.node) : ends(ra).some((n) => ends(rb).includes(n));
    if (ok) continue;
    if (!def.deform) throw new Error(`zones ${refKey(ra)} and ${refKey(rb)} meet, but the graph has no such passage`);
    extra++;
  }

  // Every graph edge must open: room–corridor–room, or room–room directly.
  /**
   * The portals from space u to space v: fewest hops through u, v and the
   * passages that leave either — a passage's mouth may be taken by a
   * neighbouring passage of the same hall.
   */
  const hops = (u: number, v: number): Portal[] => {
    const zu = nodeZone(u);
    const zv = nodeZone(v);
    const allowed = (z: number) => {
      const r = zones[z]!.ref;
      return z === zu || z === zv || (r.kind === 'edge' && (r.a === u || r.b === u || r.a === v || r.b === v));
    };
    const via = new Map<number, Portal | null>([[zu, null]]);
    const queue = [zu];
    for (let h = 0; h < queue.length && !via.has(zv); h++) {
      const z = queue[h]!;
      for (const p of portals) {
        const next = p.a === z ? p.b : p.b === z ? p.a : -1;
        if (next < 0 || via.has(next) || !allowed(next)) continue;
        via.set(next, p);
        queue.push(next);
      }
    }
    if (!via.has(zv)) throw new Error(`graph edge ${u}-${v} has no opening`);
    const out: Portal[] = [];
    for (let z = zv; z !== zu; ) {
      const p = via.get(z)!;
      out.unshift(p);
      z = p.a === z ? p.b : p.a;
    }
    return out;
  };
  for (const e of graph.edges) hops(e.a, e.b);

  const startZone = nodeZone(graph.start);
  for (const p of portals.filter((q) => q.a === startZone || q.b === startZone)) {
    for (const x of [p.p0, p.p1, p.mid]) {
      if (dist(closestOnSegment(def.startWall, x.x, x.z), x) < START_WALL_GAP) throw new Error('a portal opens in the white wall');
    }
  }

  const wallIndex = new SegmentIndex(walls);
  const navFrame = frameAround(b.x0, b.z0, b.x1, b.z1, tuning.gen.NAV_CELL, MARGIN);
  const clearance = new Float32Array(navFrame.w * navFrame.h);
  for (let c = 0; c < clearance.length; c++) {
    const p = cellCenter(navFrame, c);
    // The union field is a lower bound of the distance to the walls (it reads low where shapes
    // overlap): deep enough is enough, else measure exactly.
    const depth = sampleNodes(frame, field, p.x, p.z);
    if (depth > 0) clearance[c] = depth >= CLEARANCE_MAX ? CLEARANCE_MAX : wallIndex.distance(p.x, p.z, CLEARANCE_MAX);
  }
  const nav: NavGrid = { frame: navFrame, clearance };

  // Route: START anchor → portals → anchors → … → EYE (GDD §10); where two
  // stops do not see each other (a bend), the line follows the nav raster.
  if (graph.route[0] !== graph.start || graph.route.at(-1) !== graph.eye) throw new Error('route must run START → EYE');
  const stops: Point[] = [zones[startZone]!.anchor];
  for (let i = 0; i + 1 < graph.route.length; i++) {
    for (const p of hops(graph.route[i]!, graph.route[i + 1]!)) stops.push(p.mid);
    stops.push(zones[nodeZone(graph.route[i + 1]!)]!.anchor);
  }
  const route: Point[] = [stops[0]!];
  for (let i = 1; i < stops.length; i++) route.push(...detour(nav, wallIndex, route[route.length - 1]!, stops[i]!));
  for (let i = 0; i + 1 < route.length; i++) if (!lineOfSight(wallIndex, route[i]!, route[i + 1]!)) throw new Error('the green line crosses a wall');

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
    density,
    extraOpenings: extra,
    nav,
    startWall: def.startWall,
    spawn: { x: sx, z: sz, yaw: yawTo(next.x - sx, next.z - sz) },
    eye: zones[nodeZone(graph.eye)]!.anchor,
    route,
  };
}
