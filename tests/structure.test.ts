import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import { Rng } from '../src/core/rng';
import { levelStructure } from '../src/data/difficulty';
import { adjacency, bridges, countRoutes, distances } from '../src/sim/level/gen/metrics';
import { generateStructure, type StructureGraph } from '../src/sim/level/gen/structure';

// `npm run test:gen` sweeps many more seeds (vitest --mode gen).
const SEEDS = import.meta.env.MODE === 'gen' ? 500 : 30;
const LEVELS = 15;

const levelRng = (seed: number, level: number) => new Rng(seed).fork(`level:${level}`);

function sweep(fn: (g: StructureGraph, seed: number, level: number) => void): void {
  for (let seed = 1; seed <= SEEDS; seed++) for (let level = 1; level <= LEVELS; level++) fn(generateStructure(levelRng(seed, level), levelStructure(level)), seed, level);
}

describe('graph metrics', () => {
  it('finds bridges on a path and none on a cycle', () => {
    const path = adjacency([0, 1, 2], [
      { a: 0, b: 1 },
      { a: 1, b: 2 },
    ]);
    expect(bridges(path).length).toBe(2);
    const ring = adjacency([0, 1, 2, 3], [
      { a: 0, b: 1 },
      { a: 1, b: 2 },
      { a: 2, b: 3 },
      { a: 0, b: 3 },
    ]);
    expect(bridges(ring)).toEqual([]);
    expect(countRoutes(ring, 0, 2, 2)).toBe(2);
    expect(countRoutes(ring, 0, 2, 1)).toBe(0);
  });
});

describe('structure generation (GDD §6, §7)', () => {
  beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

  it(`holds the invariants over ${SEEDS} seeds × ${LEVELS} levels, rarely relaxing the targets`, () => {
    let relaxed = 0;
    let total = 0;
    sweep((g, seed, level) => {
      total++;
      if (g.relaxed > 0) relaxed++;
      const at = `seed ${seed} level ${level}`;
      const adj = adjacency(g.nodes, g.edges);
      // Connected, no bridges: every passage lies on a cycle.
      expect(distances(adj, g.start).size, at).toBe(g.nodes.length);
      expect(bridges(adj), at).toEqual([]);
      // START and the heart have at least two entrances.
      expect(adj.get(g.start)!.length, at).toBeGreaterThanOrEqual(2);
      expect(adj.get(g.heart)!.length, at).toBeGreaterThanOrEqual(2);
      // The green line runs START → heart over graph edges and is a shortest path.
      expect(g.route[0], at).toBe(g.start);
      expect(g.route.at(-1), at).toBe(g.heart);
      for (let i = 0; i + 1 < g.route.length; i++) expect(adj.get(g.route[i]!)!.includes(g.route[i + 1]!), at).toBe(true);
      expect(distances(adj, g.start).get(g.heart), at).toBe(g.route.length - 1);
      // Passages only along surviving Delaunay edges.
      const cand = new Set(g.candidates.map((e) => `${e.a},${e.b}`));
      for (const e of g.edges) expect(cand.has(`${e.a},${e.b}`), at).toBe(true);
      // The targets are met unless relaxed.
      const want = levelStructure(level);
      if (g.relaxed === 0) {
        expect(g.nodes.length, at).toBe(want.nodes);
        expect(g.metrics.cycles, at).toBeGreaterThanOrEqual(1 + want.extraCycles);
        expect(g.metrics.routes, at).toBeGreaterThanOrEqual(want.minRoutes);
        expect(g.metrics.junctions, at).toBeGreaterThanOrEqual(want.minJunctions);
        expect(g.metrics.chain, at).toBeLessThanOrEqual(want.maxChain);
      }
    });
    expect(relaxed / total).toBeLessThan(0.02);
  }, 600000);

  it('is deterministic per seed and level', () => {
    for (const level of [1, 5, 12]) {
      const a = generateStructure(levelRng(9, level), levelStructure(level));
      const b = generateStructure(levelRng(9, level), levelStructure(level));
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  it('always ends, relaxing impossible targets', () => {
    tuning.gen.GEN_MAX_ATTEMPTS = 20;
    const g = generateStructure(new Rng(1), { nodes: 60, loopNodes: 12, routeNodes: 5, extraCycles: 40, minRoutes: 60, minJunctions: 0.9, maxChain: 0 });
    expect(g.relaxed).toBeGreaterThan(0);
    expect(bridges(adjacency(g.nodes, g.edges))).toEqual([]);
  }, 30000);
});
