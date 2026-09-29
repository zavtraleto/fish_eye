import { describe, expect, it } from 'vitest';
import { DEG, fisheyeRadius, parseMapping } from '../src/render/camera/fisheyeMath';

describe('fisheye math (GDD §4)', () => {
  it.each(['equidistant', 'stereographic'] as const)('%s puts the half FOV at the screen edge', (mapping) => {
    const half = 90 * DEG;
    expect(fisheyeRadius(0, half, mapping)).toBe(0);
    expect(fisheyeRadius(half, half, mapping)).toBeCloseTo(1);
    expect(fisheyeRadius(half * 0.5, half, mapping)).toBeLessThan(fisheyeRadius(half * 0.6, half, mapping));
  });

  it('stereographic draws the centre smaller and the edges larger than equidistant', () => {
    const half = 90 * DEG;
    expect(fisheyeRadius(30 * DEG, half, 'stereographic')).toBeLessThan(fisheyeRadius(30 * DEG, half, 'equidistant'));
  });

  it('defaults to stereographic', () => {
    expect(parseMapping('equidistant')).toBe('equidistant');
    expect(parseMapping('nope')).toBe('stereographic');
  });
});
