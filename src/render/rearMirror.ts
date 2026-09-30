import { yawAxes } from '../sim/look';

// Rear-view mirror (GDD §12): an enemy behind the view is shown in front, the
// forward component of its offset negated. Side and distance are kept, so rear
// left becomes front left. Pure: tested in tests/rear.test.ts.

export interface Mirrored {
  x: number;
  z: number;
  /** The enemy's facing reflected the same way. */
  dirX: number;
  dirZ: number;
  distance: number;
}

/**
 * Where to draw the proxy of an enemy at (ex, ez) facing (dirX, dirZ), or
 * null while the enemy is inside the view (`halfFov` radians off the axis)
 * or farther than `range`.
 */
export function mirrorRear(
  eye: { x: number; z: number; yaw: number },
  halfFov: number,
  range: number,
  ex: number,
  ez: number,
  dirX: number,
  dirZ: number,
): Mirrored | null {
  const ox = ex - eye.x;
  const oz = ez - eye.z;
  const distance = Math.hypot(ox, oz);
  if (distance > range) return null;
  const { fx, fz, rx, rz } = yawAxes(eye.yaw);
  const f = ox * fx + oz * fz;
  const s = ox * rx + oz * rz;
  if (Math.atan2(Math.abs(s), f) <= halfFov) return null;
  const df = dirX * fx + dirZ * fz;
  const ds = dirX * rx + dirZ * rz;
  return {
    x: eye.x - f * fx + s * rx,
    z: eye.z - f * fz + s * rz,
    dirX: -df * fx + ds * rx,
    dirZ: -df * fz + ds * rz,
    distance,
  };
}
