import { describe, expect, it } from 'vitest';
import { mirrorRear } from '../src/render/rearMirror';
import { yawAxes } from '../src/sim/look';

const HALF = Math.PI / 2;
/** Looking along -z (yaw 0): right is +x, behind is +z. */
const EYE = { x: 10, z: 10, yaw: 0 };

describe('rear-view mirror (GDD §12)', () => {
  it('shows an enemy straight behind straight ahead, at the same distance', () => {
    const m = mirrorRear(EYE, HALF, 40, 10, 22, 0, -1)!;
    expect(m.x).toBeCloseTo(10);
    expect(m.z).toBeCloseTo(-2);
    expect(m.distance).toBeCloseTo(12);
  });

  it('keeps the side: rear left becomes front left', () => {
    const m = mirrorRear(EYE, HALF, 40, 5, 15, 0, 0)!;
    expect(m.x).toBeCloseTo(5);
    expect(m.z).toBeCloseTo(5);
  });

  it('shows nothing for an enemy in view or out of range', () => {
    expect(mirrorRear(EYE, HALF, 40, 12, 0, 0, 1)).toBeNull();
    expect(mirrorRear(EYE, HALF, 40, 10, 60, 0, -1)).toBeNull();
  });

  it('reflects a charge from behind into one coming at the player from the front', () => {
    const m = mirrorRear(EYE, HALF, 40, 10, 22, 0, -1)!;
    // The real charge heads -z (toward the eye); the proxy's heads +z, also toward the eye.
    expect(m.dirX).toBeCloseTo(0);
    expect(m.dirZ).toBeCloseTo(1);
  });

  it('works at any yaw', () => {
    const eye = { x: 0, z: 0, yaw: 1.1 };
    const { fx, fz, rx, rz } = yawAxes(eye.yaw);
    // 8 m behind and 3 m to the right.
    const m = mirrorRear(eye, HALF, 40, -fx * 8 + rx * 3, -fz * 8 + rz * 3, 0, 0)!;
    expect(m.x).toBeCloseTo(fx * 8 + rx * 3);
    expect(m.z).toBeCloseTo(fz * 8 + rz * 3);
  });
});
