import * as THREE from 'three';
import { secondsToTicks as T, tuning } from '../config/tuning';
import { lineOfSight } from '../sim/level/query';
import { yawAxes, yawTo } from '../sim/look';
import type { World } from '../sim/world';
import { buildEnemy } from './actors';
import { patchMaterial } from './camera/fisheyeShader';
import type { Eye } from './camera/projection';
import { mirrorRear } from './rearMirror';

// Red proxy of an enemy behind the view (GDD §12): a shaky see-through body
// drawn over everything, dimmer through walls. View only; no second camera render.

const RED = 0xff2a2a;
const RED_FLASH = 0xff9a9a;

export class RearVision {
  readonly root: THREE.Group;
  private readonly material: THREE.MeshBasicMaterial;

  constructor() {
    this.material = new THREE.MeshBasicMaterial({
      color: RED,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    patchMaterial(this.material);
    // The enemy's own shape, see-through.
    this.root = buildEnemy(this.material);
    this.root.traverse((o) => (o.renderOrder = 10));
    this.root.visible = false;
  }

  update(world: World, eye: Eye, halfFov: number, alpha: number): void {
    const e = world.enemy;
    const r = tuning.rear;
    const c = tuning.enemy;
    this.root.visible = false;
    if (!e) return;
    const ex = e.prevX + (e.x - e.prevX) * alpha;
    const ez = e.prevZ + (e.z - e.prevZ) * alpha;
    const { fx, fz } = yawAxes(e.yaw);
    const m = mirrorRear(eye, halfFov, r.PROXY_RANGE, ex, ez, fx, fz);
    if (!m) return;

    const seen = lineOfSight(world.level.walls, eye, { x: ex, z: ez });
    const jitter = seen ? r.JITTER : r.HIDDEN_JITTER;
    const blink = (world.uiTick >> 2) % 2 === 0;
    const age = world.tick - e.stateTick;
    let sx = 1;
    let sz = 1;
    let color = RED;
    let opacity = seen ? r.OPACITY : r.HIDDEN_OPACITY;
    if (e.state === 'MATERIALIZE') opacity *= blink ? 1 : 0.3;
    else if (e.state === 'WINDUP') {
      // Swells and flashes: the telegraph must read in the mirror too.
      const k = Math.min(1, age / Math.max(1, T(c.WINDUP_TIME)));
      sx = sz = 1 + 0.5 * k;
      color = blink ? RED_FLASH : RED;
    } else if (e.state === 'CHARGE') {
      sx = 0.7;
      sz = 2.4;
    }

    this.root.visible = true;
    this.root.position.set(
      m.x + (Math.random() - 0.5) * jitter,
      c.HOVER + c.HEIGHT / 2 + (Math.random() - 0.5) * jitter,
      m.z + (Math.random() - 0.5) * jitter,
    );
    this.root.rotation.set(0, yawTo(m.dirX, m.dirZ), 0);
    this.root.scale.set(c.RADIUS * sx, (c.HEIGHT / 2) * (sx + sz) * 0.5, c.RADIUS * sz);
    this.material.color.setHex(color);
    this.material.opacity = opacity;
  }
}
