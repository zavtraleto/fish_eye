import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks as T, tuning } from '../src/config/tuning';
import { isBetterRun } from '../src/sim/run';
import { World } from '../src/sim/world';
import { fixedLevels, idle, walk } from './helpers';

const playing = () => new World({ seed: 1, startState: 'PLAYING', levels: fixedLevels });

/** Runs the green line to the EYE, then back along it to the white wall. */
function clearLevel(w: World): void {
  walk(w, w.level.route, () => w.phase === 'ESCAPE');
  const wall = w.level.startWall;
  const back = [...w.level.route].reverse();
  back.push({ x: (wall.ax + wall.bx) / 2, z: (wall.az + wall.bz) / 2 });
  walk(w, back, () => w.state !== 'PLAYING');
}

describe('run loop (GDD §2, §14)', () => {
  beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

  it('waits on the title until a click', () => {
    const w = new World({ seed: 1, levels: fixedLevels });
    idle(w, 10);
    expect(w.state).toBe('TITLE');
    expect(w.tick).toBe(0);
    idle(w, 1, [{ type: 'confirm' }]);
    expect(w.state).toBe('PLAYING');
    expect(w.events).toContainEqual({ type: 'runStarted' });
  });

  it('takes the EYE on touch and switches to ESCAPE', () => {
    const w = playing();
    walk(w, w.level.route, () => w.phase === 'ESCAPE');
    expect(w.phase).toBe('ESCAPE');
    expect(w.events).toContainEqual({ type: 'eyeTaken', level: 1 });
    expect(w.inwardTicks).toBeGreaterThan(0);
  });

  it('ignores the white wall during INWARD', () => {
    const w = playing();
    const wall = w.level.startWall;
    walk(w, [{ x: (wall.ax + wall.bx) / 2, z: (wall.az + wall.bz) / 2 }], () => false, 1);
    expect(w.state).toBe('PLAYING');
    expect(w.phase).toBe('INWARD');
  });

  it('clears the level at the white wall and starts the next after LEVEL_CLEAR_TIME', () => {
    const w = playing();
    clearLevel(w);
    expect(w.state).toBe('LEVEL_CLEAR');
    expect(w.run.eyesExtracted).toBe(1);
    expect(w.run.bestEscapeTicks).toBe(w.escapeTicks);
    const cleared = w.events.find((e) => e.type === 'levelCleared');
    expect(cleared).toMatchObject({ level: 1, escapeTime: w.escapeTicks / tuning.sim.SIM_HZ });

    const runTicks = w.run.runTicks;
    idle(w, T(tuning.run.LEVEL_CLEAR_TIME) - 1);
    expect(w.state).toBe('LEVEL_CLEAR');
    expect(w.run.runTicks).toBe(runTicks);
    idle(w, 1);
    expect(w.state).toBe('PLAYING');
    expect(w.levelNumber).toBe(2);
    expect(w.phase).toBe('INWARD');
    expect(w.player.x).toBe(w.level.spawn.x);
  });

  it('builds the next level while the level-clear screen shows, not when play resumes', () => {
    const built: number[] = [];
    const w = new World({ seed: 1, startState: 'PLAYING', levels: (_, n) => (built.push(n), fixedLevels()) });
    expect(built).toEqual([1]);
    clearLevel(w);
    idle(w, 1);
    expect(built).toEqual([1, 2]);
    idle(w, T(tuning.run.LEVEL_CLEAR_TIME));
    expect(w.levelNumber).toBe(2);
    expect(built).toEqual([1, 2]);
  });

  it('plays generated levels by default (GDD §7)', () => {
    const w = new World({ seed: 7, startState: 'PLAYING', firstLevel: 3 });
    expect(w.levelNumber).toBe(3);
    expect(w.level.zones.length).toBeGreaterThan(8);
    expect(w.level.route.length).toBeGreaterThan(2);
  });

  it('freezes gameplay and state timers while paused', () => {
    const w = playing();
    idle(w, 5);
    idle(w, 1, [{ type: 'pause' }]);
    expect(w.state).toBe('PAUSED');
    const { tick, stateTicks } = w;
    idle(w, 30, [{ type: 'confirm' }]);
    expect(w.state).toBe('PAUSED');
    expect(w.tick).toBe(tick);
    expect(w.stateTicks).toBe(stateTicks);
    idle(w, 1, [{ type: 'resume' }]);
    expect(w.state).toBe('PLAYING');
    expect(w.tick).toBe(tick + 1);
  });

  it('pauses the level clear screen too', () => {
    const w = playing();
    clearLevel(w);
    idle(w, 1, [{ type: 'pause' }]);
    idle(w, T(tuning.run.LEVEL_CLEAR_TIME) * 2);
    expect(w.state).toBe('PAUSED');
    idle(w, 1, [{ type: 'resume' }]);
    expect(w.state).toBe('LEVEL_CLEAR');
  });

  it('dies, then accepts a restart only after collapse and lockout', () => {
    const w = playing();
    idle(w, 3);
    w.kill();
    expect(w.state).toBe('DEAD');
    expect(w.events).toContainEqual({ type: 'died' });
    const wait = T(tuning.run.DEATH_COLLAPSE_TIME + tuning.run.RESTART_LOCKOUT);
    idle(w, wait - 1, [{ type: 'confirm' }]);
    expect(w.canRestart).toBe(false);
    expect(w.events.some((e) => e.type === 'restartRequested')).toBe(false);
    idle(w, 1);
    expect(w.canRestart).toBe(true);
    idle(w, 1, [{ type: 'press', button: 'jump' }]);
    expect(w.events).toContainEqual({ type: 'restartRequested' });
  });

  it('god mode survives a kill', () => {
    const w = new World({ seed: 1, startState: 'PLAYING', cheats: { god: true }, levels: fixedLevels });
    w.kill();
    expect(w.state).toBe('PLAYING');
  });

  it('ranks runs by EYES, then by time', () => {
    const r = (eyes: number, runTime: number) => ({ seed: 0, eyes, runTime, version: '' });
    expect(isBetterRun(r(3, 100), r(2, 10))).toBe(true);
    expect(isBetterRun(r(2, 9), r(2, 10))).toBe(true);
    expect(isBetterRun(r(2, 11), r(2, 10))).toBe(false);
    expect(isBetterRun(r(0, 1), null)).toBe(true);
  });
});
