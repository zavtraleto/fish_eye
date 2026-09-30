import * as THREE from 'three';
import type { Point } from '../sim/level/geometry';
import type { Level } from '../sim/level/level';
import { levelSurface } from './levelSurface';
import { patchMaterial } from './camera/fisheyeShader';

// Greybox level geometry (VISUAL.md §2, §5) from the sim's raster level: floor
// and ceiling are the free parts of raster cells, walls the contour segments,
// all with shared vertices (VISUAL.md §11). Surfaces bend where there is flesh
// (levelSurface.ts). Walls are cut in height by `segment` so the vertex
// fisheye can bend them. Flat vertex colours, no lights.

const COLORS = {
  floorA: 0x4a4d56,
  floorB: 0x40434b,
  ceiling: 0x2a2c32,
  wallX: 0x383b43,
  wallZ: 0x30333a,
  /** START / EXIT (VISUAL.md §2). */
  start: 0xf4f4ec,
};
/** Flesh (GDD §6): the same roles, dark and warm — never red, red is the enemy's (VISUAL.md §1). */
const FLESH = {
  floorA: 0x4b3f3b,
  floorB: 0x413633,
  ceiling: 0x2b2321,
  wallX: 0x40332f,
  wallZ: 0x372b28,
};
const mixA = new THREE.Color();
const mixB = new THREE.Color();

/** Machine colour `a` toward flesh colour `b` by t. */
function mix(a: number, b: number, t: number): number {
  if (t <= 0) return a;
  return mixA.setHex(a).lerp(mixB.setHex(b), Math.min(1, t)).getHex();
}
/** Checker tile of the floor, meters: gives a sense of speed. */
const TILE = 2;

export class GeometryBuilder {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  private readonly c = new THREE.Color();

  /** Quad a-b-c-d; materials are double-sided, so winding does not matter. */
  quad(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, d: THREE.Vector3Like, hex: number): void {
    this.c.setHex(hex);
    for (const v of [a, b, c, a, c, d]) {
      this.positions.push(v.x, v.y, v.z);
      this.colors.push(this.c.r, this.c.g, this.c.b);
    }
  }

  tri(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, hex: number): void {
    this.c.setHex(hex);
    for (const v of [a, b, c]) {
      this.positions.push(v.x, v.y, v.z);
      this.colors.push(this.c.r, this.c.g, this.c.b);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    return g;
  }
}

/**
 * Splits [a, b] at the multiples of `seg`, so pieces of neighbouring areas and
 * walls share vertices along their seams: the fisheye bends only vertices, and
 * a T-junction opens a crack (VISUAL.md §11).
 */
export function gridCuts(a: number, b: number, seg: number): number[] {
  const out = [a];
  for (let k = Math.floor(a / seg + 1e-6) + 1; k * seg < b - 1e-6; k++) out.push(k * seg);
  out.push(b);
  return out;
}

/** Splits [a, b] into equal steps no longer than `seg`. */
export function cuts(a: number, b: number, seg: number): number[] {
  const n = Math.max(1, Math.ceil((b - a) / seg - 1e-6));
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
}

function tileParity(x: number, z: number): number {
  return (Math.floor(x / TILE) + Math.floor(z / TILE)) & 1;
}

/** A convex piece as a fan; each vertex at its own height (floor coves, ceiling vaults). */
function addPiece(b: GeometryBuilder, pts: readonly Point[], height: (x: number, z: number) => number, hex: number): void {
  const v = pts.map((p) => ({ x: p.x, y: height(p.x, p.z), z: p.z }));
  for (let k = 1; k + 1 < v.length; k++) b.tri(v[0]!, v[k]!, v[k + 1]!, hex);
}

type Vertex = { x: number; y: number; z: number };

/**
 * A wall as a strip between two vertex columns, one per end: each column runs
 * from that point's floor to its ceiling, cut on the world's height grid and
 * bent along the point's normal. Columns depend on the point alone, so
 * neighbouring walls share them exactly (VISUAL.md §11).
 */
function addWall(b: GeometryBuilder, a: Vertex[], c: Vertex[], base: number, band: boolean): void {
  let i = 0;
  let j = 0;
  while (i < a.length - 1 || j < c.length - 1) {
    const upA = j >= c.length - 1 || (i < a.length - 1 && a[i + 1]!.y <= c[j + 1]!.y);
    const p = a[i]!;
    const q = c[j]!;
    const r = upA ? a[i + 1]! : c[j + 1]!;
    // A lighter band at waist height marks the wall's extent while running.
    const my = (p.y + q.y + r.y) / 3;
    b.tri(p, q, r, band && my > 1.0 && my < 1.3 ? base + 0x080808 : base);
    if (upA) i++;
    else j++;
  }
}

/** Plan bounds of a chunk of the level mesh: the view hides chunks beyond the fog (GDD §15.4). */
export interface ChunkBounds {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Signal geometry fades over the longer SIGNAL_FOG_FAR. */
  signal: boolean;
}

/** Builders per square chunk of the plan; a piece goes to the chunk of its centre. */
class Chunks {
  private readonly map = new Map<string, GeometryBuilder>();
  constructor(
    private readonly size: number,
    private readonly signal: boolean,
  ) {}

