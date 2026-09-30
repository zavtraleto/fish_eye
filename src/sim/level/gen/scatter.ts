import type { Rng } from '../../../core/rng';
import type { Point } from '../geometry';
import type { Field } from './noise';

// Anchor points of the structure (GDD §7 step 2): Poisson-like darts with a
// spacing per point, so the rhythm is irregular — not a human grid. A spacing
// field groups them: clusters of small chambers here, giants there.

/** Tries per wanted point before giving up on a crowded field. */
const TRIES_PER_POINT = 30;

/**
 * Up to `count` points in a square sized for them; two points keep at least
 * the mean of their spacings apart. A spacing is uniform in [minR, maxR], or
 * follows `spacing` (0 → minR, 1 → maxR) with a little jitter.
 */
export function scatterPoints(rng: Rng, count: number, minR: number, maxR: number, spacing?: Field): Point[] {
  const side = Math.sqrt(count) * ((minR + maxR) / 2) * 1.15;
  const pts: Point[] = [];
  const radii: number[] = [];
  for (let t = 0; t < count * TRIES_PER_POINT && pts.length < count; t++) {
    const p = { x: rng.next() * side, z: rng.next() * side };
    const s = spacing ? Math.min(1, Math.max(0, spacing(p.x, p.z) + (rng.next() - 0.5) * 0.2)) : rng.next();
    const r = minR + s * (maxR - minR);
    let ok = true;
    for (let k = 0; k < pts.length && ok; k++) ok = Math.hypot(p.x - pts[k]!.x, p.z - pts[k]!.z) >= (r + radii[k]!) / 2;
    if (!ok) continue;
    pts.push(p);
    radii.push(r);
  }
  return pts;
}
