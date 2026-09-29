import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../src/config/tuning';
import { TUNE_LAYOUT, layoutGroups } from '../src/debug/tuningLayout';
import { parseDebugParams } from '../src/debug/params';

describe('tuning layout', () => {
  it('places every tuning group in the debug panel exactly once', () => {
    const placed = layoutGroups(TUNE_LAYOUT);
    expect([...placed].sort()).toEqual(Object.keys(DEFAULT_TUNING).sort());
  });
});

describe('debug params', () => {
  it('parses and clamps', () => {
    const p = parseDebugParams('?debug=1&seed=12&timescale=10&god=true');
    expect(p).toEqual({ debug: true, seed: 12, god: true, timescale: 4 });
  });
});
