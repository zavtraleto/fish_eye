// Difficulty by level number (GDD §13). Provisional: stage 6.6 tunes it by playtest.

/** What the structure generator is asked for (GDD §7 step 1). */
export interface StructureParams {
  /** Spaces in the level, START and the heart included. */
  nodes: number;
  /** Spaces on the big START ↔ heart loop. */
  loopNodes: number;
  /** Spaces along the green line, START and the heart included. */
  routeNodes: number;
  /** Cycles beyond the big loop, at least. */
  extraCycles: number;
  /** Different START → heart routes no longer than ROUTE_STRETCH × the shortest, at least. */
  minRoutes: number;
  /** Share of spaces with three or more ways out, at least: a net, not a corridor of rooms. */
  minJunctions: number;
  /** Spaces in a row with one way in and one way out, at most. */
  maxChain: number;
}

// [decision 2026-09-30] a short ramp, then steep (GDD §13): levels 1–2 teach the loop,
// from level 3 the structure grows by about four spaces a level into a tangled net.
// nodes, loopNodes, routeNodes, extraCycles, minRoutes, minJunctions, maxChain — for
// levels 1, 2, …; the last row repeats.
const TABLE: readonly (readonly [number, number, number, number, number, number, number])[] = [
  [7, 5, 3, 1, 1, 0.4, 3],
  [9, 6, 3, 2, 1, 0.45, 2],
  [14, 8, 4, 4, 2, 0.55, 2],
  [18, 9, 5, 5, 2, 0.6, 2],
  [22, 10, 5, 6, 3, 0.6, 2],
  [26, 11, 6, 7, 3, 0.65, 2],
  [30, 12, 6, 8, 3, 0.65, 2],
  [34, 13, 7, 9, 3, 0.65, 2],
  [38, 14, 7, 10, 3, 0.7, 2],
  [42, 15, 8, 11, 3, 0.7, 2],
  [46, 16, 8, 12, 3, 0.7, 2],
  [50, 17, 9, 13, 3, 0.7, 2],
];

/** The flesh of a level (GDD §6): how honestly its density leads from START to the heart. */
export interface FleshParams {
  /** Weight of the START → heart gradient against noise, 0…1. */
  gradient: number;
  /** Chance a space lies about its depth: flesh near START, bare near the heart. */
  deception: number;
}

// [decision 2026-09-30] strong and honest first, weaker and lying later (GDD §13). gradient, deception.
const FLESH: readonly (readonly [number, number])[] = [
  [1.0, 0],
  [0.9, 0],
  [0.8, 0.1],
  [0.75, 0.15],
  [0.7, 0.2],
  [0.6, 0.25],
  [0.55, 0.3],
  [0.5, 0.35],
  [0.45, 0.4],
  [0.4, 0.45],
  [0.35, 0.5],
  [0.3, 0.5],
];

export function levelFlesh(level: number): FleshParams {
  const [gradient, deception] = FLESH[Math.min(FLESH.length, Math.max(1, level)) - 1]!;
  return { gradient, deception };
}

export function levelStructure(level: number): StructureParams {
  const row = TABLE[Math.min(TABLE.length, Math.max(1, level)) - 1]!;
  const [nodes, loopNodes, routeNodes, extraCycles, minRoutes, minJunctions, maxChain] = row;
  return { nodes, loopNodes, routeNodes, extraCycles, minRoutes, minJunctions, maxChain };
}
