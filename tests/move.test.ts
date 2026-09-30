import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks as T, tuning } from '../src/config/tuning';
import { noButtons, type Button } from '../src/core/input/commands';
import type { MoveEvent } from '../src/sim/events';
import { buildLevel } from '../src/sim/level/build';
import { fixedLayout } from '../src/sim/level/fixed';
import { rect, rectWalls, type Segment } from '../src/sim/level/geometry';
import { yawTo } from '../src/sim/look';
import { dashTicks, stepPlayer } from '../src/sim/move/motion';
import { bodyRange, dashAvailable } from '../src/sim/move/state';
import { createPlayer, horizontalSpeed, type Player } from '../src/sim/player';
import { World } from '../src/sim/world';

const OPEN = rectWalls(rect(-500, -500, 500, 500));
/** Looks along +x. */
const EAST = yawTo(1, 0);

/** Drives one player like World.play does; `space` is the physical key. */
class Rig {
  tick = 0;
  space = false;
  readonly events: (MoveEvent & { tick: number })[] = [];
  constructor(
    readonly p: Player = createPlayer(0, 0),
    readonly walls: readonly Segment[] = OPEN,
  ) {}

  /** Runs ticks holding `keys`; `press` pushes Space down on the first one. */
  step(keys: Button[] = [], opts: { press?: boolean; release?: boolean; yaw?: number; times?: number } = {}): void {
    if (opts.press) this.space = true;
    if (opts.release) this.space = false;
    for (let i = 0; i < (opts.times ?? 1); i++) {
      this.tick++;
      const held = noButtons();
      for (const k of keys) held[k] = true;
      held.jump = this.space;
      const out = stepPlayer(this.p, { held, pressed: !!opts.press && i === 0, yaw: opts.yaw ?? EAST }, this.walls, 1 / tuning.sim.SIM_HZ, this.tick);
      for (const e of out) this.events.push({ ...e, tick: this.tick });
    }
  }

  /** Ticks until the player is back on the floor (any ground mode). */
  untilLanded(keys: Button[] = [], max = 600): number {
    let n = 0;
    while (this.p.move.mode !== 'ground' && this.p.move.mode !== 'slide' && n < max) {
      this.step(keys);
      n++;
    }
    return n;
  }

  count(type: MoveEvent['type']): number {
    return this.events.filter((e) => e.type === type).length;
  }
}

const apex = () => (tuning.jump.SPEED * tuning.jump.SPEED) / (2 * tuning.jump.GRAVITY);
const airTicks = () => T((2 * tuning.jump.SPEED) / tuning.jump.GRAVITY);

describe('moveset: jump (GDD §5.2)', () => {
  beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

  it('jumps as high and as long as SPEED and GRAVITY say', () => {
    const r = new Rig();
    r.step([], { press: true });
    expect(r.events[0]).toMatchObject({ type: 'jumped', kind: 'jump' });
    let top = 0;
    let n = 1;
    while (r.p.move.mode === 'air' && n < 600) {
      r.step();
      top = Math.max(top, r.p.move.y);
      n++;
    }
    expect(top).toBeGreaterThan(apex() * 0.95);
    expect(top).toBeLessThanOrEqual(apex() + 1e-9);
    expect(Math.abs(n - airTicks())).toBeLessThanOrEqual(2);
    expect(r.count('landed')).toBe(1);
    expect(r.p.move.y).toBe(0);
  });

  it('keeps speed above running with a jump in the bhop window', () => {
    const r = new Rig();
    r.p.vx = 25;
    r.p.move.landTick = r.tick;
    r.step(['forward'], { times: T(tuning.jump.BHOP_WINDOW) - 1 });
    r.step(['forward'], { press: true });
    expect(r.events.at(-1)).toMatchObject({ type: 'jumped', kind: 'bhop' });
    r.untilLanded(['forward']);
    expect(horizontalSpeed(r.p)).toBeCloseTo(25, 6);
  });

  it('loses the extra speed on the ground after the window', () => {
    const r = new Rig();
    r.p.vx = 25;
    r.p.move.landTick = r.tick;
    r.step(['forward'], { times: T(tuning.jump.BHOP_WINDOW) + T(0.2) });
    const speed = horizontalSpeed(r.p);
    expect(speed).toBeLessThan(25);
    expect(speed).toBeCloseTo(25 - tuning.jump.OVERSPEED_DECEL * 0.2, 0);
    r.step(['forward'], { times: T(2) });
    expect(horizontalSpeed(r.p)).toBeCloseTo(tuning.player.MOVE_SPEED, 6);
  });

  it('steers in the air without gaining speed', () => {
    const r = new Rig();
    r.p.vx = 20;
    r.step([], { press: true });
    r.step(['left'], { release: true, times: 20 });
    expect(horizontalSpeed(r.p)).toBeLessThanOrEqual(20 + 1e-9);
    expect(r.p.vz).toBeLessThan(-1);
  });

  it('buffers a press just before landing into a jump on landing', () => {
    const r = new Rig();
    r.step([], { press: true });
    r.step([], { release: true });
    r.step([], { press: true }); // the air dash
    r.step([], { release: true });
    // Fall until a buffered press lands in time.
    while (r.p.move.mode !== 'air') r.step();
    let n = 0;
    while (r.p.move.y + r.p.move.vy * (T(tuning.jump.BUFFER) - 1) / tuning.sim.SIM_HZ > 0 && n++ < 600) r.step();
    r.step([], { press: true });
    r.step([], { release: true, times: T(tuning.jump.BUFFER) + 2 });
    expect(r.count('jumped')).toBe(2);
    expect(r.count('dashed')).toBe(1);
  });
});

