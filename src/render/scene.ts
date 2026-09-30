import * as THREE from 'three';
import { tuning } from '../config/tuning';
import type { Look } from '../core/input/commands';
import type { Level } from '../sim/level/level';
import type { World } from '../sim/world';
import { signalFogScale } from './camera/fisheyeShader';
import { VertexFisheyeProjection, type Eye, type Projection } from './camera/projection';
import { Actors } from './actors';
import { buildLevelMesh } from './levelMesh';
import { RearVision } from './rearVision';

// Greybox first-person view (docs/VISUAL.md): reads World, never mutates it.

const FOG_COLOR = 0x05060a;

export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly fog = new THREE.Fog(FOG_COLOR, 5, 20);
  private readonly projection: Projection = new VertexFisheyeProjection();
  private readonly actors = new Actors();
  private readonly rear = new RearVision();
  private levelMesh: THREE.Group | null = null;
  private meshKey: { level: Level; segment: number } | null = null;
  private sizeKey = '';
  private width = 1;
  private height = 1;
  private readonly eye: Eye = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  /** Eye height above the feet, eased toward the slide height and back (GDD §5.6). */
  private eyeHeight = tuning.player.EYE_HEIGHT;

  constructor(private readonly parent: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(FOG_COLOR);
    this.renderer.domElement.id = 'game-canvas';
    parent.appendChild(this.renderer.domElement);
    this.scene.fog = this.fog;
    this.scene.add(this.actors.root, this.rear.root);
  }

  render(world: World, look: Look, alpha: number, frameSeconds: number): void {
    this.syncSize();
    this.syncLevel(world.level);
    this.fog.near = tuning.view.FOG_NEAR;
    this.fog.far = tuning.view.FOG_FAR;
    signalFogScale.value = tuning.view.FOG_FAR / Math.max(1e-3, tuning.view.SIGNAL_FOG_FAR);
    this.actors.update(world, frameSeconds, alpha);

    const p = world.player;
    this.eye.x = p.prevX + (p.x - p.prevX) * alpha;
    this.eye.z = p.prevZ + (p.z - p.prevZ) * alpha;
    const m = p.move;
    const target = m.mode === 'slide' ? tuning.slide.EYE_HEIGHT : tuning.player.EYE_HEIGHT;
    this.eyeHeight += (target - this.eyeHeight) * (1 - Math.exp(-frameSeconds / Math.max(1e-3, tuning.slide.CAMERA_TIME)));
    this.eye.y = m.prevY + (m.y - m.prevY) * alpha + this.eyeHeight;
    this.eye.yaw = look.yaw;
    this.eye.pitch = look.pitch;
    this.rear.update(world, this.eye, this.projection.halfFovH(), alpha);
    this.projection.render(this.renderer, this.scene, this.eye, this.width, this.height);
  }

  /** Internal resolution: the canvas is `INTERNAL_SCALE` of the window, CSS upscales it without smoothing. */
  private syncSize(): void {
    const cssW = Math.max(1, this.parent.clientWidth);
    const cssH = Math.max(1, this.parent.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, tuning.view.MAX_PIXEL_RATIO);
    const scale = Math.min(1, Math.max(0.05, tuning.view.INTERNAL_SCALE));
    const key = `${cssW}x${cssH}@${ratio}*${scale}`;
    if (key === this.sizeKey) return;
    this.sizeKey = key;
    this.width = Math.max(1, Math.round(cssW * ratio * scale));
    this.height = Math.max(1, Math.round(cssH * ratio * scale));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.width, this.height, false);
  }

  /** Rebuilds the mesh for a new level or a new `MESH_SEGMENT`. */
  private syncLevel(level: Level): void {
    const segment = tuning.view.MESH_SEGMENT;
    if (this.meshKey?.level === level && this.meshKey.segment === segment) return;
    this.meshKey = { level, segment };
    if (this.levelMesh) {
      this.scene.remove(this.levelMesh);
      for (const m of this.levelMesh.children as THREE.Mesh[]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    }
    this.levelMesh = buildLevelMesh(level, segment);
    this.scene.add(this.levelMesh);
  }
}
