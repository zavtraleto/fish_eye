import type { Tuning } from '../config/tuning';

// Folder tree of the debug panel's Tune tab (GDD §15.3). Pure data and helpers:
// the Tweakpane panel (debugPanel.ts) renders it; a test checks it covers `tuning`.

export type GroupKey = keyof Tuning;
type Value = number | boolean | string;
type Groups = Record<string, Record<string, Value>>;

/** A folder shows the keys of its groups, then its child folders. */
export interface TuneFolder {
  title: string;
  groups?: readonly GroupKey[];
  children?: readonly TuneFolder[];
}

const leaf = (title: string, ...groups: GroupKey[]): TuneFolder => ({ title, groups });

export const TUNE_LAYOUT: readonly TuneFolder[] = [
  leaf('Sim', 'sim'),
  leaf('Player', 'player'),
  { title: 'Moveset', groups: ['jump', 'dash', 'slide'] },
  leaf('Enemy', 'enemy'),
  leaf('Rear vision', 'rear'),
  leaf('Camera', 'camera'),
  leaf('View', 'view'),
  { title: 'Level', groups: ['gen', 'start', 'eye', 'route'] },
  leaf('Run', 'run'),
];

/** Every group in the folders, depth first. */
export function layoutGroups(folders: readonly TuneFolder[]): GroupKey[] {
  return folders.flatMap((f) => [...(f.groups ?? []), ...layoutGroups(f.children ?? [])]);
}

export interface TuningChange {
  group: GroupKey;
  key: string;
  from: Value;
  to: Value;
}

function same(a: Value, b: Value): boolean {
  return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b;
}

/** Values that differ from the defaults, in panel order. */
export function changedValues(values: Tuning, defaults: Tuning): TuningChange[] {
  const v = values as unknown as Groups;
  const d = defaults as unknown as Groups;
  const out: TuningChange[] = [];
  for (const group of layoutGroups(TUNE_LAYOUT)) {
    for (const [key, from] of Object.entries(d[group] ?? {})) {
      const to = v[group]?.[key];
      if (to !== undefined && !same(from, to)) out.push({ group, key, from, to });
    }
  }
  return out;
}

/** One `group.KEY: from → to` line per change, for pasting into DEFAULT_TUNING. */
export function formatChanges(changes: readonly TuningChange[]): string {
  return changes.map((c) => `${c.group}.${c.key}: ${c.from} → ${c.to}`).join('\n');
}

export function resetGroups(values: Tuning, defaults: Tuning, groups: readonly GroupKey[]): void {
  const v = values as unknown as Groups;
  const d = defaults as unknown as Groups;
  for (const g of groups) Object.assign(v[g]!, JSON.parse(JSON.stringify(d[g])));
}

