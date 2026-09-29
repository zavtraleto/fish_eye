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
  /** GDD §3.1 */
  player: {
    MOVE_SPEED: 15,
    /** m/s² toward the wished velocity while a move key is held. */
    ACCEL: 130,
    /** m/s² toward rest with no move key held. */
    FRICTION: 90,
    RADIUS: 0.35,
    /** Render only. */
    EYE_HEIGHT: 1.9,
    /** Radians per mouse pixel. */
    MOUSE_SENSITIVITY: 0.0022,
    /** Longest collision substep, meters: keeps any speed from tunneling through a wall. */
    SUBSTEP: 0.1,
  },
  /** GDD §4: vertex fisheye. */
  camera: {
    /** Horizontal field of view, degrees. */
    H_FOV: 180,
    /** equidistant / stereographic */
    MAPPING: 'stereographic',
    PITCH_LIMIT: 85,
    NEAR: 0.05,
    FAR: 60,
  },
  view: {
    /** Upper bound on devicePixelRatio. */
    MAX_PIXEL_RATIO: 1,
    /** Canvas resolution relative to the window, upscaled without smoothing. */
    INTERNAL_SCALE: 0.75,
    FOG_NEAR: 5,
    FOG_FAR: 20,
    /** World geometry is cut into quads this long: the fisheye bends only vertices. */
    MESH_SEGMENT: 1,
  },
  /** GDD §10 */
  start: {
    /** Spawn distance from the white wall. */
    SPAWN_DISTANCE: 1.5,
    /** The white wall counts as touched within RADIUS + this. */
    TOUCH_MARGIN: 0.1,
  },
  /** GDD §10 */
  eye: {
    /** Touch radius on the floor plane. */
    RADIUS: 1.2,
    /** Render only: sphere radius, meters. */
    SIZE: 1.2,
    /** Render only. */
    HEIGHT: 2.4,
    /** Render only, rad/s. */
    SPIN: 0.8,
  },
  /** GDD §10: render only. */
  route: {
    LINE_WIDTH: 0.15,
    LINE_LIFT: 0.03,
  },
  /** GDD §14 */
  run: {
    LEVEL_CLEAR_TIME: 1.0,
    DEATH_COLLAPSE_TIME: 0.8,
    /** After the result appears, before a click or Space restarts. */
    RESTART_LOCKOUT: 0.5,
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
