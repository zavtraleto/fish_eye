import { tuning } from '../../../config/tuning';
import type { Rng } from '../../../core/rng';
import type { FleshParams } from '../../../data/difficulty';
import { signedDistance } from '../edt';
import type { Segment } from '../geometry';
import { nodePoint, type GridFrame } from '../raster';
import { adjacency, distances } from './metrics';
import { noiseField } from './noise';
import type { StructureGraph } from './structure';

// Flesh (GDD §6): deforms the skeleton's open field in place. Everywhere a
// small closing blunts rock wedges and sharp corners. Where the flesh density
// is high, a stronger closing, an opening (round corners), a wobble mostly
// outward and free-standing growths. Density = noise blended with a gradient
// from START (bare machine) to the heart (flesh); the gradient weakens and
// lies more with the level number. START stays bare: its white wall is flat.

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Closing of the open set by r: rock thinner than 2r opens, rock corners round. */
function closing(f: GridFrame, sd: Float32Array, r: number): Float32Array {
  const grown = sd.map((v) => v + r);
  const out = signedDistance(f, grown);
  for (let k = 0; k < out.length; k++) out[k] = out[k]! - r;
  return out;
}

/** Opening of the open set by r: open corners round, slivers thinner than 2r close. */
function opening(f: GridFrame, sd: Float32Array, r: number): Float32Array {
  const shrunk = sd.map((v) => v - r);
  const out = signedDistance(f, shrunk);
  for (let k = 0; k < out.length; k++) out[k] = out[k]! + r;
  return out;
}

/**
 * The flesh hook for `buildLevel`: rewrites `field` and returns the flesh
 * density (0 bare … 1 flesh) at every node, for the renderer's tint.
 */
export function fleshDeform(rng: Rng, s: StructureGraph, startWall: Segment, p: FleshParams): (f: GridFrame, field: Float32Array) => Float32Array {
  const g = tuning.gen;
  const noise = noiseField(rng, g.FLESH_SCALE);
  const wobble = noiseField(rng, g.FLESH_WOBBLE_SCALE);
  // Gradient: graph steps from START, 0 at START … 1 at the farthest space; deception flips some.
  const steps = distances(adjacency(s.nodes, s.edges), s.start);
  const far = Math.max(1, ...steps.values());
  const nodes = s.nodes.map((id) => {
    let t = (steps.get(id) ?? far) / far;
    if (id !== s.start && id !== s.heart && rng.next() < p.deception) t = 1 - t;
    if (id === s.heart) t = 1;
    return { x: s.points[id]!.x, z: s.points[id]!.z, t };
  });
  const calmX = (startWall.ax + startWall.bx) / 2;
  const calmZ = (startWall.az + startWall.bz) / 2;
  const growthSeed = rng.int(0, 0x7fffffff);

  return (f, field) => {
    const n = field.length;
    const density = new Float32Array(n);
    /** 0 by the white wall (the skeleton stays exact there) … 1 past START_CALM. */
    const calm = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const q = nodePoint(f, k % (f.w + 1), Math.floor(k / (f.w + 1)));
      let wsum = 0;
      let tsum = 0;
      for (const o of nodes) {
        const w = 1 / ((q.x - o.x) ** 2 + (q.z - o.z) ** 2 + 400);
        wsum += w;
        tsum += w * o.t;
      }
      const d = (1 - p.gradient) * noise(q.x, q.z) + p.gradient * (tsum / wsum);
      // START is bare machine: no flesh near the white wall.
      calm[k] = smoothstep(g.START_CALM * 0.6, g.START_CALM, Math.hypot(q.x - calmX, q.z - calmZ));
      density[k] = Math.min(1, Math.max(0, d)) * calm[k]!;
    }

    const sd = signedDistance(f, field);
    const base = closing(f, sd, g.FLESH_CLOSE_MIN);
    const organic = opening(f, closing(f, sd, g.FLESH_CLOSE_MAX), g.FLESH_OPEN);
    for (let k = 0; k < n; k++) {
      const q = nodePoint(f, k % (f.w + 1), Math.floor(k / (f.w + 1)));
      const w = smoothstep(0.2, 0.8, density[k]!);
      // Mostly outward: flesh swells spaces more than it pinches them.
      const o = organic[k]! + g.FLESH_WOBBLE * (wobble(q.x, q.z) - 0.2);
      // No wall moves inward more than FLESH_INWARD: passages stay passable.
      const flesh = Math.max((1 - w) * base[k]! + w * o, sd[k]! - g.FLESH_INWARD);
      // Near START the skeleton stays as it was: the white wall must stay exact.
      field[k] = (1 - calm[k]!) * field[k]! + calm[k]! * flesh;
    }

    // Growths: free-standing masses in dense, roomy places, always with a ring to run around them.
    const local = new Float32Array(field);
    let seed = growthSeed;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const tries = s.nodes.length * g.GROWTH_TRIES;
    for (let t = 0; t < tries; t++) {
      const i = Math.floor(next() * (f.w + 1));
      const j = Math.floor(next() * (f.h + 1));
      const k = j * (f.w + 1) + i;
      const dens = density[k]!;
      if (dens < g.GROWTH_DENSITY || next() > dens) continue;
      const r = g.GROWTH_RADIUS_MIN + next() * (g.GROWTH_RADIUS_MAX - g.GROWTH_RADIUS_MIN);
      if (local[k]! < r + g.MIN_CLEARANCE + 1) continue;
      const c = nodePoint(f, i, j);
      const reach = Math.ceil((r * 1.4) / f.cell);
      for (let b = Math.max(0, j - reach); b <= Math.min(f.h, j + reach); b++) {
        for (let a = Math.max(0, i - reach); a <= Math.min(f.w, i + reach); a++) {
          const q = nodePoint(f, a, b);
          const edge = Math.hypot(q.x - c.x, q.z - c.z) - r * (1 + 0.35 * (wobble(q.x * 3, q.z * 3) - 0.5));
          const m = b * (f.w + 1) + a;
          field[m] = Math.min(field[m]!, edge);
        }
      }
      // Keep later growths off this one: its ring is not theirs to take.
      const clearR = r + g.MIN_CLEARANCE + 1 + g.GROWTH_RADIUS_MAX;
      const reach2 = Math.ceil(clearR / f.cell);
      for (let b = Math.max(0, j - reach2); b <= Math.min(f.h, j + reach2); b++) {
        for (let a = Math.max(0, i - reach2); a <= Math.min(f.w, i + reach2); a++) {
          const q = nodePoint(f, a, b);
          const m = b * (f.w + 1) + a;
          local[m] = Math.min(local[m]!, Math.hypot(q.x - c.x, q.z - c.z) - r);
        }
      }
    }
    return density;
  };
}
