import { secondsToTicks as T, tuning } from '../../config/tuning';
import type { HeldButtons } from '../../core/input/commands';
import type { MoveEvent } from '../events';
import type { Segment } from '../level/geometry';
import { approachVelocity, horizontalSpeed, moveAndSlide, wishDir, type Player } from '../player';
import { handleSpace } from './space';

// Velocity by movement mode, gravity and landing (GDD §3.1, §5).

export interface MoveInput {
  held: HeldButtons;
  /** Space went down this tick. */
  pressed: boolean;
  yaw: number;
}

export function dashTicks(): number {
  return Math.max(1, T(tuning.dash.DURATION));
}

/** One tick of player movement; returns what happened, for SimEvents. */
export function stepPlayer(p: Player, input: MoveInput, walls: readonly Segment[], dt: number, tick: number): MoveEvent[] {
  const out: MoveEvent[] = [];
  const m = p.move;
  handleSpace(p, input.pressed, input.held, input.yaw, tick, out);

  if (m.mode === 'dash' && tick - m.dashTick >= dashTicks()) {
    m.mode = 'air';
    const exit = m.dashSpeed * tuning.dash.EXIT_FRACTION;
    p.vx = m.dashDirX * exit;
    p.vz = m.dashDirZ * exit;
  }

  const wish = wishDir(input.held, input.yaw);
  const vy0 = m.vy;
  switch (m.mode) {
    case 'ground':
      groundVelocity(p, wish, dt, tick);
      break;
    case 'air':
      airVelocity(p, wish, dt);
      break;
    case 'dash':
      // Hovers: fixed direction and speed, no gravity.
      m.vy = 0;
      p.vx = m.dashDirX * m.dashSpeed;
      p.vz = m.dashDirZ * m.dashSpeed;
      break;
    case 'slide':
      if (!slideVelocity(p, wish, dt, tick)) {
        m.mode = 'ground';
        out.push({ type: 'slideEnded' });
        groundVelocity(p, wish, dt, tick);
      }
      break;
  }
  capSpeed(p);

  p.prevX = p.x;
  p.prevZ = p.z;
  m.prevY = m.y;
  moveAndSlide(p, walls, dt);
  if (m.mode === 'air') {
    // Mean of the tick's start and end speeds: an exact parabola under constant gravity.
    m.y += ((vy0 + m.vy) / 2) * dt;
    if (m.y <= 0 && m.vy <= 0) land(p, tick, out);
  }
  return out;
}

/**
 * Quake-like run (GDD §3.1). Speed above MOVE_SPEED survives the bhop window
 * after landing, then fades at OVERSPEED_DECEL (GDD §5.2).
 */
function groundVelocity(p: Player, wish: { x: number; z: number }, dt: number, tick: number): void {
  const { MOVE_SPEED, ACCEL, FRICTION } = tuning.player;
  const moving = wish.x !== 0 || wish.z !== 0;
  const speed = horizontalSpeed(p);
  if (speed > MOVE_SPEED + 1e-6) {
    if (tick - p.move.landTick <= T(tuning.jump.BHOP_WINDOW)) return;
    if (moving) {
      const target = Math.max(MOVE_SPEED, speed - tuning.jump.OVERSPEED_DECEL * dt);
      approachVelocity(p, wish.x * target, wish.z * target, ACCEL * dt);
      return;
    }
  }
  approachVelocity(p, wish.x * MOVE_SPEED, wish.z * MOVE_SPEED, (moving ? ACCEL : FRICTION) * dt);
}

/** Gravity; the keys steer but never raise speed above max(MOVE_SPEED, current). */
function airVelocity(p: Player, wish: { x: number; z: number }, dt: number): void {
  p.move.vy -= tuning.jump.GRAVITY * dt;
  if (wish.x === 0 && wish.z === 0) return;
  const cap = Math.max(tuning.player.MOVE_SPEED, horizontalSpeed(p));
  approachVelocity(p, wish.x * cap, wish.z * cap, tuning.jump.AIR_ACCEL * dt);
}

/** Low friction, slow turning; false when the slide runs out (GDD §5.4). */
function slideVelocity(p: Player, wish: { x: number; z: number }, dt: number, tick: number): boolean {
  const { FRICTION, TURN_RATE, MAX_TIME, STOP_SPEED } = tuning.slide;
  const speed = horizontalSpeed(p);
  if (tick - p.move.slideTick >= T(MAX_TIME) || speed < STOP_SPEED) return false;
  let ang = Math.atan2(p.vz, p.vx);
  if (wish.x !== 0 || wish.z !== 0) {
    let diff = Math.atan2(wish.z, wish.x) - ang;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const maxTurn = ((TURN_RATE * Math.PI) / 180) * dt;
    ang += Math.max(-maxTurn, Math.min(maxTurn, diff));
  }
  const next = Math.max(0, speed - FRICTION * dt);
  p.vx = Math.cos(ang) * next;
  p.vz = Math.sin(ang) * next;
  return true;
}

function capSpeed(p: Player): void {
  const speed = horizontalSpeed(p);
  const max = tuning.jump.MAX_SPEED;
  if (speed > max) {
    p.vx *= max / speed;
    p.vz *= max / speed;
  }
}

/** Touchdown: Space held since this flight's dash turns it into a slide (GDD §5.4). */
function land(p: Player, tick: number, out: MoveEvent[]): void {
  const m = p.move;
  const slide = m.airDashUsed && m.holdSinceDash;
  m.y = 0;
  m.vy = 0;
  m.landTick = tick;
  m.airDashUsed = false;
  m.holdSinceDash = false;
  if (!slide) {
    m.mode = 'ground';
    out.push({ type: 'landed' });
    return;
  }
  m.mode = 'slide';
  m.slideTick = tick;
  m.pressTick = -Infinity;
  const speed = horizontalSpeed(p);
  const min = tuning.slide.MIN_SPEED;
  if (speed < min) {
    const dx = speed > 1e-6 ? p.vx / speed : m.dashDirX;
    const dz = speed > 1e-6 ? p.vz / speed : m.dashDirZ;
    p.vx = dx * min;
    p.vz = dz * min;
  }
  out.push({ type: 'slideStarted' });
}