  at(x: number, z: number): GeometryBuilder {
    const key = `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`;
    let b = this.map.get(key);
    if (!b) {
      b = new GeometryBuilder();
      this.map.set(key, b);
    }
    return b;
  }

  meshes(): THREE.Mesh[] {
    return [...this.map.values()].map((b) => {
      const bounds: ChunkBounds = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity, signal: this.signal };
      for (let k = 0; k < b.positions.length; k += 3) {
        bounds.x0 = Math.min(bounds.x0, b.positions[k]!);
        bounds.x1 = Math.max(bounds.x1, b.positions[k]!);
        bounds.z0 = Math.min(bounds.z0, b.positions[k + 2]!);
        bounds.z1 = Math.max(bounds.z1, b.positions[k + 2]!);
      }
      const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true });
      patchMaterial(material, { signal: this.signal });
      const mesh = new THREE.Mesh(b.build(), material);
      // The fisheye sees far outside the camera's perspective frustum; the view culls chunks by distance instead.
      mesh.frustumCulled = false;
      mesh.userData.bounds = bounds;
      return mesh;
    });
  }
}

/**
 * The level in square chunks of `chunk` meters; the white START wall is
 * separate signal geometry that fades over the long range (GDD §10).
 */
export function buildLevelMesh(level: Level, segment: number, chunk: number): THREE.Group {
  const seg = Math.max(0.1, segment);
  const surf = levelSurface(level);
  const world = new Chunks(Math.max(4, chunk), false);
  const signal = new Chunks(Math.max(4, chunk), true);
  for (const piece of level.floor) {
    const pts = piece.points;
    const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
    const cz = pts.reduce((sum, p) => sum + p.z, 0) / pts.length;
    const b = world.at(cx, cz);
    const t = surf.flesh(cx, cz);
    addPiece(b, pts, surf.floorY, tileParity(cx, cz) ? mix(COLORS.floorA, FLESH.floorA, t) : mix(COLORS.floorB, FLESH.floorB, t));
    addPiece(b, pts, surf.ceilY, mix(COLORS.ceiling, FLESH.ceiling, t));
  }

  // Vertex normals: the mean of the walls meeting at a point, so shared columns bend alike.
  const key = (x: number, z: number) => `${x},${z}`;
  const normals = new Map<string, [number, number]>();
  for (const f of level.faces) {
    for (const [x, z] of [
      [f.seg.ax, f.seg.az],
      [f.seg.bx, f.seg.bz],
    ] as const) {
      const n = normals.get(key(x, z)) ?? [0, 0];
      normals.set(key(x, z), [n[0] + f.nx, n[1] + f.nz]);
    }
  }
  const columns = new Map<string, Vertex[]>();
  const column = (x: number, z: number, flat: boolean): Vertex[] => {
    const k = key(x, z) + (flat ? '|flat' : '');
    let col = columns.get(k);
    if (col) return col;
    const [sx, sz] = normals.get(key(x, z)) ?? [0, 0];
    const len = Math.hypot(sx, sz) || 1;
    const nx = sx / len;
    const nz = sz / len;
    col = gridCuts(surf.floorY(x, z), surf.ceilY(x, z), seg).map((y) => {
      const o = flat ? 0 : surf.wallOffset(x, z, y, nx, nz);
      return { x: x + nx * o, y, z: z + nz * o };
    });
    columns.set(k, col);
    return col;
  };
  for (const f of level.faces) {
    const s = f.seg;
    if (Math.hypot(s.bx - s.ax, s.bz - s.az) < 1e-6) continue;
    const white = f.kind === 'start';
    const mx = (s.ax + s.bx) / 2;
    const mz = (s.az + s.bz) / 2;
    // The tint of the space this wall faces, not of what lies behind it.
    const t = surf.flesh(mx + f.nx * 1.5, mz + f.nz * 1.5);
    // Faces along x (normal along z) are lighter, as before.
    const alongX = Math.abs(f.nz) >= Math.abs(f.nx);
    const base = white ? COLORS.start : mix(alongX ? COLORS.wallX : COLORS.wallZ, alongX ? FLESH.wallX : FLESH.wallZ, t);
    addWall((white ? signal : world).at(mx, mz), column(s.ax, s.az, white), column(s.bx, s.bz, white), base, !white);
  }
  const group = new THREE.Group();
  group.add(...world.meshes(), ...signal.meshes());
  return group;
}

/** Plan distance from (x, z) to a chunk's bounds; 0 inside. */
export function chunkDistance(b: ChunkBounds, x: number, z: number): number {
  return Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1));
}
