import type { Edge } from './delaunay';

// Graph measures of a structure (GDD §6, §7 step 5): bridges, cycles,
// junctions and how many different routes lead from START to the heart.

export type Adjacency = Map<number, number[]>;

export function adjacency(nodes: readonly number[], edges: readonly Edge[]): Adjacency {
  const adj: Adjacency = new Map(nodes.map((n) => [n, []]));
  for (const e of edges) {
    adj.get(e.a)!.push(e.b);
    adj.get(e.b)!.push(e.a);
  }
  return adj;
}

/** Graph steps from `from` to every reachable node. */
export function distances(adj: Adjacency, from: number): Map<number, number> {
  const dist = new Map([[from, 0]]);
  const queue = [from];
  for (let h = 0; h < queue.length; h++) {
    const n = queue[h]!;
    for (const m of adj.get(n) ?? []) {
      if (dist.has(m)) continue;
      dist.set(m, dist.get(n)! + 1);
      queue.push(m);
    }
  }
  return dist;
}

/** Edges whose removal disconnects the graph (Tarjan). */
export function bridges(adj: Adjacency): Edge[] {
  const order = new Map<number, number>();
  const low = new Map<number, number>();
  const out: Edge[] = [];
  let time = 0;
  const visit = (n: number, parent: number) => {
    order.set(n, time);
    low.set(n, time);
    time++;
    let skippedParent = false;
    for (const m of adj.get(n)!) {
      if (m === parent && !skippedParent) {
        skippedParent = true;
        continue;
      }
      if (order.has(m)) {
        low.set(n, Math.min(low.get(n)!, order.get(m)!));
        continue;
      }
      visit(m, n);
      low.set(n, Math.min(low.get(n)!, low.get(m)!));
      if (low.get(m)! > order.get(n)!) out.push({ a: Math.min(n, m), b: Math.max(n, m) });
    }
  };
  for (const n of adj.keys()) if (!order.has(n)) visit(n, -1);
  return out;
}

/** Simple paths from `from` to `to` no longer than `maxLen` edges, counted up to `cap`. */
export function countRoutes(adj: Adjacency, from: number, to: number, maxLen: number, cap = 50): number {
  let count = 0;
  const on = new Set<number>([from]);
  const walk = (n: number, len: number) => {
    if (count >= cap) return;
    if (n === to) {
      count++;
      return;
    }
    if (len === maxLen) return;
    for (const m of adj.get(n)!) {
      if (on.has(m)) continue;
      on.add(m);
      walk(m, len + 1);
      on.delete(m);
    }
  };
  walk(from, 0);
  return count;
}

export interface GraphMetrics {
  nodes: number;
  edges: number;
  /** Independent cycles: edges − nodes + 1 for a connected graph. */
  cycles: number;
  bridges: number;
  /** Share of nodes with three or more edges. */
  junctions: number;
  /** Different START → heart paths no longer than ROUTE_STRETCH × the shortest. */
  routes: number;
  /** Most spaces in a row with one way in and one way out (degree 2): a "corridor of rooms". */
  chain: number;
  /** Graph steps from START to the heart. */
  heartDist: number;
}

export function measure(nodes: readonly number[], edges: readonly Edge[], start: number, heart: number, stretch: number): GraphMetrics {
  const adj = adjacency(nodes, edges);
  const heartDist = distances(adj, start).get(heart) ?? Infinity;
  return {
    nodes: nodes.length,
    edges: edges.length,
    cycles: edges.length - nodes.length + 1,
    bridges: bridges(adj).length,
    junctions: nodes.filter((n) => adj.get(n)!.length >= 3).length / Math.max(1, nodes.length),
    routes: Number.isFinite(heartDist) ? countRoutes(adj, start, heart, Math.floor(heartDist * stretch)) : 0,
    heartDist,
    chain: longestChain(adj),
  };
}

/** Size of the largest connected group of degree-2 nodes. */
export function longestChain(adj: Adjacency): number {
  const seen = new Set<number>();
  let best = 0;
  for (const [n, list] of adj) {
    if (list.length !== 2 || seen.has(n)) continue;
    let size = 0;
    const stack = [n];
    seen.add(n);
    while (stack.length) {
      const m = stack.pop()!;
      size++;
      for (const k of adj.get(m)!) {
        if (adj.get(k)!.length !== 2 || seen.has(k)) continue;
        seen.add(k);
        stack.push(k);
      }
    }
    best = Math.max(best, size);
  }
  return best;
}