/** Every whitespace-separated word must occur in `group.KEY` or the folder title. */
export function matchesFilter(query: string, group: string, key: string, title: string): boolean {
  const hay = `${group}.${key} ${title}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

export function tuningControlKind(value: unknown): 'number' | 'boolean' | 'color' | 'string' {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return 'color';
  return 'string';
}

// Slider ranges by key name; anything not listed gets an auto range.
const RANGES: Record<string, [number, number, number]> = {
  SIM_HZ: [30, 240, 1],
  TIME_SCALE: [0.05, 4, 0.05],
  MOVE_SPEED: [1, 30, 0.1],
  ACCEL: [5, 1000, 1],
  FRICTION: [0, 1000, 0.5],
  RADIUS: [0.1, 3, 0.01],
  EYE_HEIGHT: [0.3, 3, 0.05],
  MOUSE_SENSITIVITY: [0.0002, 0.01, 0.0001],
  SUBSTEP: [0.02, 0.5, 0.01],
  SDF_CELL: [0.25, 2, 0.25],
  NAV_CELL: [0.5, 2, 0.5],
  NAV_LOOKAHEAD: [1, 30, 1],
  // Below 180 the rear-view mirror leaves a blind band (GDD §12).
  H_FOV: [180, 270, 1],
  BODY_HEIGHT: [0.3, 4, 0.05],
  GRAVITY: [5, 120, 0.5],
  SPEED: [1, 30, 0.1],
  BUFFER: [0, 0.5, 0.01],
  BHOP_WINDOW: [0, 0.5, 0.01],
  OVERSPEED_DECEL: [0, 100, 0.5],
  AIR_ACCEL: [0, 200, 1],
  MAX_SPEED: [10, 150, 1],
  DURATION: [0.03, 1, 0.01],
  BASE_SPEED: [0, 100, 0.5],
  SPEED_GAIN: [0, 2, 0.05],
  EXIT_FRACTION: [0, 1, 0.05],
  MIN_SPEED: [0, 60, 0.5],
  TURN_RATE: [0, 1080, 5],
  MAX_TIME: [0.1, 5, 0.05],
  STOP_SPEED: [0, 30, 0.5],
  CAMERA_TIME: [0, 0.5, 0.01],
  HOVER: [0, 5, 0.05],
  CHARGE_RANGE_MIN: [0, 60, 0.5],
  CHARGE_RANGE_MAX: [0, 80, 0.5],
  WINDUP_TIME: [0, 2, 0.01],
  CHARGE_SPEED: [0, 100, 0.5],
  CHARGE_TURN_RATE: [0, 180, 1],
  CHARGE_MAX_DIST: [0, 150, 1],
  CHARGE_LEAD: [0, 1, 0.01],
  CHARGE_COOLDOWN: [0, 5, 0.05],
  RECOVERY_TIME: [0, 3, 0.05],
  WALL_STUN_TIME: [0, 5, 0.05],
  SPAWN_MATERIALIZE: [0, 3, 0.05],
  FIRST_LEVEL: [1, 10, 1],
  REPATH_TIME: [0.05, 2, 0.05],
  WAYPOINT_RADIUS: [0.2, 5, 0.1],
  PROXY_RANGE: [0, 100, 1],
  OPACITY: [0, 1, 0.05],
  HIDDEN_OPACITY: [0, 1, 0.05],
  JITTER: [0, 2, 0.01],
  HIDDEN_JITTER: [0, 3, 0.01],
  PITCH_LIMIT: [0, 89, 1],
  NEAR: [0.01, 1, 0.01],
  FAR: [10, 300, 1],
  WALL_RADIUS: [0.35, 3, 0.05],
  SIGNAL_FOG_FAR: [5, 200, 1],
  MAX_PIXEL_RATIO: [0.5, 3, 0.25],
  INTERNAL_SCALE: [0.1, 1, 0.05],
  FOG_NEAR: [0, 100, 0.5],
  FOG_FAR: [1, 150, 0.5],
  MESH_SEGMENT: [0.25, 4, 0.25],
  SIZE: [0.2, 5, 0.05],
  SPAWN_DISTANCE: [0.5, 5, 0.1],
  TOUCH_MARGIN: [0, 1, 0.01],
  HEIGHT: [0.3, 4, 0.05],
  SPIN: [0, 6, 0.1],
  LINE_WIDTH: [0.02, 1, 0.01],
  LINE_LIFT: [0.005, 0.5, 0.005],
  LEVEL_CLEAR_TIME: [0, 3, 0.05],
  DEATH_COLLAPSE_TIME: [0, 3, 0.05],
  RESTART_LOCKOUT: [0, 3, 0.05],
};

/** String tunables shown as a dropdown. */
const OPTIONS: Record<string, readonly string[]> = {
  MAPPING: ['equidistant', 'stereographic'],
};

export function stringOptions(key: string): readonly string[] | undefined {
  return OPTIONS[key];
}

/** `[min, max, step]` for a numeric tunable with the given default. */
export function sliderRange(key: string, def: number): [number, number, number] {
  const listed = RANGES[key];
  if (listed) return listed;
  const d = Math.abs(def);
  if (d === 0) return [0, 10, 0.01];
  return [0, d * 4, Number.isInteger(def) && d >= 1 ? 1 : 0.01];
}
