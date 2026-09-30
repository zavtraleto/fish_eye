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

/** The level; the white START wall is a separate signal mesh that fades over the long range (GDD §10). */
export function buildLevelMesh(level: Level, segment: number): THREE.Group {
  const seg = Math.max(0.1, segment);
  const world = new GeometryBuilder();
  const signal = new GeometryBuilder();
  for (const piece of level.floor) {
    const pts = piece.points;
    const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
    const cz = pts.reduce((sum, p) => sum + p.z, 0) / pts.length;
    addPiece(world, pts, 0, tileParity(cx, cz) ? COLORS.floorA : COLORS.floorB);
    addPiece(world, pts, level.zones[piece.zone]!.height, COLORS.ceiling);
  }
  for (const f of level.faces) addFace(f.kind === 'start' ? signal : world, f, seg);

  const group = new THREE.Group();
  for (const [b, isSignal] of [[world, false], [signal, true]] as const) {
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true });
    patchMaterial(material, { signal: isSignal });
    const mesh = new THREE.Mesh(b.build(), material);
    // The fisheye sees far outside the camera's perspective frustum.
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}
