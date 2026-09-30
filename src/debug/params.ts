// URL debug parameters (GDD §15.3): ?debug=1&seed=123&god=1&timescale=0.5&map=1

export interface DebugParams {
  debug: boolean;
  seed: number | null;
  god: boolean;
  timescale: number;
  /** Opens the top-down structure map. */
  map: boolean;
}

export function parseDebugParams(search: string): DebugParams {
  const q = new URLSearchParams(search);
  const flag = (k: string) => q.get(k) === '1' || q.get(k) === 'true';
  const num = (k: string) => {
    const raw = q.get(k);
    if (raw === null || raw.trim() === '') return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  };
  const seed = num('seed');
  const timescale = num('timescale');
  return {
    debug: flag('debug'),
    seed: seed === null ? null : Math.floor(seed) >>> 0,
    god: flag('god'),
    timescale: timescale === null ? 1 : Math.min(4, Math.max(0.05, timescale)),
    map: flag('map'),
  };
}
