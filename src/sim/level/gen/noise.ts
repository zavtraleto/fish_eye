import type { Rng } from '../../../core/rng';

// Seeded 2D value noise for the level's fields (GDD §6: "род каркаса",
// later "плотность плоти"). Smooth, deterministic, no Math.random.

/** Lattice value in [0, 1) for integer (i, j). */
function lattice(seed: number, i: number, j: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** One octave of value noise with features about `scale` meters apart, in [0, 1). */
function valueNoise(seed: number, x: number, z: number, scale: number): number {
  const u = x / scale;
  const v = z / scale;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const tu = smooth(u - i);
  const tv = smooth(v - j);
  const a = lattice(seed, i, j);
  const b = lattice(seed, i + 1, j);
  const c = lattice(seed, i, j + 1);
  const d = lattice(seed, i + 1, j + 1);
  return (a * (1 - tu) + b * tu) * (1 - tv) + (c * (1 - tu) + d * tu) * tv;
}

export type Field = (x: number, z: number) => number;

/** Three octaves of value noise, features about `scale` meters apart, stretched to roughly fill [0, 1]. */
export function noiseField(rng: Rng, scale: number): Field {
  const seed = rng.int(0, 0x7fffffff);
  return (x, z) => {
    const n = 0.57 * valueNoise(seed, x, z, scale) + 0.29 * valueNoise(seed + 1, x, z, scale / 2) + 0.14 * valueNoise(seed + 2, x, z, scale / 4);
    return Math.min(1, Math.max(0, (n - 0.5) * 1.8 + 0.5));
  };
}
