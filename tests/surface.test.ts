import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, tuning } from '../src/config/tuning';
import { levelSurface } from '../src/render/levelSurface';
import { generateLevel } from '../src/sim/level/gen/generate';
import { sampleNodes } from '../src/sim/level/raster';

describe('organic surfaces (GDD §6, VISUAL.md)', () => {
  beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

  it('keeps sight honest to collision: flat floor where one stands, high ceilings, walls in only a little below head height', () => {
    const v = tuning.view;
    for (const [seed, n] of [
      [1, 3],
      [2, 8],
    ] as const) {
      const { level } = generateLevel(seed, n);
      const s = levelSurface(level);
      const f = level.frame;
      for (let k = 0; k < 4000; k++) {
        const x = f.x0 + ((k * 7.31) % (f.w * f.cell));
        const z = f.z0 + ((k * 3.77) % (f.h * f.cell));
        const d = sampleNodes(f, level.wallDist, x, z);
        if (d >= v.COVE_WIDTH) {
          expect(s.floorY(x, z)).toBe(0);
          expect(s.ceilY(x, z)).toBeGreaterThanOrEqual(v.CEILING_MIN);
        }
      }
      for (const w of level.faces) {
        for (let y = 0; y < v.WALL_SAFE_HEIGHT; y += 0.5) expect(s.wallOffset(w.seg.ax, w.seg.az, y, w.nx, w.nz)).toBeLessThanOrEqual(v.WALL_INWARD_LOW + 1e-9);
      }
    }
  }, 30_000);

  it('leaves START bare: the white wall stays flat', () => {
    const { level } = generateLevel(3, 5);
    const s = levelSurface(level);
    for (const w of level.faces.filter((x) => x.kind === 'start')) {
      expect(s.floorY(w.seg.ax, w.seg.az)).toBe(0);
      expect(s.wallOffset(w.seg.ax, w.seg.az, 3, w.nx, w.nz)).toBe(0);
    }
  });
});
