import { describe, expect, it } from 'vitest';
import { FixedStepClock } from '../src/core/loop';

describe('FixedStepClock', () => {
  it('runs whole ticks and carries the remainder', () => {
    const clock = new FixedStepClock({ hz: 60, maxFrameTime: 0.25 });
    expect(clock.advance(1 / 60)).toBe(1);
    expect(clock.advance(0.5 / 60)).toBe(0);
    expect(clock.alpha).toBeCloseTo(0.5);
    expect(clock.advance(0.5 / 60)).toBe(1);
  });

  it('clamps long frames', () => {
    const clock = new FixedStepClock({ hz: 60, maxFrameTime: 0.25 });
    expect(clock.advance(5)).toBe(15);
  });

  it('runs only queued steps while paused', () => {
    const clock = new FixedStepClock({ hz: 60, maxFrameTime: 0.25 });
    clock.paused = true;
    expect(clock.advance(1)).toBe(0);
    clock.stepOnce(3);
    expect(clock.advance(1)).toBe(3);
  });
});
