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

/** A projection, not a body: scanlines, static and torn bands (GDD §12). */
const HOLO_HEAD = /* glsl */ `
uniform float uHoloTime;
uniform float uGlitch;
uniform float uNoise;
uniform float uScan;
float holoHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

// Whole vertices slide sideways in a few screen bands at a time.
const HOLO_VERTEX = /* glsl */ `
{
  float band = floor((gl_Position.y / gl_Position.w) * 14.0);
  float h = holoHash(vec2(band, floor(uHoloTime * 14.0)));
  float tear = step(1.0 - 0.35 * uGlitch, h);
  gl_Position.x += tear * (h - 0.5) * 0.25 * uGlitch * gl_Position.w;
}
`;

const HOLO_FRAGMENT = /* glsl */ `
{
  float t = floor(uHoloTime * 30.0);
  float scan = 1.0 - uScan * 0.6 * step(0.5, fract(gl_FragCoord.y / 3.0));
  float n = holoHash(floor(gl_FragCoord.xy / 2.0) + t);
  if (n < uNoise * 0.35) discard;
  float row = floor(gl_FragCoord.y / 10.0);
  float g = holoHash(vec2(row, t));
  float gap = 1.0 - step(1.0 - 0.12 * uGlitch, g);
  float bright = 1.0 + step(1.0 - 0.06 * uGlitch, holoHash(vec2(row + 7.0, t))) * 0.8;
  gl_FragColor.rgb *= bright * mix(1.0, 0.6 + 0.8 * n, uNoise);
  gl_FragColor.a *= scan * gap * mix(1.0, 0.4 + 1.2 * n, uNoise);
}
`;

export class RearVision {
  readonly root: THREE.Group;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly holo = { uHoloTime: { value: 0 }, uGlitch: { value: 0 }, uNoise: { value: 0 }, uScan: { value: 0 } };
  private held: { x: number; y: number; z: number } | null = null;

  constructor() {
    this.material = new THREE.MeshBasicMaterial({
      color: RED,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    patchMaterial(this.material);
    const fisheye = this.material.onBeforeCompile.bind(this.material);
    this.material.onBeforeCompile = (shader, renderer) => {
      fisheye(shader, renderer);
      Object.assign(shader.uniforms, this.holo);
      const projected = 'gl_Position = fisheyeProject(mvPosition.xyz);';
      shader.vertexShader = (HOLO_HEAD + shader.vertexShader).replace(projected, `${projected}\n${HOLO_VERTEX}`);
      shader.fragmentShader = (HOLO_HEAD + shader.fragmentShader).replace('#include <dithering_fragment>', `${HOLO_FRAGMENT}\n#include <dithering_fragment>`);
    };
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
    const shown = this.held;
    this.held = null;
    if (!e) return;
    const ex = e.prevX + (e.x - e.prevX) * alpha;
    const ez = e.prevZ + (e.z - e.prevZ) * alpha;
    const { fx, fz } = yawAxes(e.yaw);
    const m = mirrorRear(eye, halfFov, r.PROXY_RANGE, ex, ez, fx, fz);
    if (!m) return;

    const seen = lineOfSight(world.level.wallIndex, eye, { x: ex, z: ez });
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
    this.holo.uHoloTime.value = world.uiTick / tuning.sim.SIM_HZ;
    this.holo.uGlitch.value = r.GLITCH;
    this.holo.uNoise.value = r.NOISE;
    this.holo.uScan.value = r.SCANLINES;
    // Frame skips: the signal sometimes freezes for a moment, then catches up.
    this.held = shown;
    if (!this.held || Math.random() > r.GLITCH * 0.3) {
      this.held = {
        x: m.x + (Math.random() - 0.5) * jitter,
        y: c.HOVER + c.HEIGHT / 2 + (Math.random() - 0.5) * jitter,
        z: m.z + (Math.random() - 0.5) * jitter,
      };
    }
    this.root.position.set(this.held.x, this.held.y, this.held.z);
    this.root.rotation.set(0, yawTo(m.dirX, m.dirZ), 0);
    this.root.scale.set(c.RADIUS * sx, (c.HEIGHT / 2) * (sx + sz) * 0.5, c.RADIUS * sz);
    this.material.color.setHex(color);
    this.material.opacity = opacity;
  }
}
