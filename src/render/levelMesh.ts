import * as THREE from 'three';
import type { Rect } from '../sim/level/geometry';
import type { Level, WallFace } from '../sim/level/level';
import { patchMaterial } from './camera/fisheyeShader';

// Greybox level geometry (VISUAL.md §2, §5): floors, ceilings and walls from the
// sim's 2D level, cut into quads of `segment` meters so the vertex fisheye can
// bend them. Flat vertex colours, no lights.

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

function addPlane(b: GeometryBuilder, r: Rect, y: number, seg: number, color: (x: number, z: number) => number): void {
  const xs = gridCuts(r.x0, r.x1, seg);
  const zs = gridCuts(r.z0, r.z1, seg);
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < zs.length; j++) {
      const x0 = xs[i]!;
      const x1 = xs[i + 1]!;
      const z0 = zs[j]!;
      const z1 = zs[j + 1]!;
      const hex = color((x0 + x1) / 2, (z0 + z1) / 2);
      b.quad({ x: x0, y, z: z0 }, { x: x0, y, z: z1 }, { x: x1, y, z: z1 }, { x: x1, y, z: z0 }, hex);
    }
  }
}

function addFace(b: GeometryBuilder, f: WallFace, seg: number): void {
  const s = f.seg;
  const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
  if (len < 1e-6) return;
  const alongX = Math.abs(s.bx - s.ax) >= Math.abs(s.bz - s.az);
  // Walls are axis-aligned: cut them on the same world grid as the floors.
  const a0 = alongX ? s.ax : s.az;
  const a1 = alongX ? s.bx : s.bz;
  const grid = gridCuts(Math.min(a0, a1), Math.max(a0, a1), seg).map((v) => Math.abs(v - a0));
  const ts = a1 >= a0 ? grid : grid.reverse();
  const ys = gridCuts(f.y0, f.y1, seg);
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i]! / len;
    const t1 = ts[i + 1]! / len;
    const p0 = { x: s.ax + (s.bx - s.ax) * t0, z: s.az + (s.bz - s.az) * t0 };
    const p1 = { x: s.ax + (s.bx - s.ax) * t1, z: s.az + (s.bz - s.az) * t1 };
    for (let j = 0; j + 1 < ys.length; j++) {
      const y0 = ys[j]!;
      const y1 = ys[j + 1]!;
      let hex = COLORS.start;
      if (f.kind === 'wall') {
        const base = alongX ? COLORS.wallX : COLORS.wallZ;
        // A lighter band at waist height marks the wall's extent while running.
        hex = y0 < 1.2 && y1 > 1.0 ? base + 0x080808 : base;
      }
      b.quad({ x: p0.x, y: y0, z: p0.z }, { x: p1.x, y: y0, z: p1.z }, { x: p1.x, y: y1, z: p1.z }, { x: p0.x, y: y1, z: p0.z }, hex);
    }
  }
}

/** The level; the white START wall is a separate signal mesh that fades over the long range (GDD §10). */
export function buildLevelMesh(level: Level, segment: number): THREE.Group {
  const seg = Math.max(0.1, segment);
  const world = new GeometryBuilder();
  const signal = new GeometryBuilder();
  for (const a of level.areas) {
    addPlane(world, a.rect, 0, seg, (x, z) => (tileParity(x, z) ? COLORS.floorA : COLORS.floorB));
    addPlane(world, a.rect, a.height, seg, () => COLORS.ceiling);
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
