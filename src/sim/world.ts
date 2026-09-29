import { secondsToTicks, tuning } from '../config/tuning';
import { DIR_VECTORS, type Command, type Dir } from '../core/input/commands';
import { Rng } from '../core/rng';
import type { SimEvent } from './events';

// Pure simulation (GDD §15.1): no DOM, no Three.js, no Math.random().
// The greybox demo (a player stepping on a grid, collecting pips) proves the
// pipeline; replace it with the real game.

export type WorldState = 'PLAYING' | 'PAUSED';

export interface Cheats {
  god: boolean;
}

export interface WorldOptions {
  seed: number;
  cheats?: Cheats;
}

export interface StepInput {
  commands: readonly Command[];
  held: Dir | null;
}

export interface Player {
  x: number;
  y: number;
  /** Cell the current step started from; render interpolates from it. */
  fromX: number;
  fromY: number;
  moveStartTick: number;
  moveTicks: number;
}

export class World {
  readonly seed: number;
  readonly cheats: Cheats;
  /** One forked stream per system, so adding a roll in one never shifts another. */
  readonly rngSpawn: Rng;
  state: WorldState = 'PLAYING';
  /** Advances only while PLAYING; gameplay timers use it. */
  tick = 0;
  /** Always advances; UI and state timers use it. */
  uiTick = 0;
  score = 0;
  readonly player: Player;
  pip: { x: number; y: number };
  readonly events: SimEvent[] = [];
  private heldSince = -1;

  constructor(opts: WorldOptions) {
    this.seed = opts.seed;
    this.cheats = opts.cheats ?? { god: false };
    this.rngSpawn = new Rng(opts.seed).fork('spawn');
    const x = Math.floor(tuning.field.GRID_W / 2);
    const y = tuning.field.GRID_H - 1;
    this.player = { x, y, fromX: x, fromY: y, moveStartTick: 0, moveTicks: 0 };
    this.pip = this.spawnPip();
  }

  get simFrozen(): boolean {
    return this.state !== 'PLAYING';
  }

  step(input: StepInput): void {
    this.uiTick++;
    if (this.state !== 'PLAYING') return;
    this.tick++;
    for (const cmd of input.commands) {
      if (cmd.type === 'move') this.tryMove(cmd.dir);
    }
    this.holdRepeat(input.held, input.commands);
  }

  /** Progress 0..1 of the current step; `alpha` is the render interpolation. */
  moveProgress(alpha: number): number {
    const p = this.player;
    if (p.moveTicks === 0) return 1;
    return Math.min(1, (this.tick - p.moveStartTick + alpha) / p.moveTicks);
  }

  private isMoving(): boolean {
    return this.tick - this.player.moveStartTick < this.player.moveTicks;
  }

  private holdRepeat(held: Dir | null, commands: readonly Command[]): void {
    if (!held) {
      this.heldSince = -1;
      return;
    }
    if (this.heldSince < 0 || commands.some((c) => c.type === 'move')) this.heldSince = this.tick;
    if (this.tick - this.heldSince >= secondsToTicks(tuning.player.HOLD_REPEAT_DELAY)) this.tryMove(held);
  }

  private tryMove(dir: Dir): void {
    if (this.isMoving()) return;
    const p = this.player;
    const { dx, dy } = DIR_VECTORS[dir];
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (nx < 0 || ny < 0 || nx >= tuning.field.GRID_W || ny >= tuning.field.GRID_H) {
      this.events.push({ type: 'bumped', x: p.x, y: p.y });
      return;
    }
    p.fromX = p.x;
    p.fromY = p.y;
    p.x = nx;
    p.y = ny;
    p.moveStartTick = this.tick;
    p.moveTicks = Math.max(1, secondsToTicks(tuning.player.MOVE_TIME));
    this.events.push({ type: 'moved', x: nx, y: ny });
    if (nx === this.pip.x && ny === this.pip.y) {
      this.score++;
      this.events.push({ type: 'pickup', x: nx, y: ny, score: this.score });
      this.pip = this.spawnPip();
    }
  }

  private spawnPip(): { x: number; y: number } {
    const { GRID_W, GRID_H } = tuning.field;
    for (;;) {
      const x = this.rngSpawn.int(0, GRID_W - 1);
      const y = this.rngSpawn.int(0, GRID_H - 1);
      if (x !== this.player.x || y !== this.player.y) return { x, y };
    }
  }
}
