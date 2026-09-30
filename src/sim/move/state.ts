import { secondsToTicks as T, tuning } from '../../config/tuning';

// Movement state beyond the floor-plane circle (GDD §5): height, mode, timings.

export type MoveMode = 'ground' | 'air' | 'dash' | 'slide';

export interface MoveState {
  mode: MoveMode;
  /** Feet height above the floor; the floor is flat at 0. */
  y: number;
  vy: number;
  /** Height at the start of the last tick; render interpolates from it. */
  prevY: number;
  /** Tick of the last touchdown. */
  landTick: number;
  /** Tick of the last Space press not yet used, for the jump buffer. */
  pressTick: number;
  /** The one dash of this flight is spent. */
  airDashUsed: boolean;
  /** Space has stayed down since the dash of this flight started. */
  holdSinceDash: boolean;
  dashTick: number;
  dashDirX: number;
  dashDirZ: number;
  dashSpeed: number;
  slideTick: number;
}

export function createMove(): MoveState {
  return {
    mode: 'ground',
    y: 0,
    vy: 0,
    prevY: 0,
    landTick: -Infinity,
    pressTick: -Infinity,
    airDashUsed: false,
    holdSinceDash: false,
    dashTick: -Infinity,
    dashDirX: 0,
    dashDirZ: -1,
    dashSpeed: 0,
    slideTick: -Infinity,
  };
}

/** A dash is available: on the floor, or in the air before this flight's dash. */
export function dashAvailable(m: MoveState): boolean {
  return m.mode === 'ground' || m.mode === 'slide' || (m.mode === 'air' && !m.airDashUsed);
}

/** 1 when a slide starts, 0 when it runs out of time. */
export function slideTimeLeft(m: MoveState, tick: number): number {
  if (m.mode !== 'slide') return 0;
  const max = Math.max(1, T(tuning.slide.MAX_TIME));
  return Math.max(0, 1 - (tick - m.slideTick) / max);
}

/** Vertical extent of the body (GDD §5.5). */
export function bodyRange(m: MoveState): [number, number] {
  const h = m.mode === 'slide' ? tuning.slide.BODY_HEIGHT : tuning.player.BODY_HEIGHT;
  return [m.y, m.y + h];
}
