import { tuning } from '../../../config/tuning';
import type { Rng } from '../../../core/rng';
import type { LevelDef, ShapeDef } from '../build';
import type { Point, Segment } from '../geometry';
import type { LevelGraph } from '../graph';
import type { ModuleKind, ZoneRef } from '../level';
import { polygonShape, stripShape } from '../shapes';
import { noiseField, type Field } from './noise';
import type { StructureGraph } from './structure';

// Structure graph → skeleton shapes (GDD §6, §7 step 7). A "kind" field over
// the plan decides the local language: machine — right angles snapped to a
// local grid orientation, rectangles and crosses, orthogonal L/Z passages;
// flesh-kin — free convex halls or clumps of them, passages that wander.
// Passages vary in width along their legs, from throats to naves; some halls
// fuse through a wide opening instead of a gallery. START is a machine box
// whose white wall faces the widest empty sector. Flesh (stage 6.4) deforms this.

const range = (rng: Rng, lo: number, hi: number) => lo + rng.next() * (hi - lo);
const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.z - a.z);

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

/** A convex polygon of irregular corners around c, radius about r. */
function blob(rng: Rng, c: Point, r: number): Point[] {
  const g = tuning.gen;
  const n = rng.int(g.HALL_CORNERS_MIN, g.HALL_CORNERS_MAX);
  const step = (2 * Math.PI) / n;
  const turn = rng.next() * step;
  return convexHull(
    Array.from({ length: n }, (_, i) => {
      const a = turn + i * step + (rng.next() - 0.5) * step * 0.7;
      const d = r * range(rng, 0.8, 1.1);
      return { x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d };
    }),
  );
}

/** A rectangle centred on c, half-sizes hu along angle th and hv across. */
function rect(c: Point, th: number, hu: number, hv: number): Point[] {
  const ux = Math.cos(th);
  const uz = Math.sin(th);
  const at = (u: number, v: number) => ({ x: c.x + ux * u - uz * v, z: c.z + uz * u + ux * v });
  return [at(hu, -hv), at(hu, hv), at(-hu, hv), at(-hu, -hv)];
}

/** Machine hall: a rectangle whose diagonal is r, or a cross / L of two such (GDD §6: right angles). */
function machineHall(rng: Rng, c: Point, r: number, th: number): Point[][] {
  const phi = range(rng, 0.45, 0.78);
  const a = rect(c, th, r * Math.cos(phi), r * Math.sin(phi));
  if (rng.next() >= tuning.gen.CROSS_CHANCE) return [a];
  // A second arm across the first, shifted along it: a cross, a T or an L.
  const phi2 = range(rng, 0.25, 0.5);
  const shift = (rng.next() - 0.5) * r * 0.6;
  const c2 = { x: c.x + Math.cos(th) * shift, z: c.z + Math.sin(th) * shift };
  return [a, rect(c2, th + Math.PI / 2, r * Math.cos(phi2), r * Math.sin(phi2))];
}

/** Flesh-kin hall: one free convex polygon, or a clump of two or three (GDD §6: asymmetry). */
function organicHall(rng: Rng, c: Point, r: number): Point[][] {
  if (rng.next() >= tuning.gen.CLUMP_CHANCE) return [blob(rng, c, r)];
  const parts = [blob(rng, c, r * 0.8)];
  const extra = rng.int(1, 2);
  for (let i = 0; i < extra; i++) {
    const a = rng.next() * Math.PI * 2;
    const d = r * range(rng, 0.25, 0.45);
    parts.push(blob(rng, { x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d }, r * range(rng, 0.45, 0.65)));
  }
  return parts;
}

/** A module's shapes: open space, and rock carved out of it. */
interface Parts {
  open: Point[][];
  solid: Point[][];
}

/** A near-regular polygon: cores, pillars, blobs of a honeycomb. */
function roundish(rng: Rng, c: Point, r: number, corners = 12): Point[] {
  const turn = rng.next() * Math.PI;
  return Array.from({ length: corners }, (_, i) => {
    const a = turn + (i * 2 * Math.PI) / corners;
    const d = r * range(rng, 0.92, 1.05);
    return { x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d };
  });
}

/** Rotunda (GDD §6): a hall around a massive core; the ring lets one circle the enemy. */
function rotunda(rng: Rng, c: Point, r: number): Parts {
  const core = Math.max(tuning.gen.ROTUNDA_CORE_MIN, r * 0.35);
  return { open: [roundish(rng, c, r, 16)], solid: [roundish(rng, c, core)] };
}

