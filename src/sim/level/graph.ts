// Structure graph (GDD §6, §7): a node is a space, an edge a passage between two.

export interface GraphRoom {
  id: number;
  /** Anchor point of the space, meters. */
  x: number;
  z: number;
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
