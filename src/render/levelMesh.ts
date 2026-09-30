import * as THREE from 'three';
import type { Point } from '../sim/level/geometry';
import type { Level, WallFace } from '../sim/level/level';
import { patchMaterial } from './camera/fisheyeShader';

// Greybox level geometry (VISUAL.md §2, §5) from the sim's raster level: floor
// and ceiling are the free parts of raster cells, walls the contour segments,
// all with shared vertices (VISUAL.md §11). Walls are cut in height by
// `segment` so the vertex fisheye can bend them. Flat vertex colours, no lights.

const COLORS = {
  floorA: 0x4a4d56,
  floorB: 0x40434b,
  ceiling: 0x2a2c32,
  wallX: 0x383b43,
  wallZ: 0x30333a,
  /** START / EXIT (VISUAL.md §2). */
  start: 0xf4f4ec,
};
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

/** A convex piece as a fan at height y. */
function addPiece(b: GeometryBuilder, pts: readonly Point[], y: number, hex: number): void {
  const p0 = pts[0]!;
  for (let k = 1; k + 1 < pts.length; k++) {
    const p = pts[k]!;
    const q = pts[k + 1]!;
    b.tri({ x: p0.x, y, z: p0.z }, { x: p.x, y, z: p.z }, { x: q.x, y, z: q.z }, hex);
  }
}

/** A wall quad cut in height only: contour segments are already shorter than a cell. */
function addFace(b: GeometryBuilder, f: WallFace, seg: number): void {
  const s = f.seg;
  if (Math.hypot(s.bx - s.ax, s.bz - s.az) < 1e-6) return;
  // Faces along x (normal along z) are lighter, as before.
  const base = f.kind === 'start' ? COLORS.start : Math.abs(f.nz) >= Math.abs(f.nx) ? COLORS.wallX : COLORS.wallZ;
  const ys = gridCuts(f.y0, f.y1, seg);
  for (let j = 0; j + 1 < ys.length; j++) {
    const y0 = ys[j]!;
    const y1 = ys[j + 1]!;
    // A lighter band at waist height marks the wall's extent while running.
    const hex = f.kind === 'wall' && y0 < 1.2 && y1 > 1.0 ? base + 0x080808 : base;
    b.quad({ x: s.ax, y: y0, z: s.az }, { x: s.bx, y: y0, z: s.bz }, { x: s.bx, y: y1, z: s.bz }, { x: s.ax, y: y1, z: s.az }, hex);
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
  const world = new Chunks(Math.max(4, chunk), false);
  const signal = new Chunks(Math.max(4, chunk), true);
  for (const piece of level.floor) {
    const pts = piece.points;
    const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
    const cz = pts.reduce((sum, p) => sum + p.z, 0) / pts.length;
    const b = world.at(cx, cz);
    addPiece(b, pts, 0, tileParity(cx, cz) ? COLORS.floorA : COLORS.floorB);
    addPiece(b, pts, level.zones[piece.zone]!.height, COLORS.ceiling);
  }
  for (const f of level.faces) {
    const mx = (f.seg.ax + f.seg.bx) / 2;
    const mz = (f.seg.az + f.seg.bz) / 2;
    addFace((f.kind === 'start' ? signal : world).at(mx, mz), f, seg);
  }
  const group = new THREE.Group();
  group.add(...world.meshes(), ...signal.meshes());
  return group;
}

/** Plan distance from (x, z) to a chunk's bounds; 0 inside. */
export function chunkDistance(b: ChunkBounds, x: number, z: number): number {
  return Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1));
}
