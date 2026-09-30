import { secondsToTicks as T, tuning } from '../config/tuning';
import type { Command, HeldButtons } from '../core/input/commands';
import { Rng } from '../core/rng';
import { chooseSpawnNode, createEnemy, enemyTouches, stepEnemy, type Enemy } from './enemy';
import type { SimEvent } from './events';
import { closestOnSegment } from './level/geometry';
import { generateLevel } from './level/gen/generate';
import type { Level } from './level/level';
import { locate, nodeAnchor, zoneNode } from './level/query';
import { yawTo } from './look';
import { stepPlayer } from './move/motion';
import { createPlayer, type Player } from './player';
import { newRunStats, type RunStats } from './run';

// Pure simulation (GDD §15.1): no DOM, no Three.js, no Math.random().
// The run loop of GDD §2 and §14 over generated levels (GDD §7).

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
  /** Builds level N of the run; generation by default (GDD §7). Tests pass the fixed level. */
  levels?: (seed: number, n: number) => Level;
  /** Debug: the run starts at this level. */
  firstLevel?: number;
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
  /** Wall-clock milliseconds the current level took to build; debug only, never used by the sim. */
  levelBuildMs = 0;
  player!: Player;
  /** Appears when the EYE is taken, from level `FIRST_LEVEL` (GDD §11.6). */
  enemy: Enemy | null = null;
  /** Current level's INWARD and ESCAPE times, ticks. */
  inwardTicks = 0;
  escapeTicks = 0;
  readonly run: RunStats = newRunStats();
  readonly events: SimEvent[] = [];
  private resumeState: WorldState = 'PLAYING';
  private readonly rngEnemy: Rng;
  private readonly levels: (seed: number, n: number) => Level;
  /** The next level, built while the level-clear screen shows. */
  private nextLevel: Level | null = null;

  constructor(opts: WorldOptions) {
    this.seed = opts.seed;
    this.cheats = opts.cheats ?? { god: false };
    this.rngEnemy = new Rng(opts.seed).fork('enemy');
    this.state = opts.startState ?? 'TITLE';
    this.levels = opts.levels ?? ((seed, n) => generateLevel(seed, n).level);
    this.startLevel(opts.firstLevel ?? 1);
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
    else if (this.state === 'LEVEL_CLEAR') {
      // The screen is up: build the next level now, not when play resumes.
      this.nextLevel ??= this.buildLevel(this.levelNumber + 1);
      if (this.stateTicks >= T(tuning.run.LEVEL_CLEAR_TIME)) {
        this.startLevel(this.levelNumber + 1);
        this.setState('PLAYING');
      }
    }
  }

  /** Contact with the enemy (GDD §11.7). */
  kill(): void {
    if (this.state !== 'PLAYING' || this.cheats.god) return;
    this.setState('DEAD');
    this.events.push({ type: 'died' });
  }

  /** Puts the enemy in a fair node (GDD §11.6); debug can call it any time. */
  spawnEnemy(): void {
    const p = this.player;
    const zone = locate(this.level, p.x, p.z);
    const playerNode = zone ? zoneNode(zone) : this.level.graph.eye;
    const node = chooseSpawnNode(this.level, playerNode, (n) => this.rngEnemy.int(0, n - 1));
    const c = nodeAnchor(this.level, node);
    this.enemy = createEnemy(c.x, c.z, yawTo(p.x - c.x, p.z - c.z), this.tick);
    this.events.push({ type: 'enemySpawned' });
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
    } else if ((cmd.type === 'confirm' || (cmd.type === 'press' && cmd.button === 'jump')) && this.canRestart) {
      this.events.push({ type: 'restartRequested' });
    }
  }

  private setState(state: WorldState): void {
    this.state = state;
    this.stateTicks = 0;
  }

  private startLevel(n: number): void {
    this.levelNumber = n;
    this.level = this.nextLevel ?? this.buildLevel(n);
    this.nextLevel = null;
    const { x, z } = this.level.spawn;
    this.player = createPlayer(x, z);
    this.enemy = null;
    this.phase = 'INWARD';
    this.inwardTicks = 0;
    this.escapeTicks = 0;
    this.events.push({ type: 'levelStarted', level: n });
  }

  private buildLevel(n: number): Level {
    const t0 = performance.now();
    const level = this.levels(this.seed, n);
    this.levelBuildMs = performance.now() - t0;
    return level;
  }

  private play(input: StepInput): void {
    this.tick++;
    this.run.runTicks++;
    if (this.phase === 'INWARD') this.inwardTicks++;
    else this.escapeTicks++;

    const p = this.player;
    const pressed = input.commands.some((c) => c.type === 'press' && c.button === 'jump');
    const moves = stepPlayer(p, { held: input.held, pressed, yaw: input.yaw }, this.level.wallIndex, 1 / tuning.sim.SIM_HZ, this.tick);
    this.events.push(...moves);
    this.run.distanceTravelled += Math.hypot(p.x - p.prevX, p.z - p.prevZ);

    const e = this.enemy;
    if (e) {
      stepEnemy(e, this.level, p, this.tick, 1 / tuning.sim.SIM_HZ, this.events);
      if (enemyTouches(e, p)) {
        this.kill();
        if (this.state !== 'PLAYING') return;
      }
    }

    if (this.phase === 'INWARD') {
      const eye = this.level.eye;
      if (Math.hypot(p.x - eye.x, p.z - eye.z) < tuning.player.RADIUS + tuning.eye.RADIUS) {
        this.phase = 'ESCAPE';
        this.events.push({ type: 'eyeTaken', level: this.levelNumber });
        if (this.levelNumber >= tuning.enemy.FIRST_LEVEL) this.spawnEnemy();
      }
    } else if (this.touchesStartWall()) {
      this.clearLevel();
    }
  }

  private touchesStartWall(): boolean {
    const p = this.player;
    const c = closestOnSegment(this.level.startWall, p.x, p.z);
    return Math.hypot(p.x - c.x, p.z - c.z) <= tuning.player.WALL_RADIUS + tuning.start.TOUCH_MARGIN;
  }

  private clearLevel(): void {
    const r = this.run;
    r.eyesExtracted++;
    if (r.bestEscapeTicks === null || this.escapeTicks < r.bestEscapeTicks) r.bestEscapeTicks = this.escapeTicks;
    this.setState('LEVEL_CLEAR');
    this.events.push({ type: 'levelCleared', level: this.levelNumber, escapeTime: this.escapeTicks / tuning.sim.SIM_HZ });
  }
}
