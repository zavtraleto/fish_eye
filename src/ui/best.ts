import { isBetterRun, type RunResult } from '../sim/run';

// Best run in localStorage (GDD §14.2). No backend in v0.

const STORAGE_KEY = 'fisheye.best.v1';

export function loadBest(): RunResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<RunResult>;
    if (typeof r.eyes !== 'number' || typeof r.runTime !== 'number') return null;
    return { seed: r.seed ?? 0, eyes: r.eyes, runTime: r.runTime, version: r.version ?? '' };
  } catch {
    return null;
  }
}

/** Stores `result` if it beats the stored best; returns whether it did. */
export function saveIfBest(result: RunResult): boolean {
  if (!isBetterRun(result, loadBest())) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
  } catch {
    // storage unavailable: the best still shows until reload
  }
  return true;
}
