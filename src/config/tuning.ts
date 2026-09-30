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
    /** Enemy contact radius (GDD §5.5). */
    RADIUS: 0.35,
    /**
     * Wall collision radius: keeps the camera this far from walls, where the
     * vertex fisheye bends near geometry badly (VISUAL.md §11).
     */
    WALL_RADIUS: 1,
    /** Render only. */
    EYE_HEIGHT: 1.9,
    /** Radians per mouse pixel. */
    MOUSE_SENSITIVITY: 0.0022,
    /** Longest collision substep, meters: keeps any speed from tunneling through a wall. */
    SUBSTEP: 0.1,
    /** Body height for enemy contact (GDD §5.5). */
    BODY_HEIGHT: 2,
  },
  /** GDD §5.2 */
  jump: {
    /** m/s² */
    GRAVITY: 36,
    /** Vertical take-off speed. */
    SPEED: 10.8,
    /** A press this long before landing jumps on landing. */
    BUFFER: 0.1,
    /** After landing, speed above MOVE_SPEED is kept this long: a jump in the window keeps it. */
    BHOP_WINDOW: 0.1,
    /** m/s² at which speed above MOVE_SPEED fades on the ground after the window. */
    OVERSPEED_DECEL: 14,
    /** m/s²; air steering never raises speed above max(MOVE_SPEED, current). */
    AIR_ACCEL: 40,
    /** Cap on horizontal speed. */
    MAX_SPEED: 60,
  },
  /** GDD §5.3 */
  dash: {
    DURATION: 0.15,
    BASE_SPEED: 30,
    /** Part of the current horizontal speed added to BASE_SPEED. */
    SPEED_GAIN: 0.5,
    /** Part of the dash speed kept when it ends. */
    EXIT_FRACTION: 0.6,
  },
  /** GDD §5.4 */
  slide: {
    MIN_SPEED: 20,
    /** m/s² */
    FRICTION: 4,
    /** Degrees per second the move keys turn the slide. */
    TURN_RATE: 90,
    MAX_TIME: 1.2,
    /** Below this speed the slide ends. */
    STOP_SPEED: 9,
    BODY_HEIGHT: 1,
    /** Render only. */
    EYE_HEIGHT: 0.9,
    /** Render only: camera lowering time constant. */
    CAMERA_TIME: 0.08,
  },
  /** GDD §11 */
  enemy: {
    RADIUS: 1.2,
    /** The body floats from HOVER to HOVER + HEIGHT: slide under it, not over (GDD §11). */
    HOVER: 1.1,
    HEIGHT: 2.2,
    MOVE_SPEED: 12,
    /** Degrees per second while hunting. */
    TURN_RATE: 360,
    CHARGE_RANGE_MIN: 12,
    CHARGE_RANGE_MAX: 30,
    WINDUP_TIME: 0.45,
    CHARGE_SPEED: 40,
    /** Degrees per second of steering while charging and recovering. */
    CHARGE_TURN_RATE: 20,
    CHARGE_MAX_DIST: 45,
    /** Seconds of player velocity added to the aim; 0 aims at the current position. */
    CHARGE_LEAD: 0,
    /** From the end of one charge to the next windup. */
    CHARGE_COOLDOWN: 1.5,
    RECOVERY_TIME: 0.8,
    WALL_STUN_TIME: 1.2,
    /** Harmless after appearing. */
    SPAWN_MATERIALIZE: 0.6,
    /** First level with an enemy. */
    FIRST_LEVEL: 2,
    /** The nav field is rebuilt at most this often, and only when the player changed cell. */
    REPATH_TIME: 0.25,
    /** Meters of nav path ahead the enemy may cut to in a straight line. */
    NAV_LOOKAHEAD: 8,
  },
  /** GDD §7: level generation. */
  gen: {
    /** Spacing of the structure's anchor points drawn per point, meters (Poisson). */
    POINT_SPACING_MIN: 30,
    POINT_SPACING_MAX: 85,
    /** Feature size of the spacing field, meters: districts of small chambers and of giants. */
    SPACING_SCALE: 220,
    /** Longer Delaunay edges are dropped: a gallery that long would pass other spaces. */
    EDGE_MAX: 110,
    /** Two edges of a node closer than this, degrees: the longer one is dropped. */
    EDGE_MIN_ANGLE: 25,
    /** New spaces per ear at most. */
    EAR_MAX_NODES: 3,
    /** A chord joins spaces at least this many steps apart: a loop must shorten the way (Brogue). */
    LOOP_MIN_GRAPH_DIST: 3,
    /** A "different route" is at most this many times the shortest. */
    ROUTE_STRETCH: 1.5,
    /** Failed tries before the targets are relaxed one step. */
    GEN_MAX_ATTEMPTS: 200,
    /** Hall size as a share of the distance to the nearest space (GDD §6: balance of halls and galleries). */
    HALL_SIZE_MIN: 0.4,
    HALL_SIZE_MAX: 0.55,
    /** …but a hall keeps within this share of the distance to a space it does not open to. */
    HALL_CLEARANCE: 0.42,
    /** The heart is a bigger hall. */
    HEART_SIZE: 0.5,
    /** Corners of a hall polygon. */
    HALL_CORNERS_MIN: 5,
    HALL_CORNERS_MAX: 8,
    GALLERY_WIDTH_MIN: 7,
    GALLERY_WIDTH_MAX: 14,
    THROAT_WIDTH_MIN: 5,
    THROAT_WIDTH_MAX: 6,
    /** Share of passages that are throats; never a bridge, so always avoidable. */
    THROAT_CHANCE: 0.2,
    /** Share of passages that are naves: huge galleries. */
    NAVE_CHANCE: 0.12,
    NAVE_WIDTH_MIN: 16,
    NAVE_WIDTH_MAX: 24,
    /** Each leg of a passage is this much wider or narrower than its base width, at most. */
    WIDTH_VARIATION: 0.3,
    /** Narrowest passage anywhere, meters: room for the enemy and a dodge. */
    MIN_CLEARANCE: 5,
    /** Share of passages that run straight; the rest bend. */
    STRAIGHT_CHANCE: 0.25,
    /** A flesh-kin bend pushes sideways by this share of the passage length. */
    BEND_MIN: 0.12,
    BEND_MAX: 0.3,
    /** Shortest leg of a machine L or Z, meters. */
    MIN_LEG: 8,
    /** Halls closer than this gap, meters, may fuse through a wide mouth… */
    FUSE_GAP: 14,
    /** …with this chance. */
    FUSE_CHANCE: 0.3,
    /** Feature size of the "kind" field, meters: machine districts vs flesh-kin ones (GDD §6). */
    KIND_SCALE: 260,
    /** Feature size of the machine grid orientation field, meters. */
    GRID_SCALE: 320,
    /** Machine grid orientations are multiples of this, degrees. */
    GRID_SNAP: 15,
    /** Share of machine halls that are a cross, T or L of two rectangles. */
    CROSS_CHANCE: 0.45,
    /** Share of flesh-kin halls that are a clump of two or three polygons. */
    CLUMP_CHANCE: 0.5,
    /** The START box: width along the white wall, depth away from it. */
    START_WIDTH: 20,
    START_DEPTH: 18,
    /** The white wall is at least this long (GDD §10). */
    START_WALL_MIN: 12,
    /** Ceilings, render only; every one clears a jump. */
    HALL_HEIGHT_MIN: 10,
    HALL_HEIGHT_MAX: 30,
    GALLERY_HEIGHT_MIN: 6,
    GALLERY_HEIGHT_MAX: 14,
    THROAT_HEIGHT: 5,
    START_HEIGHT: 8,
    HEART_HEIGHT: 24,
    /** Whole-level tries (graph + geometry) before falling back to the test level. */
    LEVEL_TRIES: 20,
    /** Free-space raster step, meters: wall detail and floor tessellation. */
    SDF_CELL: 0.5,
    /** Enemy navigation raster step, meters. */
    NAV_CELL: 1,
  },
  /** GDD §12: render only. */
  rear: {
    /** Proxies show for enemies closer than this; covers CHARGE_RANGE_MAX. */
    PROXY_RANGE: 40,
    OPACITY: 0.6,
    /** Without a line of sight: dimmer, shakier. */
    HIDDEN_OPACITY: 0.25,
    /** Per-frame shake, meters. */
    JITTER: 0.1,
    HIDDEN_JITTER: 0.6,
  },
  /** GDD §4: vertex fisheye. */
  camera: {
    /** Horizontal field of view, degrees. */
    H_FOV: 180,
    /** equidistant / stereographic */
    MAPPING: 'stereographic',
    PITCH_LIMIT: 85,
    NEAR: 0.05,
    FAR: 120,
  },
  view: {
    /** Upper bound on devicePixelRatio. */
    MAX_PIXEL_RATIO: 1,
    /** Canvas resolution relative to the window, upscaled without smoothing. */
    INTERNAL_SCALE: 0.75,
    FOG_NEAR: 5,
    FOG_FAR: 20,
    /**
     * Enemies and the white START wall fade over a longer range, scaled from
     * FOG_NEAR..FOG_FAR: landmarks seen early, not everywhere (GDD §10, §11).
     */
    SIGNAL_FOG_FAR: 60,
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

/** v2 stores only values that differ from the defaults, so new defaults reach players. */
const STORAGE_KEY = 'fisheye.tuning.v2';

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

/** Values of `values` that differ from `defaults`, grouped like the tuning object. */
export function tuningOverrides(values: Tuning, defaults: Tuning): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  const v = values as unknown as Record<string, Record<string, unknown>>;
  const d = defaults as unknown as Record<string, Record<string, unknown>>;
  for (const [group, keys] of Object.entries(d)) {
    for (const [key, def] of Object.entries(keys)) {
      const cur = v[group]?.[key];
      const same = typeof cur === 'number' && typeof def === 'number' ? Math.abs(cur - def) < 1e-9 : cur === def;
      if (!same) (out[group] ??= {})[key] = cur;
    }
  }
  return out;
}

export function saveTuningOverrides(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tuningOverrides(tuning, DEFAULT_TUNING)));
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
