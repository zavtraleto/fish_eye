// All tunable gameplay parameters (GDD §17). Times are in seconds.
// Never hardcode these values elsewhere: read them from `tuning`.
// The debug panel edits this object live and persists overrides.

export const DEFAULT_TUNING = {
  sim: {
    SIM_HZ: 60,
    /** Frames longer than this (tab was hidden) are clamped to avoid a tick burst. */
    MAX_FRAME_TIME: 0.25,
    TIME_SCALE: 1,
  },
  /** Greybox demo: delete with the demo (src/sim/world.ts). */
  player: {
    MOVE_TIME: 0.12,
    /** A held key keeps stepping after this delay. */
    HOLD_REPEAT_DELAY: 0.25,
  },
  field: {
    GRID_W: 5,
    GRID_H: 7,
  },
  view: {
    /** Upper bound on devicePixelRatio: the cheapest way to keep 60 FPS on phones. */
    MAX_PIXEL_RATIO: 2,
    CAMERA_FOV: 35,
    CAMERA_PITCH: 55,
    PICKUP_FLASH_TIME: 0.2,
  },
};

export type Tuning = typeof DEFAULT_TUNING;

const STORAGE_KEY = 'fisheye.tuning.v1';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export const tuning: Tuning = clone(DEFAULT_TUNING);

/** Copies known keys from `src` into `dst`, ignoring unknown keys and type mismatches. */
export function mergeTuning(dst: Tuning, src: unknown): void {
  if (!src || typeof src !== 'object') return;
  const d = dst as unknown as Record<string, Record<string, unknown>>;
  for (const [group, values] of Object.entries(src as Record<string, unknown>)) {
    const target = d[group];
    if (!target || !values || typeof values !== 'object') continue;
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      if (key in target && typeof target[key] === typeof value) target[key] = value;
    }
  }
}

export function loadTuningOverrides(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) mergeTuning(tuning, JSON.parse(raw));
  } catch {
    // storage unavailable or corrupted: keep defaults
  }
}

export function saveTuningOverrides(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tuning));
  } catch {
    // ignore
  }
}

export function resetTuning(): void {
  mergeTuning(tuning, clone(DEFAULT_TUNING));
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function secondsToTicks(seconds: number): number {
  return Math.max(0, Math.round(seconds * tuning.sim.SIM_HZ));
}
