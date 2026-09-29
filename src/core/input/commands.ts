// Abstract input (GDD §3). Devices write here; the simulation reads it once per tick.

export type Button = 'forward' | 'back' | 'left' | 'right' | 'dash';

/**
 * `press`: a button went down (held state is read from `InputState.held`).
 * `confirm`: a click (start, restart). `pause` / `resume`: Pointer Lock lost / regained.
 */
export type Command = { type: 'press'; button: Button } | { type: 'confirm' } | { type: 'pause' } | { type: 'resume' };

export type HeldButtons = Record<Button, boolean>;

export function noButtons(): HeldButtons {
  return { forward: false, back: false, left: false, right: false, dash: false };
}

/** View angles in radians. Yaw 0 looks along -z; positive yaw turns left (counter-clockwise from above). */
export interface Look {
  yaw: number;
  pitch: number;
}

export class InputState {
  private queue: Command[] = [];
  /** Devices set these; tests and `__game` may set them directly. */
  readonly held: HeldButtons = noButtons();
  /** Updated by the mouse on every event; the camera reads it every render frame (GDD §3.2). */
  readonly look: Look = { yaw: 0, pitch: 0 };

  push(cmd: Command): void {
    // Bound the queue so a stalled simulation never accumulates stale input.
    if (this.queue.length >= 16) this.queue.shift();
    this.queue.push(cmd);
  }

  drain(): Command[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  /** Releases held buttons (focus or mouse lost); queued commands stay. */
  releaseAll(): void {
    Object.assign(this.held, noButtons());
  }

  /** Drops queued and held input; the view direction is kept. */
  clear(): void {
    this.queue = [];
    this.releaseAll();
  }
}
