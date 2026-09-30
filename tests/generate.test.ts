import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import { generateLevel } from '../src/sim/level/gen/generate';
import { NavField } from '../src/sim/level/nav';
import { crossesWall } from '../src/sim/level/query';
import { cellAt, sampleNodes } from '../src/sim/level/raster';
import { World } from '../src/sim/world';
import { walk, wallClearance } from './helpers';

// `npm run test:gen` sweeps many more (vitest --mode gen).
const GEN = import.meta.env.MODE === 'gen';
const SEEDS = GEN ? 40 : 4;
const LEVELS = GEN ? [1, 2, 3, 4, 5, 6, 8, 10, 12, 15] : [1, 4, 11];

/** Top of a jump plus the body (GDD §5.2): every ceiling clears it. */
const apex = () => (tuning.jump.SPEED * tuning.jump.SPEED) / (2 * tuning.jump.GRAVITY) + tuning.player.BODY_HEIGHT;

describe('generated levels (GDD §7, §8, §10, §11.1)', () => {
  beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

  it(`are playable over ${SEEDS} seeds × ${LEVELS.length} levels`, () => {
    let fallbacks = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      for (const n of LEVELS) {
        const at = `seed ${seed} level ${n}`;
        const { level, structure } = generateLevel(seed, n);
        if (!structure) fallbacks++;
        // The green line never crosses a wall.
        for (let i = 0; i + 1 < level.route.length; i++) {
          const a = level.route[i]!;
          const b = level.route[i + 1]!;
          for (const w of level.wallIndex.near(Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z)))
            expect(crossesWall(a.x, a.z, b.x, b.z, w), at).toBe(false);
        }
        // The player fits where they spawn and at the EYE.
        expect(wallClearance(level.walls, level.spawn.x, level.spawn.z), at).toBeGreaterThan(tuning.player.WALL_RADIUS);
        expect(wallClearance(level.walls, level.eye.x, level.eye.z), at).toBeGreaterThan(tuning.player.WALL_RADIUS);
        // The enemy's body reaches every zone from START (no stop: the whole field).
        const nav = new NavField(level.nav);
        const s = level.route[0]!;
        nav.build(s.x, s.z, Infinity, Infinity, tuning.enemy.RADIUS);
        for (const z of level.zones) expect(nav.stepsAt(cellAt(level.nav.frame, z.anchor.x, z.anchor.z)), `${at} zone ${z.id}`).toBeGreaterThanOrEqual(0);
        // Every ceiling clears a jump.
        for (const z of level.zones) expect(z.height, at).toBeGreaterThan(apex());
      }
    }
    expect(fallbacks).toBe(0);
  }, 600000);

  it('runs: along the green line to the EYE, back to the white wall', () => {
    for (const [seed, n] of [
      [1, 1],
      [2, 6],
      [3, 11],
    ] as const) {
      const w = new World({ seed, startState: 'PLAYING', firstLevel: n, cheats: { god: true } });
      walk(w, w.level.route, () => w.phase === 'ESCAPE', 120);
      expect(w.phase, `seed ${seed} level ${n}`).toBe('ESCAPE');
      const wall = w.level.startWall;
      const back = [...w.level.route].reverse();
      back.push({ x: (wall.ax + wall.bx) / 2, z: (wall.az + wall.bz) / 2 });
      walk(w, back, () => w.state === 'LEVEL_CLEAR', 120);
      expect(w.state, `seed ${seed} level ${n}`).toBe('LEVEL_CLEAR');
    }
  }, 60000);

  it('grows flesh away from START and thickest at the heart early on (GDD §6)', () => {
    for (let seed = 1; seed <= 3; seed++) {
      const { level } = generateLevel(seed, 1);
      const d = level.density!;
      expect(sampleNodes(level.frame, d, level.spawn.x, level.spawn.z)).toBe(0);
      expect(sampleNodes(level.frame, d, level.eye.x, level.eye.z)).toBeGreaterThan(0.6);
    }
  });

  it('is deterministic per seed and level', () => {
    const a = generateLevel(5, 3).level;
    const b = generateLevel(5, 3).level;
    expect(b.walls.length).toBe(a.walls.length);
    expect(b.walls[100]).toEqual(a.walls[100]);
    expect(b.route).toEqual(a.route);
  });
});
