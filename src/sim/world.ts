import { secondsToTicks as T, tuning } from '../config/tuning';
import type { Command, HeldButtons } from '../core/input/commands';
import type { SimEvent } from './events';
import { buildLevel } from './level/build';
import { closestOnSegment } from './level/geometry';
import { fixedLayout } from './level/fixed';
import type { Level } from './level/level';
import { createPlayer, stepPlayer, type Player } from './player';
import { newRunStats, type RunStats } from './run';

// Pure simulation (GDD §15.1): no DOM, no Three.js, no Math.random().
// The run loop of GDD §2 and §14 on the fixed test level (plan task 2).

export type WorldState = 'TITLE' | 'PLAYING' | 'LEVEL_CLEAR' | 'DEAD' | 'PAUSED';
export type Phase = 'INWARD' | 'ESCAPE';

export interface Cheats {
  god: boolean;
}

export interface WorldOptions {
  seed: number;
  cheats?: Cheats;
  /** A restart skips the title (GDD §14.3). */
  startState?: 'TITLE' | 'PLAYING';
}

export interface StepInput {
  commands: readonly Command[];
  held: HeldButtons;
  /** Current view yaw, radians (GDD §15.1): movement is relative to it. */
  yaw: number;
}

export class World {
  readonly seed: number;
  readonly cheats: Cheats;
  state: WorldState;
  phase: Phase = 'INWARD';
  /** Advances only while PLAYING; gameplay timers use it. */
  tick = 0;
  /** Always advances; UI and state timers use it. */
  uiTick = 0;
  /** Ticks since the current state began; stands still while PAUSED. */
  stateTicks = 0;
  levelNumber = 1;
  level!: Level;
  player!: Player;
  /** Current level's INWARD and ESCAPE times, ticks. */
  inwardTicks = 0;
  escapeTicks = 0;
  readonly run: RunStats = newRunStats();
  readonly events: SimEvent[] = [];
  private resumeState: WorldState = 'PLAYING';

  constructor(opts: WorldOptions) {
    this.seed = opts.seed;
    this.cheats = opts.cheats ?? { god: false };
    this.state = opts.startState ?? 'TITLE';
    this.startLevel(1);
    if (this.state === 'PLAYING') this.events.push({ type: 'runStarted' });
  }

  get simFrozen(): boolean {
    return this.state !== 'PLAYING';
  }

  /** The death screen accepts a restart (GDD §14.3). */
  get canRestart(): boolean {
    return this.state === 'DEAD' && this.stateTicks >= T(tuning.run.DEATH_COLLAPSE_TIME + tuning.run.RESTART_LOCKOUT);
  }

  step(input: StepInput): void {
    this.uiTick++;
    for (const cmd of input.commands) this.command(cmd);
    if (this.state !== 'PAUSED') this.stateTicks++;

    if (this.state === 'PLAYING') this.play(input);
    else if (this.state === 'LEVEL_CLEAR' && this.stateTicks >= T(tuning.run.LEVEL_CLEAR_TIME)) {
      this.startLevel(this.levelNumber + 1);
      this.setState('PLAYING');
    }
  }

  /** Contact with the enemy (GDD §11.7). */
  kill(): void {
    if (this.state !== 'PLAYING' || this.cheats.god) return;
    this.setState('DEAD');
    this.events.push({ type: 'died' });
  }

  private command(cmd: Command): void {
    const s = this.state;
    if (cmd.type === 'pause' && (s === 'PLAYING' || s === 'LEVEL_CLEAR')) {
      this.resumeState = s;
      this.state = 'PAUSED';
      this.events.push({ type: 'paused' });
    } else if (cmd.type === 'resume' && s === 'PAUSED') {
      this.state = this.resumeState;
      this.events.push({ type: 'resumed' });
    } else if (cmd.type === 'confirm' && s === 'TITLE') {
      this.setState('PLAYING');
      this.events.push({ type: 'runStarted' });
    } else if ((cmd.type === 'confirm' || (cmd.type === 'press' && cmd.button === 'dash')) && this.canRestart) {
      this.events.push({ type: 'restartRequested' });
    }
  }

  private setState(state: WorldState): void {
    this.state = state;
    this.stateTicks = 0;
  }

  private startLevel(n: number): void {
    this.levelNumber = n;
    this.level = buildLevel(fixedLayout());
    const { x, z } = this.level.spawn;
    this.player = createPlayer(x, z);
    this.phase = 'INWARD';
    this.inwardTicks = 0;
    this.escapeTicks = 0;
    this.events.push({ type: 'levelStarted', level: n });
  }

  private play(input: StepInput): void {
    this.tick++;
    this.run.runTicks++;
    if (this.phase === 'INWARD') this.inwardTicks++;
    else this.escapeTicks++;

    const p = this.player;
    stepPlayer(p, input.held, input.yaw, this.level.walls, 1 / tuning.sim.SIM_HZ);
    this.run.distanceTravelled += Math.hypot(p.x - p.prevX, p.z - p.prevZ);

    if (this.phase === 'INWARD') {
      const eye = this.level.eye;
      if (Math.hypot(p.x - eye.x, p.z - eye.z) < tuning.player.RADIUS + tuning.eye.RADIUS) {
        this.phase = 'ESCAPE';
        this.events.push({ type: 'eyeTaken', level: this.levelNumber });
      }
    } else if (this.touchesStartWall()) {
      this.clearLevel();
    }
  }

  private touchesStartWall(): boolean {
    const p = this.player;
    const c = closestOnSegment(this.level.startWall, p.x, p.z);
    return Math.hypot(p.x - c.x, p.z - c.z) <= tuning.player.RADIUS + tuning.start.TOUCH_MARGIN;
  }

  private clearLevel(): void {
    const r = this.run;
    r.eyesExtracted++;
    if (r.bestEscapeTicks === null || this.escapeTicks < r.bestEscapeTicks) r.bestEscapeTicks = this.escapeTicks;
    this.setState('LEVEL_CLEAR');
    this.events.push({ type: 'levelCleared', level: this.levelNumber, escapeTime: this.escapeTicks / tuning.sim.SIM_HZ });
  }
}
