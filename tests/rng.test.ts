import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';

describe('Rng', () => {
  it('repeats for the same seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('forks independent streams', () => {
    const root = new Rng(42);
    const a = root.fork('a');
    const aAgain = new Rng(42).fork('a');
    const b = root.fork('b');
    expect(a.next()).toBe(aAgain.next());
    expect(a.next()).not.toBe(b.next());
  });

  it('keeps int() within bounds', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(2, 5);
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
    }
  });
});