/**
 * Colonnade (GDD §6): a machine hall with a grid of massive square pillars on
 * the local grid, the centre in a gap; the rhythm breaks — one pillar missing
 * or shifted.
 */
function colonnade(rng: Rng, c: Point, r: number, th: number): Parts {
  const g = tuning.gen;
  const phi = range(rng, 0.6, 0.78);
  const hu = r * Math.cos(phi);
  const hv = r * Math.sin(phi);
  const pitch = g.PILLAR_SIZE + g.PILLAR_GAP;
  const ux = Math.cos(th);
  const uz = Math.sin(th);
  const pillars: Point[][] = [];
  const reach = (h: number) => Math.floor((h - g.PILLAR_GAP - g.PILLAR_SIZE / 2) / pitch - 0.5);
  const nu = reach(hu);
  const nv = reach(hv);
  const cells: [number, number][] = [];
  for (let a = -nu - 1; a <= nu; a++) for (let b = -nv - 1; b <= nv; b++) cells.push([a, b]);
  const broken = cells.length ? rng.int(0, cells.length - 1) : -1;
  const shift = rng.next() < 0.5;
  cells.forEach(([a, b], k) => {
    if (k === broken && !shift) return;
    let u = (a + 0.5) * pitch;
    let v = (b + 0.5) * pitch;
    if (k === broken) {
      u += pitch * 0.3;
      v -= pitch * 0.2;
    }
    const p = { x: c.x + ux * u - uz * v, z: c.z + uz * u + ux * v };
    pillars.push(rect(p, th, g.PILLAR_SIZE / 2, g.PILLAR_SIZE / 2));
  });
  return { open: [rect(c, th, hu, hv)], solid: pillars };
}

/** Honeycomb (GDD §6): a flesh-kin hall crowded with rounded masses — a hive to thread through. */
function honeycomb(rng: Rng, c: Point, r: number): Parts {
  const g = tuning.gen;
  const blobs: { p: Point; r: number }[] = [];
  for (let t = 0; t < 80; t++) {
    const br = range(rng, g.HIVE_BLOB_MIN, g.HIVE_BLOB_MAX);
    const a = rng.next() * Math.PI * 2;
    const d = Math.sqrt(rng.next()) * (r - br - g.PILLAR_GAP);
    if (d < 0) continue;
    const p = { x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d };
    // The centre stays open: it is the hall's anchor and where passages arrive.
    if (Math.hypot(p.x - c.x, p.z - c.z) < br + g.PILLAR_GAP) continue;
    if (blobs.some((o) => Math.hypot(o.p.x - p.x, o.p.z - p.z) < o.r + br + g.PILLAR_GAP)) continue;
    blobs.push({ p, r: br });
  }
  return { open: [blob(rng, c, r)], solid: blobs.map((o) => roundish(rng, o.p, o.r, 10)) };
}

/**
 * Niches (GDD §6): a row of identical recesses along a long straight wall,
 * outward from the side a → b; one breaks the rhythm — wider, deeper or missing.
 */
function niches(rng: Rng, a: Point, b: Point, inward: Point): Point[][] {
  const g = tuning.gen;
  const len = dist(a, b);
  const count = Math.floor((len - 6) / g.NICHE_PITCH);
  if (count < 2 || rng.next() >= g.NICHE_CHANCE) return [];
  const ux = (b.x - a.x) / len;
  const uz = (b.z - a.z) / len;
  // Outward: away from the space's inside.
  let nx = -uz;
  let nz = ux;
  if ((inward.x - a.x) * nx + (inward.z - a.z) * nz > 0) {
    nx = -nx;
    nz = -nz;
  }
  const odd = rng.int(0, count - 1);
  const oddKind = rng.int(0, 2);
  const out: Point[][] = [];
  const start = (len - (count - 1) * g.NICHE_PITCH) / 2;
  for (let i = 0; i < count; i++) {
    let w = g.NICHE_WIDTH;
    let depth = g.NICHE_DEPTH;
    if (i === odd) {
      if (oddKind === 0) continue;
      if (oddKind === 1) w *= 2;
      else depth *= 1.8;
    }
    const t = start + i * g.NICHE_PITCH;
    const cx = a.x + ux * t;
    const cz = a.z + uz * t;
    // Half a meter into the space too: shapes must overlap where they join.
    const at = (u: number, n: number) => ({ x: cx + ux * u + nx * n, z: cz + uz * u + nz * n });
    out.push([at(-w / 2, -0.5), at(w / 2, -0.5), at(w / 2, depth), at(-w / 2, depth)]);
  }
  return out;
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
  const w = Math.max(g.START_WIDTH, g.START_WALL_MIN + 4 * g.SDF_CELL) / 2;
  const pts = rect(c, back, g.START_DEPTH / 2, w);
  return { pts, wall: { ax: pts[0]!.x, az: pts[0]!.z, bx: pts[1]!.x, bz: pts[1]!.z } };
}

