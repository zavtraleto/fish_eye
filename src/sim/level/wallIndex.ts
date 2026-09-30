import { closestOnSegment, type Segment } from './geometry';

// Uniform-grid buckets over wall segments (GDD §8): collision and line of
// sight test only nearby walls — organic walls are thousands of short segments.

export class SegmentIndex {
  readonly segments: readonly Segment[];
  private readonly x0: number;
  private readonly z0: number;
  private readonly w: number;
  private readonly h: number;
  /** Bucket b holds items[start[b] .. start[b + 1]). */
  private readonly start: Int32Array;
  private readonly items: Int32Array;
  private readonly mark: Uint32Array;
  private stamp = 0;
  private readonly found: Segment[] = [];

  constructor(
    segments: readonly Segment[],
    private readonly bucket = 4,
  ) {
    this.segments = segments;
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const s of segments) {
      minX = Math.min(minX, s.ax, s.bx);
      minZ = Math.min(minZ, s.az, s.bz);
      maxX = Math.max(maxX, s.ax, s.bx);
      maxZ = Math.max(maxZ, s.az, s.bz);
    }
    if (!segments.length) minX = minZ = maxX = maxZ = 0;
    this.x0 = minX;
    this.z0 = minZ;
    this.w = Math.floor((maxX - minX) / bucket) + 1;
    this.h = Math.floor((maxZ - minZ) / bucket) + 1;
    this.start = new Int32Array(this.w * this.h + 1);
    this.forBuckets((b) => {
      this.start[b + 1] = this.start[b + 1]! + 1;
    });
    for (let b = 0; b < this.w * this.h; b++) this.start[b + 1] = this.start[b + 1]! + this.start[b]!;
    this.items = new Int32Array(this.start[this.w * this.h]!);
    const fill = this.start.slice(0, -1);
    this.forBuckets((b, k) => {
      this.items[fill[b]!] = k;
      fill[b] = fill[b]! + 1;
    });
    this.mark = new Uint32Array(segments.length);
  }

  /** Walls whose bounds may touch the box, each once; the array is reused by the next call. */
  near(x0: number, z0: number, x1: number, z1: number): readonly Segment[] {
    this.found.length = 0;
    this.stamp++;
    const i0 = this.bi(x0);
    const i1 = this.bi(x1);
    const j0 = this.bj(z0);
    const j1 = this.bj(z1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const b = j * this.w + i;
        for (let k = this.start[b]!; k < this.start[b + 1]!; k++) {
          const idx = this.items[k]!;
          if (this.mark[idx] === this.stamp) continue;
          this.mark[idx] = this.stamp;
          this.found.push(this.segments[idx]!);
        }
      }
    }
    return this.found;
  }

  /** Distance from (x, z) to the nearest wall, at most `maxR`. */
  distance(x: number, z: number, maxR: number): number {
    let best = maxR;
    for (const s of this.near(x - maxR, z - maxR, x + maxR, z + maxR)) {
      const c = closestOnSegment(s, x, z);
      best = Math.min(best, Math.hypot(x - c.x, z - c.z));
    }
    return best;
  }

  private bi(x: number): number {
    return Math.min(this.w - 1, Math.max(0, Math.floor((x - this.x0) / this.bucket)));
  }

  private bj(z: number): number {
    return Math.min(this.h - 1, Math.max(0, Math.floor((z - this.z0) / this.bucket)));
  }

  private forBuckets(fn: (bucket: number, segment: number) => void): void {
    this.segments.forEach((s, k) => {
      for (let j = this.bj(Math.min(s.az, s.bz)); j <= this.bj(Math.max(s.az, s.bz)); j++) {
        for (let i = this.bi(Math.min(s.ax, s.bx)); i <= this.bi(Math.max(s.ax, s.bx)); i++) fn(j * this.w + i, k);
      }
    });
  }
}
