// Run score (GDD §14.2). Times are in ticks inside the sim, seconds in results.

export interface RunStats {
  eyesExtracted: number;
  /** Ticks spent PLAYING; screens and pause do not count. */
  runTicks: number;
  bestEscapeTicks: number | null;
  distanceTravelled: number;
}

export function newRunStats(): RunStats {
  return { eyesExtracted: 0, runTicks: 0, bestEscapeTicks: null, distanceTravelled: 0 };
}

/** Ready for a future leaderboard; v0 keeps the best one in localStorage. */
export interface RunResult {
  seed: number;
  eyes: number;
  /** Seconds. */
  runTime: number;
  version: string;
}

/** More EYES wins; equal EYES, less time wins (GDD §14.2). */
export function isBetterRun(a: RunResult, b: RunResult | null): boolean {
  if (!b) return true;
  return a.eyes !== b.eyes ? a.eyes > b.eyes : a.runTime < b.runTime;
}