/** Machine passage a → b: straight if nearly on the local grid, else an L or a Z along it. */
function machinePath(rng: Rng, a: Point, b: Point, th: number): Point[] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const ux = Math.cos(th);
  const uz = Math.sin(th);
  let du = dx * ux + dz * uz;
  let dv = -dx * uz + dz * ux;
  // Along the grid axis closer to the passage first.
  let [ax, az] = [ux, uz];
  let [bx, bz] = [-uz, ux];
  if (Math.abs(dv) > Math.abs(du)) {
    [du, dv] = [dv, du];
    [ax, az, bx, bz] = [bx, bz, ax, az];
  }
  const leg = tuning.gen.MIN_LEG;
  if (Math.abs(dv) < leg) return [a, b];
  if (rng.next() < 0.5 || Math.abs(du) < 2 * leg) {
    const c = { x: a.x + ax * du, z: a.z + az * du };
    return [a, c, b];
  }
  const t = range(rng, 0.3, 0.7);
  const c1 = { x: a.x + ax * du * t, z: a.z + az * du * t };
  return [a, c1, { x: c1.x + bx * dv, z: c1.z + bz * dv }, b];
}

/** Flesh-kin passage a → b: one or two bends pushed sideways, at free angles. */
function organicPath(rng: Rng, a: Point, b: Point): Point[] {
  const len = dist(a, b);
  const nx = -(b.z - a.z) / len;
  const nz = (b.x - a.x) / len;
  const bends = rng.int(1, 2);
  const out = [a];
  let side = rng.next() < 0.5 ? -1 : 1;
  for (let i = 1; i <= bends; i++) {
    const t = i / (bends + 1) + (rng.next() - 0.5) * 0.15;
    const off = side * len * range(rng, tuning.gen.BEND_MIN, tuning.gen.BEND_MAX);
    out.push({ x: a.x + (b.x - a.x) * t + nx * off, z: a.z + (b.z - a.z) * t + nz * off });
    side = -side;
  }
  out.push(b);
  return out;
}

/** Distance from p to the polyline. */
function toPath(path: readonly Point[], p: Point): number {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t));
  }
  return best;
}

/** A regular polygon around c: the joint at a bend, so legs of different widths meet cleanly. */
function joint(c: Point, r: number, th: number, square: boolean): Point[] {
  if (square) return rect(c, th, r, r);
  return Array.from({ length: 8 }, (_, i) => ({ x: c.x + Math.cos(th + (i * Math.PI) / 4) * r, z: c.z + Math.sin(th + (i * Math.PI) / 4) * r }));
}

