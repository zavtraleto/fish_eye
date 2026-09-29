import * as THREE from 'three';
import { tuning } from '../config/tuning';
import type { SimEvent } from '../sim/events';
import type { World } from '../sim/world';

// Greybox view (docs/VISUAL.md): reads World, never mutates it. One-shot
// effects come from SimEvents, not from peeking at sim state.

const COLORS = {
  bg: 0x0b0e14,
  tileA: 0x1b2233,
  tileB: 0x222b40,
  player: 0xe8f0ff,
  pip: 0xffd45e,
  flash: 0xffd45e,
};

interface Flash {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  age: number;
}

export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  private readonly tiles = new THREE.Group();
  private readonly player: THREE.Mesh;
  private readonly pip: THREE.Mesh;
  private readonly flashGeo = new THREE.RingGeometry(0.3, 0.42, 24);
  private readonly flashes: Flash[] = [];
  private gridKey = '';
  private shake = 0;

  constructor(private readonly parent: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(COLORS.bg);
    this.renderer.domElement.id = 'game-canvas';
    parent.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xdde6ff, 0x101420, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(2, 6, 3);
    this.scene.add(sun, this.tiles);

    this.player = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshLambertMaterial({ color: COLORS.player }));
    this.pip = new THREE.Mesh(new THREE.OctahedronGeometry(0.22), new THREE.MeshLambertMaterial({ color: COLORS.pip, emissive: 0x3a2a00 }));
    this.scene.add(this.player, this.pip);
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.parent.clientWidth);
    const h = Math.max(1, this.parent.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tuning.view.MAX_PIXEL_RATIO));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
  }

  /** One-shot effects. Called once per drained event. */
  onEvent(e: SimEvent): void {
    if (e.type === 'pickup') this.spawnFlash(e.x, e.y);
    else if (e.type === 'bumped') this.shake = 0.12;
  }

  render(world: World, alpha: number, frameSeconds: number): void {
    this.syncGrid();
    this.placeCamera(frameSeconds);

    const p = world.player;
    const k = easeOut(world.moveProgress(world.simFrozen ? 0 : alpha));
    const x = p.fromX + (p.x - p.fromX) * k;
    const y = p.fromY + (p.y - p.fromY) * k;
    this.player.position.copy(this.cellToWorld(x, y, 0.3 + Math.sin(k * Math.PI) * 0.25));

    this.pip.position.copy(this.cellToWorld(world.pip.x, world.pip.y, 0.35));
    this.pip.rotation.y += frameSeconds * 2;

    this.updateFlashes(frameSeconds);
    this.renderer.render(this.scene, this.camera);
  }

  private cellToWorld(x: number, y: number, height: number): THREE.Vector3 {
    const { GRID_W, GRID_H } = tuning.field;
    return new THREE.Vector3(x - (GRID_W - 1) / 2, height, y - (GRID_H - 1) / 2);
  }

  /** Rebuilds the tiles when the grid size changes in the debug panel. */
  private syncGrid(): void {
    const { GRID_W, GRID_H } = tuning.field;
    const key = `${GRID_W}x${GRID_H}`;
    if (key === this.gridKey) return;
    this.gridKey = key;
    for (const c of this.tiles.children) (c as THREE.Mesh).geometry.dispose();
    this.tiles.clear();
    const geo = new THREE.BoxGeometry(0.94, 0.1, 0.94);
    const mats = [new THREE.MeshLambertMaterial({ color: COLORS.tileA }), new THREE.MeshLambertMaterial({ color: COLORS.tileB })];
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const tile = new THREE.Mesh(geo, mats[(x + y) % 2]);
        tile.position.copy(this.cellToWorld(x, y, -0.05));
        this.tiles.add(tile);
      }
    }
  }

  /** Fits the whole grid in the view at any aspect ratio. */
  private placeCamera(frameSeconds: number): void {
    const { GRID_W, GRID_H } = tuning.field;
    const { CAMERA_FOV, CAMERA_PITCH } = tuning.view;
    this.camera.fov = CAMERA_FOV;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV) / 2);
    const pitch = THREE.MathUtils.degToRad(CAMERA_PITCH);
    const depth = GRID_H * Math.sin(pitch);
    const dist = 1.15 * Math.max(depth / (2 * tanHalf), GRID_W / (2 * tanHalf * this.camera.aspect)) + GRID_H / 2;
    this.shake = Math.max(0, this.shake - frameSeconds);
    const jitter = this.shake > 0 ? Math.sin(this.shake * 120) * this.shake * 0.4 : 0;
    this.camera.position.set(jitter, Math.sin(pitch) * dist, Math.cos(pitch) * dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  private spawnFlash(x: number, y: number): void {
    const mesh = new THREE.Mesh(this.flashGeo, new THREE.MeshBasicMaterial({ color: COLORS.flash, transparent: true }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(this.cellToWorld(x, y, 0.02));
    this.scene.add(mesh);
    this.flashes.push({ mesh, age: 0 });
  }

  private updateFlashes(frameSeconds: number): void {
    const life = Math.max(0.01, tuning.view.PICKUP_FLASH_TIME);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      f.age += frameSeconds;
      const t = f.age / life;
      if (t >= 1) {
        this.scene.remove(f.mesh);
        f.mesh.material.dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      f.mesh.scale.setScalar(1 + t * 1.5);
      f.mesh.material.opacity = 1 - t;
    }
  }
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
