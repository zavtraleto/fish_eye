// Room graph on the coarse grid (GDD §6, §7): a node is a room in one cell,
// an edge a corridor between neighbouring cells (or across one empty cell).

export interface GraphRoom {
  id: number;
  cx: number;
  cz: number;
}

export interface GraphEdge {
  a: number;
  b: number;
}

export interface LevelGraph {
  rooms: readonly GraphRoom[];
  edges: readonly GraphEdge[];
  start: number;
  eye: number;
  /** Rooms along the green line, START first, EYE last (GDD §10). */
  route: readonly number[];
}

export function hasEdge(g: LevelGraph, a: number, b: number): boolean {
  return g.edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}
