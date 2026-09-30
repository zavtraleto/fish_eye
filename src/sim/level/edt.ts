import type { GridFrame } from './raster';

// Exact Euclidean distance transform on the node grid (Felzenszwalb &
// Huttenlocher): the true signed distance to the walls, which the union of
// shapes only bounds. Flesh (GDD §6) needs it: closing, opening, growths.

const INF = 1e20;

/** 1D squared distance transform of f (in place into d), sample spacing 1. */
function dt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!;
  }
}

/** Squared distance, in nodes, from every node to the nearest node where `feature` holds. */
function squaredDistance(w: number, h: number, feature: (k: number) => boolean): Float64Array {
  const out = new Float64Array(w * h);
  const len = Math.max(w, h);
  const f = new Float64Array(len);
  const d = new Float64Array(len);
  const v = new Int32Array(len);
  const z = new Float64Array(len + 1);
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) f[j] = feature(j * w + i) ? 0 : INF;
    dt1(f, h, d, v, z);
    for (let j = 0; j < h; j++) out[j * w + i] = d[j]!;
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) f[i] = out[j * w + i]!;
    dt1(f, w, d, v, z);
    for (let i = 0; i < w; i++) out[j * w + i] = d[i]!;
  }
  return out;
}

/**
 * Signed distance to the boundary of the open set {field > 0} at every node,
 * meters: positive in the open, negative in rock. The boundary is taken half a
 * cell from the nearest node on the other side.
 */
export function signedDistance(f: GridFrame, field: Float32Array): Float32Array {
  const w = f.w + 1;
  const h = f.h + 1;
  const toRock = squaredDistance(w, h, (k) => field[k]! <= 0);
  const toOpen = squaredDistance(w, h, (k) => field[k]! > 0);
  const out = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) {
    out[k] = field[k]! > 0 ? (Math.sqrt(toRock[k]!) - 0.5) * f.cell : -(Math.sqrt(toOpen[k]!) - 0.5) * f.cell;
  }
  return out;
}
