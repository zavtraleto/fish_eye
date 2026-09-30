import { tuning } from '../src/config/tuning';
import { noButtons, type Command } from '../src/core/input/commands';
import { closestOnSegment, type Point, type Segment } from '../src/sim/level/geometry';
import { yawTo } from '../src/sim/look';
import type { World } from '../src/sim/world';

/** Minimum distance from a point to any wall. */
export function wallClearance(walls: readonly Segment[], x: number, z: number): number {
  let best = Infinity;
  for (const s of walls) {
    const c = closestOnSegment(s, x, z);
    best = Math.min(best, Math.hypot(x - c.x, z - c.z));
  }
  return best;
}

export function idle(world: World, ticks = 1, commands: Command[] = []): void {
  for (let i = 0; i < ticks; i++) world.step({ commands: i === 0 ? commands : [], held: noButtons(), yaw: 0 });
}

/**
 * Runs forward through `points`, turning toward each in turn, until `done`
 * or the tick budget runs out. Returns the ticks used.
 */
export function walk(world: World, points: readonly Point[], done: () => boolean, maxSeconds = 60): number {
  const held = { ...noButtons(), forward: true };
  let i = 0;
  let ticks = 0;
  const budget = maxSeconds * tuning.sim.SIM_HZ;
  while (!done() && ticks < budget) {
    const p = world.player;
    let target = points[Math.min(i, points.length - 1)]!;
    while (i < points.length - 1 && Math.hypot(target.x - p.x, target.z - p.z) < 0.5) target = points[++i]!;
    world.step({ commands: [], held, yaw: yawTo(target.x - p.x, target.z - p.z) });
    ticks++;
  }
  return ticks;
}