describe('moveset: dash (GDD §5.3)', () => {
  beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

  function airborne(speed = 0): Rig {
    const r = new Rig();
    r.p.vx = speed;
    r.step(['forward'], { press: true });
    r.step(['forward'], { release: true });
    return r;
  }

  it('goes faster the faster the player flies, flat, and hovers', () => {
    for (const speed of [0, 15, 30]) {
      const r = airborne(speed);
      const h = horizontalSpeed(r.p);
      const y = r.p.move.y;
      r.step(['forward'], { press: true });
      expect(r.count('dashed')).toBe(1);
      const expected = tuning.dash.BASE_SPEED + tuning.dash.SPEED_GAIN * h;
      expect(horizontalSpeed(r.p)).toBeCloseTo(expected, 6);
      r.step(['forward'], { times: dashTicks() - 1 });
      expect(r.p.move.y).toBeCloseTo(y, 9);
      expect(r.p.move.vy).toBe(0);
    }
  });

  it('keeps EXIT_FRACTION of the dash speed when it ends', () => {
    const r = airborne(15);
    r.step([], { press: true });
    const dashSpeed = r.p.move.dashSpeed;
    r.step([], { times: dashTicks() });
    expect(r.p.move.mode).toBe('air');
    expect(horizontalSpeed(r.p)).toBeCloseTo(dashSpeed * tuning.dash.EXIT_FRACTION, 6);
  });

  it('follows the move keys, forward without them', () => {
    const left = airborne();
    left.step(['left'], { press: true });
    expect(left.p.vz).toBeLessThan(0);
    expect(Math.abs(left.p.vx)).toBeLessThan(1e-9);

    const none = airborne();
    none.step([], { press: true });
    expect(none.p.vx).toBeGreaterThan(0);
    expect(Math.abs(none.p.vz)).toBeLessThan(1e-9);
  });

  it('allows one dash per flight, restored on landing', () => {
    const r = airborne();
    r.step([], { press: true });
    r.step([], { release: true, times: dashTicks() + 1 });
    expect(dashAvailable(r.p.move)).toBe(false);
    r.step([], { press: true });
    r.step([], { release: true });
    expect(r.count('dashed')).toBe(1);
    r.untilLanded();
    expect(dashAvailable(r.p.move)).toBe(true);
  });

  it('slides along a wall and keeps going', () => {
    const walls = rectWalls(rect(-10, -10, 1, 10));
    const r = new Rig(createPlayer(0, 0), walls);
    r.step([], { press: true, yaw: yawTo(1, 1) });
    r.step([], { release: true, yaw: yawTo(1, 1) });
    r.step([], { press: true, yaw: yawTo(1, 1) });
    r.step([], { times: dashTicks() - 1, yaw: yawTo(1, 1) });
    expect(r.p.move.mode).toBe('dash');
    expect(r.p.x).toBeCloseTo(1 - tuning.player.WALL_RADIUS, 6);
    expect(r.p.z).toBeGreaterThan(2);
  });
});

