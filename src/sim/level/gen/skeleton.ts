import { tuning } from '../../../config/tuning';
import type { Rng } from '../../../core/rng';
import type { LevelDef, ShapeDef } from '../build';
import type { Point, Segment } from '../geometry';
import type { LevelGraph } from '../graph';
import { polygonShape, stripShape } from '../shapes';
import type { StructureGraph } from './structure';

// Structure graph → skeleton shapes (GDD §6, §7 step 7): each space a convex
// hall with no right angles, START a machine box whose white wall faces the
// widest empty sector, each passage a straight gallery or a throat from
// centre to centre. Flesh (stage 6.4) deforms this later.

const range = (rng: Rng, lo: number, hi: number) => lo + rng.next() * (hi - lo);

/** A convex polygon of irregular corners around c, radius about r. */
function hallPolygon(rng: Rng, c: Point, r: number): Point[] {
  const g = tuning.gen;
  const n = rng.int(g.HALL_CORNERS_MIN, g.HALL_CORNERS_MAX);
  const step = (2 * Math.PI) / n;
  const turn = rng.next() * step;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = turn + i * step + (rng.next() - 0.5) * step * 0.7;
    const d = r * range(rng, 0.8, 1.1);
    return { x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d };
  });
  return convexHull(pts);
}

/** Andrew's monotone chain. */
function convexHull(pts: Point[]): Point[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const half = (list: Point[]) => {
    const out: Point[] = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

/** Direction (radians) in the middle of the widest gap between the given directions. */
function widestGap(angles: number[]): number {
  const a = [...angles].sort((x, y) => x - y);
  let best = 0;
  let mid = 0;
  for (let i = 0; i < a.length; i++) {
    const from = a[i]!;
    const to = i + 1 < a.length ? a[i + 1]! : a[0]! + 2 * Math.PI;
    if (to - from > best) {
      best = to - from;
      mid = from + best / 2;
    }
  }
  return mid;
}

/** The START box: its back side is the white wall (GDD §10), facing away from every passage. */
function startBox(c: Point, back: number): { pts: Point[]; wall: Segment } {
  const g = tuning.gen;
  const w = Math.max(g.START_WIDTH, g.START_WALL_MIN + 2 * g.SDF_CELL) / 2;
  const d = g.START_DEPTH / 2;
  const nx = Math.cos(back);
  const nz = Math.sin(back);
  const at = (u: number, v: number) => ({ x: c.x + nx * u - nz * v, z: c.z + nz * u + nx * v });
  const pts = [at(d, -w), at(d, w), at(-d, w), at(-d, -w)];
  return { pts, wall: { ax: pts[0]!.x, az: pts[0]!.z, bx: pts[1]!.x, bz: pts[1]!.z } };
}

export function skeletonDef(rng: Rng, s: StructureGraph): LevelDef {
  const g = tuning.gen;
  const pos = (id: number) => s.points[id]!;
  const graph: LevelGraph = {
    rooms: s.nodes.map((id) => ({ id, x: pos(id).x, z: pos(id).z })),
    edges: s.edges,
    start: s.start,
    eye: s.heart,
    route: s.route,
  };
  const shapes: ShapeDef[] = [];
  let startWall: Segment | null = null;

  for (const id of s.nodes) {
    const c = pos(id);
    let nearest = Infinity;
    for (const o of s.nodes) if (o !== id) nearest = Math.min(nearest, Math.hypot(pos(o).x - c.x, pos(o).z - c.z));
    if (id === s.start) {
      const dirs = s.edges.filter((e) => e.a === id || e.b === id).map((e) => {
        const o = pos(e.a === id ? e.b : e.a);
        return Math.atan2(o.z - c.z, o.x - c.x);
      });
      const box = startBox(c, widestGap(dirs));
      startWall = box.wall;
      shapes.push({ shape: polygonShape(box.pts), ref: { kind: 'node', node: id }, module: 'start', height: g.START_HEIGHT });
    } else if (id === s.heart) {
      shapes.push({ shape: polygonShape(hallPolygon(rng, c, nearest * g.HEART_SIZE)), ref: { kind: 'node', node: id }, module: 'heart', height: g.HEART_HEIGHT });
    } else {
      const r = nearest * range(rng, g.HALL_SIZE_MIN, g.HALL_SIZE_MAX);
      shapes.push({ shape: polygonShape(hallPolygon(rng, c, r)), ref: { kind: 'node', node: id }, module: 'hall', height: range(rng, g.HALL_HEIGHT_MIN, g.HALL_HEIGHT_MAX) });
    }
  }

  for (const e of s.edges) {
    const throat = rng.next() < g.THROAT_CHANCE;
    const width = throat ? range(rng, g.THROAT_WIDTH_MIN, g.THROAT_WIDTH_MAX) : range(rng, g.GALLERY_WIDTH_MIN, g.GALLERY_WIDTH_MAX);
    shapes.push({
      shape: stripShape(pos(e.a), pos(e.b), width),
      ref: { kind: 'edge', a: e.a, b: e.b },
      module: throat ? 'throat' : 'gallery',
      height: throat ? g.THROAT_HEIGHT : range(rng, g.GALLERY_HEIGHT_MIN, g.GALLERY_HEIGHT_MAX),
    });
  }

  if (!startWall) throw new Error('structure has no START');
  return { graph, shapes, startWall };
}
