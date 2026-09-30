import { tuning } from '../../../config/tuning';
import type { Rng } from '../../../core/rng';
import type { StructureParams } from '../../../data/difficulty';
import type { Point } from '../geometry';
import { delaunay, triangleEdges, type Edge, type Triangle } from './delaunay';
import { adjacency, distances, measure, type GraphMetrics } from './metrics';
import { noiseField } from './noise';
import { scatterPoints } from './scatter';

// The structure graph (GDD §6, §7 steps 2–5): irregular anchor points, their
// Delaunay neighbours, a big loop grown as a disc of triangles, ears on top.
// A graph of a loop and ears has no bridges: every edge lies on a cycle.

export interface StructureGraph {
  /** Every anchor point; unused ones stay rock. */
  points: Point[];
  /** Delaunay edges that survived the filters: where passages may go. */
  candidates: Edge[];
  /** Point indices that became spaces. */
  nodes: number[];
  edges: Edge[];
  /** The big loop, in order. */
  loop: number[];
  start: number;
  heart: number;
  /** The green line: START … heart along the loop. */
  route: number[];
  metrics: GraphMetrics;
  /** Relaxation steps the targets needed (GDD §7 step 5). */
  relaxed: number;
  attempts: number;
}

const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

/** Delaunay edges within EDGE_MAX, without the longer of two edges at a too sharp angle. */
function filterEdges(points: readonly Point[], tris: readonly Triangle[]): Edge[] {
  const { EDGE_MAX, EDGE_MIN_ANGLE } = tuning.gen;
  const len = (e: Edge) => Math.hypot(points[e.a]!.x - points[e.b]!.x, points[e.a]!.z - points[e.b]!.z);
  const edges = triangleEdges(tris).filter((e) => len(e) <= EDGE_MAX);
  const drop = new Set<string>();
  const minAngle = (EDGE_MIN_ANGLE * Math.PI) / 180;
  const around = new Map<number, Edge[]>();
  for (const e of edges) {
    around.set(e.a, [...(around.get(e.a) ?? []), e]);
    around.set(e.b, [...(around.get(e.b) ?? []), e]);
  }
  for (const [n, list] of around) {
    const p = points[n]!;
    const dir = (e: Edge) => {
      const q = points[e.a === n ? e.b : e.a]!;
      return Math.atan2(q.z - p.z, q.x - p.x);
    };
    const sorted = [...list].sort((a, b) => dir(a) - dir(b));
    for (let i = 0; i < sorted.length && sorted.length > 1; i++) {
      const e = sorted[i]!;
      const f = sorted[(i + 1) % sorted.length]!;
      let gap = dir(f) - dir(e);
      if (gap < 0) gap += 2 * Math.PI;
      if (gap < minAngle) drop.add(len(e) > len(f) ? key(e.a, e.b) : key(f.a, f.b));
    }
  }
  return edges.filter((e) => !drop.has(key(e.a, e.b)));
}

/** A simple cycle of `size` points: the boundary of a disc of triangles grown one apex at a time. */
function growLoop(rng: Rng, tris: readonly Triangle[], allowed: Set<string>, size: number): number[] | null {
  const usable = tris.filter((t) => allowed.has(key(t[0], t[1])) && allowed.has(key(t[1], t[2])) && allowed.has(key(t[2], t[0])));
  if (!usable.length) return null;
  const byEdge = new Map<string, number[]>();
  usable.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const kk = key(t[k]!, t[(k + 1) % 3]!);
      byEdge.set(kk, [...(byEdge.get(kk) ?? []), i]);
    }
  });
  const first = rng.int(0, usable.length - 1);
  const cycle: number[] = [...usable[first]!];
  const inDisc = new Set(cycle);
  const used = new Set([first]);
  while (cycle.length < size) {
    const options: [number, number, number][] = [];
    for (let i = 0; i < cycle.length; i++) {
      const u = cycle[i]!;
      const v = cycle[(i + 1) % cycle.length]!;
      for (const t of byEdge.get(key(u, v)) ?? []) {
        if (used.has(t)) continue;
        const w = usable[t]!.find((x) => x !== u && x !== v)!;
        // A vertex already on the disc would pinch it: the boundary would stop being simple.
        if (!inDisc.has(w)) options.push([i, t, w]);
      }
    }
    if (!options.length) return null;
    const [i, t, w] = rng.pick(options);
    cycle.splice(i + 1, 0, w);
    inDisc.add(w);
    used.add(t);
  }
  return cycle;
}

interface Draft {
  nodes: Set<number>;
  edges: Edge[];
  has: Set<string>;
}

function addEdge(d: Draft, a: number, b: number): void {
  d.edges.push({ a: Math.min(a, b), b: Math.max(a, b) });
  d.has.add(key(a, b));
}

/**
 * An ear: a path of `k` new spaces between two existing ones (a chord when k = 0).
 * A chord must join spaces LOOP_MIN_GRAPH_DIST apart (Brogue). Nothing may
 * bring the heart closer to START than the green line.
 */
function addEar(rng: Rng, d: Draft, cand: Map<number, number[]>, k: number, start: number, heart: number, heartDist: number): boolean {
  const existing = rng.shuffle([...d.nodes]);
  for (const a of existing) {
    const path = k === 0 ? chord(rng, d, cand, a) : detour(rng, d, cand, a, k);
    if (!path) continue;
    const trial: Draft = { nodes: new Set(d.nodes), edges: [...d.edges], has: new Set(d.has) };
    for (let i = 0; i + 1 < path.length; i++) {
      trial.nodes.add(path[i]!);
      trial.nodes.add(path[i + 1]!);
      addEdge(trial, path[i]!, path[i + 1]!);
    }
    const dist = distances(adjacency([...trial.nodes], trial.edges), start).get(heart);
    if (dist !== heartDist) continue;
    d.nodes = trial.nodes;
    d.edges = trial.edges;
    d.has = trial.has;
    return true;
  }
  return false;
}

