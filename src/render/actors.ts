import * as THREE from 'three';
import { tuning } from '../config/tuning';
import type { Point } from '../sim/level/geometry';
import type { Level } from '../sim/level/level';
import type { World } from '../sim/world';
import { patchMaterial } from './camera/fisheyeShader';
import { GeometryBuilder, cuts } from './levelMesh';

// EYE and the green line (GDD §10, VISUAL.md §2). Neither fades in fog; both
// vanish the moment the EYE is taken.

const GREEN = 0x39ff6a;

function worldMaterial(params: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ fog: false, ...params });
  patchMaterial(m);
  return m;
}

/** Flat ribbon over the floor, cut for the fisheye; each piece overlaps the joints by half a width. */
function buildRouteGeometry(route: readonly Point[], width: number, lift: number, seg: number): THREE.BufferGeometry {
  const b = new GeometryBuilder();
  const h = width / 2;
  for (let i = 0; i + 1 < route.length; i++) {
    const p = route[i]!;
    const q = route[i + 1]!;
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (len < 1e-6) continue;
    const dx = (q.x - p.x) / len;
    const dz = (q.z - p.z) / len;
    const nx = -dz * h;
    const nz = dx * h;
    const ts = cuts(-h, len + h, seg);
    for (let j = 0; j + 1 < ts.length; j++) {
      const a = { x: p.x + dx * ts[j]!, z: p.z + dz * ts[j]! };
      const c = { x: p.x + dx * ts[j + 1]!, z: p.z + dz * ts[j + 1]! };
      b.quad(
        { x: a.x + nx, y: lift, z: a.z + nz },
        { x: c.x + nx, y: lift, z: c.z + nz },
        { x: c.x - nx, y: lift, z: c.z - nz },
        { x: a.x - nx, y: lift, z: a.z - nz },
        GREEN,
      );
    }
  }
  return b.build();
}

function buildEye(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), worldMaterial({ color: 0x1a2a1f }));
  const iris = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 8, 32), worldMaterial({ color: GREEN }));
  iris.position.z = 0.46;
  const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.16, 24), worldMaterial({ color: 0x000000 }));
  pupil.position.z = 0.49;
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.75, 16, 12),
    worldMaterial({ color: GREEN, transparent: true, opacity: 0.12, depthWrite: false }),
  );
  g.add(body, iris, pupil, glow);
  g.traverse((o) => (o.frustumCulled = false));
  return g;
}

export class Actors {
  readonly root = new THREE.Group();
  private readonly eye = buildEye();
  private readonly route: THREE.Mesh;
  private key: { level: Level; width: number; lift: number; segment: number } | null = null;

  constructor() {
    this.route = new THREE.Mesh(new THREE.BufferGeometry(), worldMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.route.frustumCulled = false;
    this.root.add(this.eye, this.route);
  }

  update(world: World, frameSeconds: number): void {
    this.syncRoute(world.level);
    const inward = world.phase === 'INWARD';
    this.eye.visible = inward;
    this.route.visible = inward;
    const e = world.level.eye;
    this.eye.position.set(e.x, tuning.eye.HEIGHT, e.z);
    // Built with radius 0.5; slightly flattened (GDD §10).
    const k = tuning.eye.SIZE / 0.5;
    this.eye.scale.set(k, k * 0.85, k);
    if (!world.simFrozen) this.eye.rotation.y += tuning.eye.SPIN * frameSeconds;
  }

  private syncRoute(level: Level): void {
    const { LINE_WIDTH: width, LINE_LIFT: lift } = tuning.route;
    const segment = tuning.view.MESH_SEGMENT;
    const k = this.key;
    if (k && k.level === level && k.width === width && k.lift === lift && k.segment === segment) return;
    this.key = { level, width, lift, segment };
    this.route.geometry.dispose();
    this.route.geometry = buildRouteGeometry(level.route, width, lift, Math.max(0.1, segment));
  }
}
