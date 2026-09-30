import * as THREE from 'three';
import { secondsToTicks as T, tuning } from '../config/tuning';
import type { Enemy } from '../sim/enemy';
import type { Point } from '../sim/level/geometry';
import type { Level } from '../sim/level/level';
import type { World } from '../sim/world';
import { patchMaterial } from './camera/fisheyeShader';
import { GeometryBuilder, cuts } from './levelMesh';

// EYE, the green line (GDD §10) and the enemy (GDD §11), VISUAL.md §2. Signal
// colours never fade in fog; the EYE and the line vanish the moment it is taken.

const GREEN = 0x39ff6a;
const RED = 0xff2a2a;
const RED_FLASH = 0xff9a9a;
const RED_DIM = 0x5a0e0e;

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

/** Greybox enemy: a low-poly red body with a snout pointing along its facing (-z). */
function buildEnemy(material: THREE.MeshBasicMaterial): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), material);
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 5), material);
  snout.rotation.x = -Math.PI / 2;
  snout.position.z = -1.1;
  g.add(body, snout);
  g.traverse((o) => (o.frustumCulled = false));
  return g;
}

export class Actors {
  readonly root = new THREE.Group();
  private readonly eye = buildEye();
  private readonly route: THREE.Mesh;
  private readonly enemyMaterial = worldMaterial({ color: RED, transparent: true });
  private readonly enemy = buildEnemy(this.enemyMaterial);
  private key: { level: Level; width: number; lift: number; segment: number } | null = null;

  constructor() {
    this.route = new THREE.Mesh(new THREE.BufferGeometry(), worldMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.route.frustumCulled = false;
    this.root.add(this.eye, this.route, this.enemy);
  }

  update(world: World, frameSeconds: number, alpha: number): void {
    this.updateEnemy(world, alpha);
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

  /** Windup swells and flashes, a charge stretches, a spawn flickers, a stun goes dim (GDD §11). */
  private updateEnemy(world: World, alpha: number): void {
    const e: Enemy | null = world.enemy;
    this.enemy.visible = e !== null;
    if (!e) return;
    const c = tuning.enemy;
    this.enemy.position.set(e.prevX + (e.x - e.prevX) * alpha, c.HOVER + c.HEIGHT / 2, e.prevZ + (e.z - e.prevZ) * alpha);
    this.enemy.rotation.set(0, e.yaw, 0);
    const age = world.tick - e.stateTick;
    const blink = (world.uiTick >> 2) % 2 === 0;
    let sx = 1;
    let sy = 1;
    let sz = 1;
    let color = RED;
    let opacity = 1;
    switch (e.state) {
      case 'MATERIALIZE':
        opacity = blink ? 0.6 : 0.2;
        break;
      case 'WINDUP': {
        const k = Math.min(1, age / Math.max(1, T(c.WINDUP_TIME)));
        sx = sy = sz = 1 + 0.3 * k;
        color = blink ? RED_FLASH : RED;
        break;
      }
      case 'CHARGE':
        sx = sy = 0.75;
        sz = 1.8;
        break;
      case 'STUNNED':
        color = RED_DIM;
        this.enemy.rotation.z = Math.sin(world.uiTick * 0.5) * 0.3;
        break;
      default:
        break;
    }
    this.enemy.scale.set(c.RADIUS * sx, (c.HEIGHT / 2) * sy, c.RADIUS * sz);
    this.enemyMaterial.color.setHex(color);
    this.enemyMaterial.opacity = opacity;
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
