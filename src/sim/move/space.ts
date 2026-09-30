import { secondsToTicks as T, tuning } from '../../config/tuning';
import type { HeldButtons } from '../../core/input/commands';
import type { MoveEvent } from '../events';
import { yawAxes } from '../look';
import { horizontalSpeed, wishDir, type Player } from '../player';

// The one button (GDD §5.1): a Space press, hold or release becomes a jump,
// a dash, a slide or a slide jump depending on the mode and the timing.

export function handleSpace(p: Player, pressed: boolean, held: HeldButtons, yaw: number, tick: number, out: MoveEvent[]): void {
  const m = p.move;
  if (pressed) m.pressTick = tick;
  if (!held.jump) m.holdSinceDash = false;

  switch (m.mode) {
    case 'ground': {
      // A fresh press, or one buffered in the air just before landing.
      if (tick - m.pressTick > T(tuning.jump.BUFFER)) return;
      const keepsSpeed = tick - m.landTick <= T(tuning.jump.BHOP_WINDOW) && horizontalSpeed(p) > tuning.player.MOVE_SPEED + 1e-6;
      jump(p, keepsSpeed ? 'bhop' : 'jump', out);
      return;
    }
    case 'slide':
      if (!held.jump) jump(p, 'slide', out);
      return;
    case 'air':
      if (pressed && !m.airDashUsed) startDash(p, held, yaw, tick, out);
      return;
    case 'dash':
      return;
  }
}

function jump(p: Player, kind: 'jump' | 'bhop' | 'slide', out: MoveEvent[]): void {
  const m = p.move;
  m.mode = 'air';
  m.vy = tuning.jump.SPEED;
  m.pressTick = -Infinity;
  out.push({ type: 'jumped', kind });
}

/** Horizontal whatever the pitch; by the move keys, forward without them (GDD §5.3). */
function startDash(p: Player, held: HeldButtons, yaw: number, tick: number, out: MoveEvent[]): void {
  const m = p.move;
  let dir = wishDir(held, yaw);
  if (dir.x === 0 && dir.z === 0) {
    const { fx, fz } = yawAxes(yaw);
    dir = { x: fx, z: fz };
  }
  const { BASE_SPEED, SPEED_GAIN } = tuning.dash;
  m.mode = 'dash';
  m.dashTick = tick;
  m.dashDirX = dir.x;
  m.dashDirZ = dir.z;
  m.dashSpeed = Math.min(tuning.jump.MAX_SPEED, BASE_SPEED + SPEED_GAIN * horizontalSpeed(p));
  m.airDashUsed = true;
  m.holdSinceDash = true;
  m.pressTick = -Infinity;
  m.vy = 0;
  out.push({ type: 'dashed' });
}
