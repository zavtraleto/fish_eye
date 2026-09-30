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
}

// nodes, loopNodes, routeNodes, extraCycles, minRoutes — for levels 1, 2, …; the last row repeats.
const TABLE: readonly (readonly [number, number, number, number, number])[] = [
  [6, 5, 3, 1, 1],
  [7, 6, 3, 1, 1],
  [8, 6, 4, 2, 2],
  [10, 7, 4, 2, 2],
  [11, 8, 4, 3, 2],
  [12, 8, 5, 3, 2],
  [14, 9, 5, 4, 2],
  [15, 10, 5, 4, 2],
  [17, 10, 6, 5, 2],
  [18, 11, 6, 6, 2],
  [20, 12, 7, 8, 2],
];

export function levelStructure(level: number): StructureParams {
  const row = TABLE[Math.min(TABLE.length, Math.max(1, level)) - 1]!;
  const [nodes, loopNodes, routeNodes, extraCycles, minRoutes] = row;
  return { nodes, loopNodes, routeNodes, extraCycles, minRoutes };
}