export function skeletonDef(rng: Rng, s: StructureGraph): LevelDef {
  const g = tuning.gen;
  const kind: Field = noiseField(rng, g.KIND_SCALE);
  const grid: Field = noiseField(rng, g.GRID_SCALE);
  /** Local grid orientation of machine parts: whole districts share it, districts differ. */
  const snap = (p: Point) => Math.round((grid(p.x, p.z) * Math.PI) / ((g.GRID_SNAP * Math.PI) / 180)) * ((g.GRID_SNAP * Math.PI) / 180);
  const machine = (p: Point) => kind(p.x, p.z) < 0.5;

  const pos = (id: number) => s.points[id]!;
  const graph: LevelGraph = {
    rooms: s.nodes.map((id) => ({ id, x: pos(id).x, z: pos(id).z })),
    edges: s.edges,
    start: s.start,
    eye: s.heart,
    route: s.route,
  };
  const adjacent = (a: number, b: number) => s.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  const shapes: ShapeDef[] = [];
  const push = (pts: Point[], ref: ZoneRef, module: ModuleKind, height: number) => shapes.push({ shape: polygonShape(pts), ref, module, height });
  let startWall: Segment | null = null;
  /** Where START's passages leave: the front of its box, so none grazes the white wall behind. */
  let startMouth: Point | null = null;

  // Hall radius: a share of the nearest space, kept clear of spaces it does not open to.
  const radius = new Map<number, number>();
  for (const id of s.nodes) {
    const c = pos(id);
    let nearest = Infinity;
    let nearestOther = Infinity;
    for (const o of s.nodes) {
      if (o === id) continue;
      const d = dist(c, pos(o));
      nearest = Math.min(nearest, d);
      if (!adjacent(id, o)) nearestOther = Math.min(nearestOther, d);
    }
    const share = id === s.heart ? g.HEART_SIZE : range(rng, g.HALL_SIZE_MIN, g.HALL_SIZE_MAX);
    radius.set(id, Math.min(share * nearest, g.HALL_CLEARANCE * nearestOther));
  }
  // START is a fixed box; no hall may reach its white wall.
  const startReach = Math.hypot(g.START_DEPTH / 2, Math.max(g.START_WIDTH, g.START_WALL_MIN + 4 * g.SDF_CELL) / 2);
  radius.set(s.start, startReach);
  for (const id of s.nodes) {
    if (id !== s.start) radius.set(id, Math.min(radius.get(id)!, dist(pos(id), pos(s.start)) - startReach - 3));
  }

  for (const id of s.nodes) {
    const c = pos(id);
    const r = radius.get(id)!;
    const ref: ZoneRef = { kind: 'node', node: id };
    if (id === s.start) {
      const dirs = s.edges.filter((e) => e.a === id || e.b === id).map((e) => {
        const o = pos(e.a === id ? e.b : e.a);
        return Math.atan2(o.z - c.z, o.x - c.x);
      });
      const back = widestGap(dirs);
      const box = startBox(c, back);
      startWall = box.wall;
      const f = g.START_DEPTH / 2 - 3;
      startMouth = { x: c.x - Math.cos(back) * f, z: c.z - Math.sin(back) * f };
      push(box.pts, ref, 'start', g.START_HEIGHT);
      continue;
    }
    const height = id === s.heart ? g.HEART_HEIGHT : range(rng, g.HALL_HEIGHT_MIN, g.HALL_HEIGHT_MAX);
    if (id === s.heart) {
      for (const p of organicHall(rng, c, r)) push(p, ref, 'heart', height);
      continue;
    }
    // Which module (GDD §6): rotundas anywhere roomy, colonnades in machine districts, honeycombs in flesh-kin ones.
    const roll = rng.next();
    const th = snap(c);
    let module: ModuleKind = 'hall';
    let parts: Parts;
    if (r >= g.ROTUNDA_MIN_RADIUS && roll < g.ROTUNDA_CHANCE) {
      module = 'rotunda';
      parts = rotunda(rng, c, r);
    } else if (machine(c) && r >= g.COLONNADE_MIN_RADIUS && roll < g.ROTUNDA_CHANCE + g.COLONNADE_CHANCE) {
      module = 'colonnade';
      parts = colonnade(rng, c, r, th);
    } else if (!machine(c) && r >= g.HIVE_MIN_RADIUS && roll < g.ROTUNDA_CHANCE + g.HIVE_CHANCE) {
      module = 'honeycomb';
      parts = honeycomb(rng, c, r);
    } else {
      parts = { open: machine(c) ? machineHall(rng, c, r, th) : organicHall(rng, c, r), solid: [] };
    }
    for (const p of parts.open) push(p, ref, module, height);
    // Machine rooms get niches along their long straight sides.
    if (machine(c) && module !== 'rotunda') {
      for (const p of parts.open) {
        for (let i = 0; i < p.length; i++) for (const n of niches(rng, p[i]!, p[(i + 1) % p.length]!, c)) push(n, ref, module, height);
      }
    }
    for (const p of parts.solid) shapes.push({ shape: polygonShape(p), ref, module, height, solid: true });
  }

  const end = (id: number) => (id === s.start && startMouth ? startMouth : pos(id));
  for (const e of s.edges) {
    const a = end(e.a);
    const b = end(e.b);
    const ref: ZoneRef = { kind: 'edge', a: e.a, b: e.b };
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const gap = dist(a, b) - radius.get(e.a)! - radius.get(e.b)!;
    // Close halls sometimes fuse through a wide mouth instead of a gallery.
    if (e.a !== s.start && e.b !== s.start && gap < g.FUSE_GAP && rng.next() < g.FUSE_CHANCE) {
      const w = 1.4 * Math.min(radius.get(e.a)!, radius.get(e.b)!);
      shapes.push({ shape: stripShape(a, b, w), ref, module: 'hall', height: range(rng, g.HALL_HEIGHT_MIN, g.HALL_HEIGHT_MAX) });
      continue;
    }
    const roll = rng.next();
    const throat = roll < g.THROAT_CHANCE;
    const nave = !throat && roll < g.THROAT_CHANCE + g.NAVE_CHANCE;
    const [lo, hi] = throat ? [g.THROAT_WIDTH_MIN, g.THROAT_WIDTH_MAX] : nave ? [g.NAVE_WIDTH_MIN, g.NAVE_WIDTH_MAX] : [g.GALLERY_WIDTH_MIN, g.GALLERY_WIDTH_MAX];
    const touchesStart = e.a === s.start || e.b === s.start;
    // START's passages stay narrower than its box: a wide one would reach the white wall.
    const want = Math.min(range(rng, lo, hi), touchesStart ? g.START_WIDTH * 0.6 : Infinity);
    const height = throat ? g.THROAT_HEIGHT : range(rng, g.GALLERY_HEIGHT_MIN, g.GALLERY_HEIGHT_MAX) * (nave ? 1.6 : 1);
    const module: ModuleKind = throat ? 'throat' : 'gallery';
    const square = machine(mid);
    const th = snap(mid);
    /** The widest this path may be and still keep clear of every other space. */
    const room = (path: Point[]) => {
      let half = Infinity;
      for (const n of s.nodes) if (n !== e.a && n !== e.b) half = Math.min(half, toPath(path, pos(n)) - radius.get(n)! * 1.2 - 2);
      return (2 * half) / (1 + g.WIDTH_VARIATION);
    };
    // A bend must leave room for the passage; else another bend, else straight.
    // START's passages run straight: a bend could cut through the white wall.
    let path = [a, b];
    if (!touchesStart && rng.next() >= g.STRAIGHT_CHANCE) {
      for (let k = 0; k < 3; k++) {
        const bent = square ? machinePath(rng, a, b, th) : organicPath(rng, a, b);
        if (room(bent) >= Math.min(want, g.GALLERY_WIDTH_MIN)) {
          path = bent;
          break;
        }
      }
    }
    // Narrower where other spaces crowd it, never below MIN_CLEARANCE.
    const width = Math.max(g.MIN_CLEARANCE, Math.min(want, room(path)));
    // Each leg its own width: passages swell and narrow, never below MIN_CLEARANCE.
    const widths = path.slice(1).map(() => Math.max(g.MIN_CLEARANCE, width * range(rng, 1 - g.WIDTH_VARIATION, 1 + g.WIDTH_VARIATION)));
    for (let i = 0; i + 1 < path.length; i++) shapes.push({ shape: stripShape(path[i]!, path[i + 1]!, widths[i]!), ref, module, height });
    // Niches along machine galleries' long legs, on both sides.
    if (square && module === 'gallery') {
      for (let i = 0; i + 1 < path.length; i++) {
        const p = path[i]!;
        const q = path[i + 1]!;
        const len = dist(p, q);
        if (len < 2 * g.NICHE_PITCH + 6) continue;
        const nx = (-(q.z - p.z) / len) * (widths[i]! / 2);
        const nz = ((q.x - p.x) / len) * (widths[i]! / 2);
        const mid = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 };
        for (const side of [1, -1]) {
          const a2 = { x: p.x + nx * side, z: p.z + nz * side };
          const b2 = { x: q.x + nx * side, z: q.z + nz * side };
          // Keep the niches off the halls at both ends.
          const cut = (k: number) => ({ x: a2.x + (b2.x - a2.x) * k, z: a2.z + (b2.z - a2.z) * k });
          for (const n of niches(rng, cut(0.25), cut(0.75), mid)) push(n, ref, module, height);
        }
      }
    }
    for (let i = 1; i + 1 < path.length; i++) {
      const legDir = Math.atan2(path[i + 1]!.z - path[i]!.z, path[i + 1]!.x - path[i]!.x);
      push(joint(path[i]!, Math.max(widths[i - 1]!, widths[i]!) / 2, legDir, square), ref, module, height);
    }
  }

  if (!startWall) throw new Error('structure has no START');
  return { graph, shapes, startWall };
}
