import { tuning } from '../config/tuning';
import type { Level } from '../sim/level/level';
import { cellAt, sampleNodes } from '../sim/level/raster';

// Organic surfaces of the level mesh (GDD §6, VISUAL.md): the sim stays 2D and
// flat; the view bends what nobody can reach. The floor rises into the walls
// only within COVE_WIDTH of them (the player never stands that close), the
// ceiling is one smooth field that vaults down toward the walls, and walls
// bulge in and out — into the open only a little below head height. Every
// function depends on the point alone, so neighbouring pieces share vertices
// exactly and the fisheye opens no cracks (VISUAL.md §11). The flesh density
// scales all of it: bare machine stays flat and square.

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Seedless 3D value noise in [0, 1): render only, stable per position. */
function lattice(i: number, j: number, k: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x1b873593);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise3(x: number, y: number, z: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const k = Math.floor(z);
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(x - i);
  const v = s(y - j);
  const w = s(z - k);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c00 = lerp(lattice(i, j, k), lattice(i + 1, j, k), u);
  const c10 = lerp(lattice(i, j + 1, k), lattice(i + 1, j + 1, k), u);
  const c01 = lerp(lattice(i, j, k + 1), lattice(i + 1, j, k + 1), u);
  const c11 = lerp(lattice(i, j + 1, k + 1), lattice(i + 1, j + 1, k + 1), u);
  return lerp(lerp(c00, c10, v), lerp(c01, c11, v), w);
}

/** Two octaves, features about `scale` meters apart. */
function fbm(x: number, y: number, z: number, scale: number): number {
  return 0.65 * noise3(x / scale, y / scale, z / scale) + 0.35 * noise3((x / scale) * 2.3 + 17, (y / scale) * 2.3, (z / scale) * 2.3 - 9);
}

export interface LevelSurface {
  /** Flesh density for tint and relief: the zone's own, so it never bleeds through a wall. */
  flesh(x: number, z: number): number;
  floorY(x: number, z: number): number;
  ceilY(x: number, z: number): number;
  /**
   * A wall point at height y: (x, z) pushed along the open-side normal (nx, nz);
   * zero at the floor and the ceiling, so floor, wall and ceiling meet.
   */
  wallOffset(x: number, z: number, y: number, nx: number, nz: number): number;
}

export function levelSurface(level: Level): LevelSurface {
  const v = tuning.view;
  const f = level.frame;
  const density = level.density;
  // Mean density per zone: the tint of a space is its own.
  const mean = new Float32Array(level.zones.length);
  if (density) {
    const count = new Float32Array(level.zones.length);
    for (let c = 0; c < level.cellZone.length; c++) {
      const z = level.cellZone[c]!;
      if (z < 0) continue;
      const i = c % f.w;
      const j = (c - i) / f.w;
      mean[z] = mean[z]! + density[j * (f.w + 1) + i]!;
      count[z] = count[z]! + 1;
    }
    for (let z = 0; z < mean.length; z++) mean[z] = count[z]! > 0 ? mean[z]! / count[z]! : 0;
  }
  const zoneAt = (x: number, z: number): number => {
    const c = cellAt(f, x, z);
    if (c >= 0 && level.cellZone[c]! >= 0) return level.cellZone[c]!;
    // A point on a wall: the open neighbour's zone.
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ] as const) {
      const n = cellAt(f, x + dx * f.cell, z + dz * f.cell);
      if (n >= 0 && level.cellZone[n]! >= 0) return level.cellZone[n]!;
    }
    return -1;
  };
  const flesh = (x: number, z: number): number => {
    if (!density) return 0;
    const zone = zoneAt(x, z);
    const local = sampleNodes(f, density, x, z);
    return zone < 0 ? local : 0.7 * mean[zone]! + 0.3 * Math.min(local, mean[zone]! + 0.2);
  };
  const dist = (x: number, z: number) => sampleNodes(f, level.wallDist, x, z);

  const floorY = (x: number, z: number): number => {
    const d = flesh(x, z);
    if (d <= 0) return 0;
    return v.COVE_HEIGHT * d * (1 - smoothstep(0, v.COVE_WIDTH, dist(x, z)));
  };

  const ceilY = (x: number, z: number): number => {
    const base = sampleNodes(f, level.ceiling, x, z);
    const d = flesh(x, z);
    const wall = dist(x, z);
    let y = base + v.CEILING_NOISE * d * (fbm(x, 0, z, 11) - 0.5) * 2;
    // Vaults: the ceiling sinks toward the walls where there is flesh.
    y -= v.VAULT * base * d * (1 - smoothstep(0, v.VAULT_WIDTH, wall));
    // Where one can stand, never below CEILING_MIN; by the walls, still above the cove.
    const floor = wall >= v.COVE_WIDTH ? v.CEILING_MIN : floorY(x, z) + 3;
    return Math.max(floor, y);
  };

  const wallOffset = (x: number, z: number, y: number, nx: number, nz: number): number => {
    const d = flesh(x + nx, z + nz);
    if (d <= 0) return 0;
    const y0 = floorY(x, z);
    const y1 = ceilY(x, z);
    const t = Math.min(1, Math.max(0, (y - y0) / Math.max(1e-3, y1 - y0)));
    // Positive pushes into the open. Mostly into the rock: spaces swell.
    let off = v.WALL_BULGE * d * Math.sin(Math.PI * t) * ((fbm(x, y * 0.8, z, 6) - 0.55) * 2.4);
    if (y < v.WALL_SAFE_HEIGHT) off = Math.min(off, v.WALL_INWARD_LOW);
    return off;
  };

  return { flesh, floorY, ceilY, wallOffset };
}
