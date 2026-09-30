import type { GridFrame } from './raster';

// Rock islands (GDD §6: no thin columns): solid pieces cut off from the outer
// rock by open space. Small or thin ones read as noise and clutter dodges, so
// they are opened up. Thickness is measured in layers peeled from the island's
// edge inward (the field itself is clamped a cell deep into rock).

/** Value written over a removed island: open, barely. */
const OPENED = 0.01;

/**
 * Opens islands smaller than `minArea` m² or thinner than `minThickness` m.
 * Returns how many were opened.
 */
export function openRockIslands(f: GridFrame, field: Float32Array, minArea: number, minThickness: number): number {
  const n = f.w + 1;
  const m = f.h + 1;
  const seen = new Uint8Array(n * m);
  const queue = new Int32Array(n * m);
  const flood = (start: number, collect: boolean): number[] => {
    const out: number[] = [];
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const k = queue[head++]!;
      if (collect) out.push(k);
      const i = k % n;
      const j = (k - i) / n;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= n || b >= m) continue;
        const q = b * n + a;
        if (seen[q] || field[q]! > 0) continue;
        seen[q] = 1;
        queue[tail++] = q;
      }
    }
    return out;
  };
  /** Layers of the island: 1 on its edge (next to open space), +1 per step inward; the most. */
  const layer = new Int32Array(n * m);
  const peel = (island: number[]): number => {
    let head = 0;
    let tail = 0;
    const open = (a: number, b: number) => a >= 0 && b >= 0 && a < n && b < m && field[b * n + a]! > 0;
    for (const q of island) {
      const i = q % n;
      const j = (q - i) / n;
      layer[q] = open(i + 1, j) || open(i - 1, j) || open(i, j + 1) || open(i, j - 1) ? 1 : 0;
      if (layer[q]) queue[tail++] = q;
    }
    let most = 1;
    while (head < tail) {
      const q = queue[head++]!;
      const i = q % n;
      const j = (q - i) / n;
      for (const r of [q + 1, q - 1, q + n, q - n]) {
        const ri = r % n;
        if (r < 0 || r >= n * m || Math.abs(ri - i) > 1 || Math.abs((r - ri) / n - j) > 1) continue;
        if (field[r]! > 0 || layer[r]) continue;
        layer[r] = layer[q]! + 1;
        most = Math.max(most, layer[r]!);
        queue[tail++] = r;
      }
    }
    return most;
  };
  // The outer rock: everything solid that reaches the frame's border.
  for (let i = 0; i < n; i++) {
    for (const j of [0, m - 1]) if (!seen[j * n + i] && field[j * n + i]! <= 0) flood(j * n + i, false);
  }
  for (let j = 0; j < m; j++) {
    for (const i of [0, n - 1]) if (!seen[j * n + i] && field[j * n + i]! <= 0) flood(j * n + i, false);
  }
  let opened = 0;
  for (let k = 0; k < n * m; k++) {
    if (seen[k] || field[k]! > 0) continue;
    const island = flood(k, true);
    if (island.length * f.cell * f.cell >= minArea && 2 * (peel(island) - 1) * f.cell >= minThickness) continue;
    for (const q of island) field[q] = OPENED;
    opened++;
  }
  return opened;
}
