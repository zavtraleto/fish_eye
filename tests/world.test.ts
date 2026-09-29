import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks as T, tuning } from '../src/config/tuning';
import type { Command, Dir } from '../src/core/input/commands';
import { World } from '../src/sim/world';

function step(world: World, commands: Command[] = [], held: Dir | null = null, times = 1): void {
  for (let i = 0; i < times; i++) world.step({ commands: i === 0 ? commands : [], held });
}

describe('World (greybox demo)', () => {
  beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

  it('moves one cell per command and ignores input mid-step', () => {
    const w = new World({ seed: 1 });
    const x = w.player.x;
    step(w, [{ type: 'move', dir: 'left' }]);
    expect(w.player.x).toBe(x - 1);
    step(w, [{ type: 'move', dir: 'left' }]);
    expect(w.player.x).toBe(x - 1);
    step(w, [], null, T(tuning.player.MOVE_TIME));
    step(w, [{ type: 'move', dir: 'left' }]);
    expect(w.player.x).toBe(x - 2);
  });

  it('bumps at the edge', () => {
    const w = new World({ seed: 1 });
    step(w, [{ type: 'move', dir: 'down' }]);
    expect(w.events).toContainEqual({ type: 'bumped', x: w.player.x, y: w.player.y });
  });

  it('repeats a held direction after the delay', () => {
    const w = new World({ seed: 1 });
    const y = w.player.y;
    step(w, [{ type: 'move', dir: 'up' }], 'up');
    step(w, [], 'up', T(tuning.player.HOLD_REPEAT_DELAY) - 1);
    expect(w.player.y).toBe(y - 1);
    step(w, [], 'up', 1);
    expect(w.player.y).toBe(y - 2);
  });

  it('collects the pip and emits an event', () => {
    const w = new World({ seed: 1 });
    w.pip = { x: w.player.x, y: w.player.y - 1 };
    step(w, [{ type: 'move', dir: 'up' }]);
    expect(w.score).toBe(1);
    expect(w.events.some((e) => e.type === 'pickup')).toBe(true);
  });

  it('is deterministic for a seed', () => {
    const a = new World({ seed: 99 });
    const b = new World({ seed: 99 });
    expect(a.pip).toEqual(b.pip);
  });

  it('freezes gameplay time while paused', () => {
    const w = new World({ seed: 1 });
    w.state = 'PAUSED';
    step(w, [{ type: 'move', dir: 'up' }], null, 10);
    expect(w.tick).toBe(0);
    expect(w.uiTick).toBe(10);
  });
});
