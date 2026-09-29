import * as THREE from 'three';
import { tuning } from '../../config/tuning';
import { DEG, parseMapping } from './fisheyeMath';
import { fisheyeUniforms } from './fisheyeShader';

// Camera projection (GDD §4). The phase 1 spike chose the vertex fisheye;
// the interface stays so another projection can be tried behind it.

/** Eye position in three.js space (sim x, height, sim z) and view angles in radians. */
export interface Eye {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface Projection {
  /** Half the horizontal view angle, radians: beyond it the enemy is off-view (GDD §12). */
  halfFovH(): number;
  /** Renders to the canvas, whose drawing buffer is `width × height`. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, eye: Eye, width: number, height: number): void;
}

/** One pass: every vertex goes through the fisheye formula (world meshes are pre-cut, VISUAL.md §11). */
export class VertexFisheyeProjection implements Projection {
  /** Only supplies the view matrix; its projection matrix is unused. */
  private readonly camera = new THREE.PerspectiveCamera();

  halfFovH(): number {
    return (tuning.camera.H_FOV / 2) * DEG;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, eye: Eye, width: number, height: number): void {
    const c = tuning.camera;
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(eye.pitch, eye.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
    fisheyeUniforms.uHalfFov.value = this.halfFovH();
    fisheyeUniforms.uStereo.value = parseMapping(c.MAPPING) === 'stereographic' ? 1 : 0;
    fisheyeUniforms.uAspect.value = width / height;
    fisheyeUniforms.uNear.value = c.NEAR;
    fisheyeUniforms.uFar.value = c.FAR;
    renderer.render(scene, this.camera);
  }
}
