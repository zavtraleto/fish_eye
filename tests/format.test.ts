import { describe, expect, it } from 'vitest';
import { formatClock, formatCount, formatSeconds } from '../src/ui/format';

describe('formats (GDD §14.3)', () => {
  it('formats the level clear line numbers', () => {
    expect(formatCount(7)).toBe('07');
    expect(formatSeconds(12.481)).toBe('12.48');
    expect(formatClock(161.22)).toBe('02:41.22');
    expect(formatClock(0)).toBe('00:00.00');
    expect(formatClock(59.999)).toBe('00:59.99');
  });
});
