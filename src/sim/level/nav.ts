import { cellAt, type GridFrame } from './raster';

// Enemy navigation (GDD §11.1): steps to the player over the nav raster,
// breadth first over cells with room for the enemy's body; the enemy walks downhill.

export interface NavGrid {
  frame: GridFrame;
  /** Distance from each cell's centre to the nearest wall; 0 in rock. */
  clearance: Float32Array;
}

/** Cells this close to the goal are open to any body: the player may stand near a wall. */
const GOAL_SLACK = 2;
const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export class NavField {
  /** Cell of the last build's goal, -1 before any. */
  goal = -1;
  private readonly dist: Int32Array;
  private readonly seen: Uint32Array;
  private readonly queue: Int32Array;
  private stamp = 0;

  constructor(readonly grid: NavGrid) {
    const n = grid.frame.w * grid.frame.h;
    this.dist = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.queue = new Int32Array(n);
  }

  /** Steps from the cell to the goal, or -1 if the last build did not reach it. */
  stepsAt(cell: number): number {
    return cell >= 0 && this.seen[cell] === this.stamp ? this.dist[cell]! : -1;
  }

  /**
   * Breadth first from the goal's cell (8 neighbours, no corner cutting) over
   * open cells with clearance ≥ `radius`; stops two steps after reaching the
   * cells around `stop`, the enemy.
   */
  build(goalX: number, goalZ: number, stopX: number, stopZ: number, radius: number): void {
    const f = this.grid.frame;
    this.stamp++;
    this.goal = cellAt(f, goalX, goalZ);
    if (this.goal < 0 || this.grid.clearance[this.goal]! <= 0) return;
    const stop = cellAt(f, stopX, stopZ);
    const si = stop % f.w;
    const sj = (stop - si) / f.w;
    let head = 0;
    let tail = 0;
    let limit = Infinity;
    this.seen[this.goal] = this.stamp;
    this.dist[this.goal] = 0;
    this.queue[tail++] = this.goal;
    while (head < tail) {
      const c = this.queue[head++]!;
      const d = this.dist[c]!;
      if (d > limit) break;
      const ci = c % f.w;
      const cj = (c - ci) / f.w;
      if (stop >= 0 && Math.abs(ci - si) <= 1 && Math.abs(cj - sj) <= 1) limit = Math.min(limit, d + 2);
      for (const [di, dj] of STEPS) {
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= f.w || nj >= f.h) continue;
        const nc = nj * f.w + ni;
        if (this.seen[nc] === this.stamp || !this.open(nc, d + 1, radius)) continue;
        if (di !== 0 && dj !== 0 && (!this.open(cj * f.w + ni, d + 1, radius) || !this.open(nj * f.w + ci, d + 1, radius))) continue;
        this.seen[nc] = this.stamp;
        this.dist[nc] = d + 1;
        this.queue[tail++] = nc;
      }
    }
  }

  /** Up to `maxSteps` cells downhill from (x, z) to the goal, starting at its cell; empty if not reached. */
  descend(x: number, z: number, maxSteps: number): number[] {
    let c = cellAt(this.grid.frame, x, z);
    if (this.stepsAt(c) < 0) c = this.lowestAround(c);
    if (c < 0) return [];
    const out = [c];
    while (out.length <= maxSteps && this.dist[c]! > 0) {
      const next = this.lowestAround(c);
      if (next < 0 || this.dist[next]! >= this.dist[c]!) break;
      c = next;
      out.push(c);
    }
    return out;
  }

  private open(c: number, steps: number, radius: number): boolean {
    const k = this.grid.clearance[c]!;
    return k > 0 && (k >= radius || steps <= GOAL_SLACK);
  }

  /** The reached neighbour closest to the goal, or -1. */
  private lowestAround(c: number): number {
    if (c < 0) return -1;
    const f = this.grid.frame;
    const ci = c % f.w;
    const cj = (c - ci) / f.w;
    let best = -1;
    for (const [di, dj] of STEPS) {
      const ni = ci + di;
      const nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= f.w || nj >= f.h) continue;
      const nc = nj * f.w + ni;
      if (this.stepsAt(nc) >= 0 && (best < 0 || this.dist[nc]! < this.dist[best]!)) best = nc;
    }
    return best;
  }
}
