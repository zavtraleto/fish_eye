import type { Rng } from '../../../core/rng';
import type { Point } from '../geometry';

// Anchor points of the structure (GDD §7 step 2): Poisson-like darts with a
// spacing drawn per point, so the rhythm is irregular — not a human grid.

/** Tries per wanted point before giving up on a crowded field. */
const TRIES_PER_POINT = 30;

/**
 * Up to `count` points in a square sized for them; two points keep at least
 * the mean of their spacings apart, each spacing uniform in [minR, maxR].
 */
export function scatterPoints(rng: Rng, count: number, minR: number, maxR: number): Point[] {
  const side = Math.sqrt(count) * ((minR + maxR) / 2) * 1.15;
  const pts: Point[] = [];
  const radii: number[] = [];
  for (let t = 0; t < count * TRIES_PER_POINT && pts.length < count; t++) {
    const p = { x: rng.next() * side, z: rng.next() * side };
    const r = minR + rng.next() * (maxR - minR);
    let ok = true;
    for (let k = 0; k < pts.length && ok; k++) ok = Math.hypot(p.x - pts[k]!.x, p.z - pts[k]!.z) >= (r + radii[k]!) / 2;
    if (!ok) continue;
    pts.push(p);
    radii.push(r);
  }
  return pts;
}
