import { tuning } from '../config/tuning';
import type { HeldButtons } from '../core/input/commands';
import { closestOnSegment, type Segment } from './level/geometry';

// Player movement (GDD §3.1): Quake-like acceleration and friction, circle
// collision against wall segments with sliding and substeps.

export interface Player {
  x: number;
  z: number;
  /** Position at the start of the last tick; render interpolates from it. */
  prevX: number;
  prevZ: number;
  vx: number;
  vz: number;
}

export function createPlayer(x: number, z: number): Player {
  return { x, z, prevX: x, prevZ: z, vx: 0, vz: 0 };
}

/** Unit forward and right vectors on the (x, z) plane for a yaw (0 looks along -z). */
export function yawAxes(yaw: number): { fx: number; fz: number; rx: number; rz: number } {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return { fx: -s, fz: -c, rx: c, rz: -s };
}

/** Yaw that looks along (dx, dz); inverse of `yawAxes` forward. */
export function yawTo(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
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

export function stepPlayer(p: Player, held: HeldButtons, yaw: number, walls: readonly Segment[], dt: number): void {
  const { MOVE_SPEED, ACCEL, FRICTION } = tuning.player;
  const wish = wishDir(held, yaw);
  const moving = wish.x !== 0 || wish.z !== 0;
  approachVelocity(p, wish.x * MOVE_SPEED, wish.z * MOVE_SPEED, (moving ? ACCEL : FRICTION) * dt);

  p.prevX = p.x;
  p.prevZ = p.z;
  moveAndSlide(p, walls, dt);
}

/** Moves the velocity toward the target by at most `maxDelta`. */
function approachVelocity(p: Player, tx: number, tz: number, maxDelta: number): void {
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
export function moveAndSlide(p: Player, walls: readonly Segment[], dt: number): void {
  const radius = tuning.player.RADIUS;
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
function resolveWalls(p: Player, walls: readonly Segment[], radius: number): void {
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