function chord(rng: Rng, d: Draft, cand: Map<number, number[]>, a: number): number[] | null {
  const dist = distances(adjacency([...d.nodes], d.edges), a);
  for (const b of rng.shuffle([...(cand.get(a) ?? [])])) {
    if (!d.nodes.has(b) || d.has.has(key(a, b))) continue;
    if ((dist.get(b) ?? Infinity) >= tuning.gen.LOOP_MIN_GRAPH_DIST) return [a, b];
  }
  return null;
}

/** a → k unused points → an existing space other than a. */
function detour(rng: Rng, d: Draft, cand: Map<number, number[]>, a: number, k: number): number[] | null {
  const path = [a];
  const walk = (n: number, left: number): boolean => {
    const next = rng.shuffle([...(cand.get(n) ?? [])]);
    if (left === 0) {
      const b = next.find((m) => d.nodes.has(m) && m !== a);
      if (b === undefined) return false;
      path.push(b);
      return true;
    }
    for (const m of next) {
      if (d.nodes.has(m) || path.includes(m)) continue;
      path.push(m);
      if (walk(m, left - 1)) return true;
      path.pop();
    }
    return false;
  };
  return walk(a, k) ? path : null;
}

/** One try with fresh points; null if the targets are not met. */
function attempt(rng: Rng, p: StructureParams): Omit<StructureGraph, 'relaxed' | 'attempts'> | null {
  const g = tuning.gen;
  const spacing = noiseField(rng, g.SPACING_SCALE);
  const points = scatterPoints(rng, Math.min(90, p.nodes * 3 + 6), g.POINT_SPACING_MIN, g.POINT_SPACING_MAX, spacing);
  const tris = delaunay(points);
  const candidates = filterEdges(points, tris);
  const allowed = new Set(candidates.map((e) => key(e.a, e.b)));
  const cand = new Map<number, number[]>();
  for (const e of candidates) {
    cand.set(e.a, [...(cand.get(e.a) ?? []), e.b]);
    cand.set(e.b, [...(cand.get(e.b) ?? []), e.a]);
  }

  const loop = growLoop(rng, tris, allowed, p.loopNodes);
  if (!loop) return null;
  const L = loop.length;
  const s = rng.int(0, L - 1);
  const dir = rng.next() < 0.5 ? 1 : -1;
  const route = Array.from({ length: p.routeNodes }, (_, i) => loop[(((s + dir * i) % L) + L) % L]!);
  const start = route[0]!;
  const heart = route.at(-1)!;

  const d: Draft = { nodes: new Set(loop), edges: [], has: new Set() };
  for (let i = 0; i < L; i++) addEdge(d, loop[i]!, loop[(i + 1) % L]!);
  let ears = 0;
  let failures = 0;
  while ((d.nodes.size < p.nodes || ears < p.extraCycles) && failures < 20) {
    const missing = p.nodes - d.nodes.size;
    const k = missing > 0 ? rng.int(1, Math.min(g.EAR_MAX_NODES, missing)) : 0;
    if (addEar(rng, d, cand, k, start, heart, p.routeNodes - 1)) ears++;
    else failures++;
  }

  const nodes = [...d.nodes];
  const metrics = measure(nodes, d.edges, start, heart, g.ROUTE_STRETCH);
  const ok =
    nodes.length === p.nodes &&
    metrics.bridges === 0 &&
    metrics.cycles >= 1 + p.extraCycles &&
    metrics.heartDist === p.routeNodes - 1 &&
    metrics.routes >= p.minRoutes;
  return ok ? { points, candidates, nodes, edges: d.edges, loop, start, heart, route, metrics } : null;
}

/** Halfway to the floor, one target at a time: routes, cycles, spaces, then the loop; null at the floor. */
function relax(p: StructureParams): StructureParams | null {
  const half = (v: number, floor: number) => v - Math.max(1, Math.ceil((v - floor) / 2));
  if (p.minRoutes > 1) return { ...p, minRoutes: half(p.minRoutes, 1) };
  if (p.extraCycles > 0) return { ...p, extraCycles: half(p.extraCycles, 0) };
  if (p.nodes > p.loopNodes) return { ...p, nodes: half(p.nodes, p.loopNodes) };
  if (p.loopNodes > 4) {
    const loopNodes = half(p.loopNodes, 4);
    return { ...p, loopNodes, nodes: loopNodes, routeNodes: Math.min(p.routeNodes, Math.floor(loopNodes / 2) + 1) };
  }
  return null;
}

/**
 * The structure for one level. Targets are relaxed one step after every
 * GEN_MAX_ATTEMPTS failures, so generation always ends (GDD §7 step 5).
 */
export function generateStructure(rng: Rng, want: StructureParams): StructureGraph {
  // The green line must be the shorter arc of the big loop.
  let p: StructureParams = { ...want, loopNodes: Math.max(want.loopNodes, 2 * (want.routeNodes - 1), 4) };
  p.nodes = Math.max(p.nodes, p.loopNodes);
  let relaxed = 0;
  let attempts = 0;
  for (;;) {
    for (let i = 0; i < tuning.gen.GEN_MAX_ATTEMPTS; i++) {
      attempts++;
      const g = attempt(rng, p);
      if (g) return { ...g, relaxed, attempts };
    }
    const next = relax(p);
    if (!next) throw new Error('structure generation failed even at the easiest targets');
    p = next;
    relaxed++;
  }
}
