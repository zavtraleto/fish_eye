// View angles on the (x, z) plane. Yaw 0 looks along -z; positive yaw turns left.

/** Unit forward and right vectors for a yaw. */
export function yawAxes(yaw: number): { fx: number; fz: number; rx: number; rz: number } {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return { fx: -s, fz: -c, rx: c, rz: -s };
}

/** Yaw that looks along (dx, dz); inverse of `yawAxes` forward. */
export function yawTo(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}
