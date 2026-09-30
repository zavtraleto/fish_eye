import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks as T, tuning } from '../src/config/tuning';
import { noButtons, type Button } from '../src/core/input/commands';
import { rect, rectWalls, type Segment } from '../src/sim/level/geometry';
import { yawAxes, yawTo } from '../src/sim/look';
import { stepPlayer } from '../src/sim/move/motion';
import { createPlayer, moveAndSlide, wishDir, type Player } from '../src/sim/player';
import { wallClearance } from './helpers';

function held(...buttons: Button[]) {
  const h = noButtons();
  for (const b of buttons) h[b] = true;
  return h;
}

const OPEN = rectWalls(rect(-500, -500, 500, 500));

function run(p: Player, buttons: Button[], yaw: number, ticks: number, walls: readonly Segment[] = OPEN): void {
  for (let i = 0; i < ticks; i++) stepPlayer(p, { held: held(...buttons), pressed: false, yaw }, walls, 1 / tuning.sim.SIM_HZ, i);
}

const speed = (p: Player) => Math.hypot(p.vx, p.vz);

/** Ticks to change speed by `dv` at `rate` m/s². */
const ticksFor = (dv: number, rate: number) => Math.ceil((dv / rate) * tuning.sim.SIM_HZ - 1e-9);

describe('player movement (GDD §3.1)', () => {
  beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

  it('reaches full speed in MOVE_SPEED / ACCEL', () => {
    const p = createPlayer(0, 0);
    const ticks = ticksFor(tuning.player.MOVE_SPEED, tuning.player.ACCEL);
    run(p, ['forward'], 0, ticks - 1);
    expect(speed(p)).toBeLessThan(tuning.player.MOVE_SPEED);
    run(p, ['forward'], 0, 1);
    expect(speed(p)).toBeCloseTo(tuning.player.MOVE_SPEED, 6);
  });

  it('stops by friction in MOVE_SPEED / FRICTION', () => {
    const p = createPlayer(0, 0);
    run(p, ['forward'], 0, T(0.5));
    const ticks = ticksFor(tuning.player.MOVE_SPEED, tuning.player.FRICTION);
    run(p, [], 0, ticks - 1);
    expect(speed(p)).toBeGreaterThan(0);
    run(p, [], 0, 1);
    expect(speed(p)).toBe(0);
  });

  it('is no faster on a diagonal', () => {
    const p = createPlayer(0, 0);
    run(p, ['forward', 'left'], 0, T(0.5));
    expect(speed(p)).toBeCloseTo(tuning.player.MOVE_SPEED, 6);
  });

  it('moves relative to yaw: 0 looks along -z, positive yaw turns left', () => {
    const fwd = wishDir(held('forward'), 0);
    expect(fwd.x).toBeCloseTo(0);
    expect(fwd.z).toBeCloseTo(-1);
    const left = wishDir(held('forward'), Math.PI / 2);
    expect(left.x).toBeCloseTo(-1);
    expect(left.z).toBeCloseTo(0);
    const { rx, rz } = yawAxes(0);
    expect(rx).toBeCloseTo(1);
    expect(rz).toBeCloseTo(0);
  });

  it('yawTo inverts the forward axis', () => {
    for (const [dx, dz] of [[1, 0], [0, 1], [-3, 2], [0.5, -4]] as const) {
      const { fx, fz } = yawAxes(yawTo(dx, dz));
      const len = Math.hypot(dx, dz);
      expect(fx).toBeCloseTo(dx / len);
      expect(fz).toBeCloseTo(dz / len);
    }
  });

  it('opposite keys cancel', () => {
    expect(wishDir(held('forward', 'back', 'left', 'right'), 0)).toEqual({ x: 0, z: 0 });
  });

  it('never leaves a room, even at absurd speed', () => {
    tuning.player.MOVE_SPEED = 400;
    tuning.player.ACCEL = 100000;
    const room = rect(-6, -9, 6, 9);
    const walls = rectWalls(room);
    const p = createPlayer(0, 0);
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.37) {
      run(p, ['forward'], yaw, 30, walls);
      expect(p.x).toBeGreaterThan(room.x0);
      expect(p.x).toBeLessThan(room.x1);
      expect(p.z).toBeGreaterThan(room.z0);
      expect(p.z).toBeLessThan(room.z1);
      expect(wallClearance(walls, p.x, p.z)).toBeGreaterThanOrEqual(tuning.player.WALL_RADIUS - 1e-6);
    }
  });

  it('slides along a wall instead of stopping', () => {
    const walls = rectWalls(rect(-10, -10, 10, 10));
    const p = createPlayer(0, -10 + tuning.player.WALL_RADIUS);
    // Into the z0 wall at 45°, heading +x.
    run(p, ['forward'], -Math.PI / 4, T(0.5), walls);
    expect(p.z).toBeCloseTo(-10 + tuning.player.WALL_RADIUS, 6);
    expect(p.x).toBeGreaterThan(2);
    expect(p.vz).toBeCloseTo(0, 6);
  });

  it('rounds a pillar corner without snagging', () => {
    const walls = rectWalls(rect(-0.5, -0.5, 0.5, 0.5));
    // Heading -z, grazing the pillar's +x side.
    const p = createPlayer(0.5 + tuning.player.WALL_RADIUS * 0.5, 3);
    run(p, ['forward'], 0, T(1), walls);
    expect(p.z).toBeLessThan(-3);
    expect(wallClearance(walls, p.x, p.z)).toBeGreaterThanOrEqual(tuning.player.WALL_RADIUS - 1e-6);
  });

  it('does not tunnel through a thin wall in one long tick', () => {
    const walls: Segment[] = [{ ax: -5, az: 0, bx: 5, bz: 0 }];
    const p = createPlayer(0, 1);
    p.vz = -300;
    moveAndSlide(p, walls, 1 / 60);
    expect(p.z).toBeCloseTo(tuning.player.WALL_RADIUS, 6);
  });

  it('interpolates from the previous position', () => {
    const p = createPlayer(0, 0);
    run(p, ['forward'], 0, 5);
    expect(p.z - p.prevZ).toBeCloseTo(p.vz / tuning.sim.SIM_HZ, 6);
  });
});