describe('moveset: slide (GDD §5.4)', () => {
  beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

  /** Double tap from the ground, holding Space after the second tap. */
  function dashSlide(keys: Button[] = ['forward']): Rig {
    const r = new Rig();
    r.step(keys, { press: true });
    r.step(keys, { release: true });
    r.step(keys, { press: true });
    r.untilLanded(keys);
    return r;
  }

  it('starts on touchdown when Space is held since the dash', () => {
    const r = dashSlide();
    expect(r.p.move.mode).toBe('slide');
    expect(r.count('slideStarted')).toBe(1);
    expect(horizontalSpeed(r.p)).toBeGreaterThanOrEqual(tuning.slide.MIN_SPEED - 1e-9);
    const [lo, hi] = bodyRange(r.p.move);
    expect(hi - lo).toBe(tuning.slide.BODY_HEIGHT);
  });

  it('does not start if Space was let go after the dash', () => {
    const r = new Rig();
    r.step([], { press: true });
    r.step([], { release: true });
    r.step([], { press: true });
    r.step([], { release: true });
    r.untilLanded();
    expect(r.p.move.mode).toBe('ground');
    expect(r.count('slideStarted')).toBe(0);
  });

  it('jumps with the slide speed when Space is let go', () => {
    const r = dashSlide();
    r.step(['forward'], { times: 5 });
    const speed = horizontalSpeed(r.p);
    r.step(['forward'], { release: true });
    expect(r.events.at(-1)).toMatchObject({ type: 'jumped', kind: 'slide' });
    expect(horizontalSpeed(r.p)).toBeCloseTo(speed, 6);
    expect(r.p.move.vy).toBeGreaterThan(0);
  });

  it('loses speed at FRICTION and ends after MAX_TIME', () => {
    const r = dashSlide([]);
    const start = horizontalSpeed(r.p);
    r.step([], { times: T(0.5) });
    expect(horizontalSpeed(r.p)).toBeCloseTo(start - tuning.slide.FRICTION * 0.5, 1);
    r.step([], { times: T(tuning.slide.MAX_TIME) });
    expect(r.p.move.mode).toBe('ground');
    expect(r.count('slideEnded')).toBe(1);
    // Letting go after the slide ended does not jump.
    r.step([], { release: true, times: 3 });
    expect(r.count('jumped')).toBe(1);
  });

  it('ends below STOP_SPEED', () => {
    tuning.slide.FRICTION = 200;
    const r = dashSlide([]);
    r.step([], { times: T(0.2) });
    expect(r.p.move.mode).toBe('ground');
  });

  it('turns no faster than TURN_RATE', () => {
    const r = dashSlide([]);
    const a0 = Math.atan2(r.p.vz, r.p.vx);
    r.step(['left'], { times: T(0.5) });
    const a1 = Math.atan2(r.p.vz, r.p.vx);
    const turned = Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)));
    expect(turned).toBeLessThanOrEqual(((tuning.slide.TURN_RATE * Math.PI) / 180) * 0.5 + 1e-6);
    expect(turned).toBeGreaterThan(0.1);
  });
});

describe('moveset in the world', () => {
  beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

  it('jumps on a Space press and reports it', () => {
    const w = new World({ seed: 1, startState: 'PLAYING' });
    w.step({ commands: [{ type: 'press', button: 'jump' }], held: { ...noButtons(), jump: true }, yaw: 0 });
    expect(w.events).toContainEqual({ type: 'jumped', kind: 'jump' });
    expect(w.player.move.mode).toBe('air');
  });

  it('keeps every ceiling above the top of a jump', () => {
    const level = buildLevel(fixedLayout());
    const lowest = Math.min(...level.areas.map((a) => a.height));
    expect(lowest).toBeGreaterThan(apex() + tuning.player.BODY_HEIGHT);
  });
});
