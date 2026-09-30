import { tuning } from '../config/tuning';
import type { HeldButtons } from '../core/input/commands';
import { closestOnSegment, type Segment } from './level/geometry';
import { yawAxes } from './look';
import { createMove, type MoveState } from './move/state';

// The player (GDD §3.1): a circle on the floor plane that slides along wall
// segments, plus the movement state of GDD §5. Motion lives in move/motion.ts.

/** Anything that moves on the floor plane and collides with walls. */
export interface Body {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

export interface Player {
  x: number;
  z: number;
  /** Position at the start of the last tick; render interpolates from it. */
  prevX: number;
  prevZ: number;
  vx: number;
  vz: number;
  readonly move: MoveState;
}

export function createPlayer(x: number, z: number): Player {
  return { x, z, prevX: x, prevZ: z, vx: 0, vz: 0, move: createMove() };
}

/** Wished direction from held keys, normalized so a diagonal is no faster (GDD §3.1). */
export function wishDir(held: HeldButtons, yaw: number): { x: number; z: number } {
  const f = (held.forward ? 1 : 0) - (held.back ? 1 : 0);
  const r = (held.right ? 1 : 0) - (held.left ? 1 : 0);
  if (f === 0 && r === 0) return { x: 0, z: 0 };
  const { fx, fz, rx, rz } = yawAxes(yaw);
  const x = fx * f + rx * r;
  const z = fz * f + rz * r;
  const len = Math.hypot(x, z);
  return { x: x / len, z: z / len };
}

export function horizontalSpeed(p: Player): number {
  return Math.hypot(p.vx, p.vz);
}

/** Moves the velocity toward the target by at most `maxDelta`. */
export function approachVelocity(p: Body, tx: number, tz: number, maxDelta: number): void {
  const dx = tx - p.vx;
  const dz = tz - p.vz;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta) {
    p.vx = tx;
    p.vz = tz;
  } else {
    p.vx += (dx / d) * maxDelta;
    p.vz += (dz / d) * maxDelta;
  }
}

/**
 * Moves by velocity·dt in substeps no longer than `SUBSTEP` (shorter than the
 * radius, so the centre never crosses a wall), pushing out of walls after each
 * and dropping the velocity component into them.
 */
export function moveAndSlide(p: Body, walls: readonly Segment[], dt: number, radius = tuning.player.WALL_RADIUS): void {
  const maxStep = Math.max(0.01, Math.min(tuning.player.SUBSTEP, radius * 0.5));
  const dist = Math.hypot(p.vx, p.vz) * dt;
  const steps = Math.max(1, Math.ceil(dist / maxStep));
  for (let i = 0; i < steps; i++) {
    const h = dt / steps;
    p.x += p.vx * h;
    p.z += p.vz * h;
    resolveWalls(p, walls, radius);
  }
}

/** Two passes settle inside corners, where pushing out of one wall pushes into another. */
function resolveWalls(p: Body, walls: readonly Segment[], radius: number): void {
  for (let pass = 0; pass < 2; pass++) {
    let touched = false;
    for (const w of walls) {
      const c = closestOnSegment(w, p.x, p.z);
      let nx = p.x - c.x;
      let nz = p.z - c.z;
      const d = Math.hypot(nx, nz);
      if (d >= radius) continue;
      if (d > 1e-9) {
        nx /= d;
        nz /= d;
      } else {
        // Centre exactly on the wall: push along the wall normal.
        const len = Math.hypot(w.bx - w.ax, w.bz - w.az) || 1;
        nx = -(w.bz - w.az) / len;
        nz = (w.bx - w.ax) / len;
      }
      p.x = c.x + nx * radius;
      p.z = c.z + nz * radius;
      const into = p.vx * nx + p.vz * nz;
      if (into < 0) {
        p.vx -= into * nx;
        p.vz -= into * nz;
      }
      touched = true;
    }
    if (!touched) return;
  }
}
