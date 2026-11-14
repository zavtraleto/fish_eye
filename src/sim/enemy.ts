import { secondsToTicks as T, tuning } from '../config/tuning';
import type { SimEvent } from './events';
import type { Point } from './level/geometry';
import type { Level } from './level/level';
import { NavField } from './level/nav';
import { graphDistances, graphPath, lineOfSight } from './level/query';
import { cellAt, cellCenter } from './level/raster';
import { yawAxes, yawTo } from './look';
import { bodyRange } from './move/state';
import { approachVelocity, moveAndSlide, type Player } from './player';

// The enemy (GDD §11): HUNT → WINDUP → CHARGE → RECOVER, stunned by walls.
// It floats (HOVER..HOVER + HEIGHT): a charge is dodged sideways or slid under.

export type EnemyState = 'MATERIALIZE' | 'HUNT' | 'WINDUP' | 'CHARGE' | 'RECOVER' | 'STUNNED';

export interface Enemy {
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  vx: number;
  vz: number;
  /** Facing, same convention as the view yaw (GDD look.ts). */
  yaw: number;
  state: EnemyState;
  stateTick: number;
  chargeFromX: number;
  chargeFromZ: number;
  /** Tick the last charge ended; the cooldown counts from it. */
  lastAttackTick: number;
  /** Steps to the player over the nav raster (GDD §11.1); built on first need. */
  nav: NavField | null;
  navTick: number;
}

export function createEnemy(x: number, z: number, yaw: number, tick: number): Enemy {
  return {
    x,
    z,
    prevX: x,
    prevZ: z,
    vx: 0,
    vz: 0,
    yaw,
    state: 'MATERIALIZE',
    stateTick: tick,
    chargeFromX: x,
    chargeFromZ: z,
    lastAttackTick: -Infinity,
    nav: null,
    navTick: -Infinity,
  };
}

/** Deadly contact: circles meet on the floor plane and the bodies overlap in height (GDD §5.5, §11.7). */
export function enemyTouches(e: Enemy, p: Player): boolean {
  if (e.state === 'MATERIALIZE') return false;
  if (Math.hypot(p.x - e.x, p.z - e.z) >= tuning.enemy.RADIUS + tuning.player.RADIUS) return false;
  const [lo, hi] = bodyRange(p.move);
  const { HOVER, HEIGHT } = tuning.enemy;
  return lo < HOVER + HEIGHT && hi > HOVER;
}

/**
 * Honest spawn (GDD §11.6): a node at least two graph steps from the player
 * and off the shortest EYE → START path if one exists; the nearest such
 * nodes, one picked by `pick`.
 */
export function chooseSpawnNode(level: Level, playerNode: number, pick: (n: number) => number): number {
  const dist = graphDistances(level, playerNode);
  const escape = new Set(graphPath(level, level.graph.eye, level.graph.start));
  const nodes = level.graph.rooms.map((r) => r.id).filter((id) => id !== playerNode);
  const far = nodes.filter((id) => (dist.get(id) ?? Infinity) >= 2);
  const off = far.filter((id) => !escape.has(id));
  const pool = off.length ? off : far.length ? far : nodes;
  const nearest = Math.min(...pool.map((id) => dist.get(id) ?? Infinity));
  const best = pool.filter((id) => dist.get(id) === nearest).sort((a, b) => a - b);
  return best[pick(best.length)] ?? playerNode;
}

/**
 * Ambush spawn (GDD §11.6): a cell out of the player's sight, AMBUSH_MIN..AMBUSH_MAX
 * nav steps away (the ring moves outward to AMBUSH_FAR if nothing hides),
 * as far in front of the view as the ring allows; one of the best
 * AMBUSH_PICK picked by `pick`. Null if no cell qualifies.
 */
export function chooseAmbushPoint(level: Level, p: Point, yaw: number, pick: (n: number) => number): Point | null {
  const c = tuning.enemy;
  const f = level.nav.frame;
  const field = new NavField(level.nav);
  field.build(p.x, p.z, Infinity, Infinity, c.RADIUS);
  const { fx, fz } = yawAxes(yaw);
  const width = Math.max(1, c.AMBUSH_MAX - c.AMBUSH_MIN);
  for (let lo = c.AMBUSH_MIN; lo < Math.max(c.AMBUSH_MAX, c.AMBUSH_FAR); lo += width) {
    const ranked: { cell: number; front: number }[] = [];
    for (let cell = 0; cell < f.w * f.h; cell++) {
      const m = field.stepsAt(cell) * f.cell;
      if (m < lo || m > lo + width || level.nav.clearance[cell]! < c.RADIUS) continue;
      const q = cellCenter(f, cell);
      const d = Math.hypot(q.x - p.x, q.z - p.z) || 1;
      ranked.push({ cell, front: ((q.x - p.x) * fx + (q.z - p.z) * fz) / d });
    }
    ranked.sort((a, b) => b.front - a.front || a.cell - b.cell);
    const hidden: Point[] = [];
    for (const { cell } of ranked) {
      const q = cellCenter(f, cell);
      if (outOfSight(level, p, q, c.RADIUS)) hidden.push(q);
      if (hidden.length >= c.AMBUSH_PICK) break;
    }
    if (hidden.length) return hidden[pick(hidden.length)]!;
  }
  return null;
}

/** No ray from the player to the body's centre or either side passes. */
function outOfSight(level: Level, p: Point, q: Point, radius: number): boolean {
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = (-dz / len) * radius;
  const nz = (dx / len) * radius;
  for (const k of [0, 1, -1]) {
    if (lineOfSight(level.wallIndex, p, { x: q.x + nx * k, z: q.z + nz * k })) return false;
  }
  return true;
}

function setState(e: Enemy, state: EnemyState, tick: number): void {
  e.state = state;
  e.stateTick = tick;
}

/** Turns the facing toward `target` by at most `degPerSec` · dt. */
function turnToward(e: Enemy, target: Point, degPerSec: number, dt: number): void {
  const want = yawTo(target.x - e.x, target.z - e.z);
  const diff = Math.atan2(Math.sin(want - e.yaw), Math.cos(want - e.yaw));
  const max = ((degPerSec * Math.PI) / 180) * dt;
  e.yaw += Math.max(-max, Math.min(max, diff));
}

function setForward(e: Enemy, speed: number): void {
  const { fx, fz } = yawAxes(e.yaw);
  e.vx = fx * speed;
  e.vz = fz * speed;
}

export function stepEnemy(e: Enemy, level: Level, p: Player, tick: number, dt: number, out: SimEvent[]): void {
  const c = tuning.enemy;
  const age = tick - e.stateTick;
  const playerPos = { x: p.x, z: p.z };
  e.prevX = e.x;
  e.prevZ = e.z;

  switch (e.state) {
    case 'MATERIALIZE':
      e.vx = e.vz = 0;
      if (age >= T(c.SPAWN_MATERIALIZE)) setState(e, 'HUNT', tick);
      break;
    case 'HUNT': {
      const dist = Math.hypot(p.x - e.x, p.z - e.z);
      const clear = lineOfSight(level.wallIndex, e, playerPos, c.RADIUS);
      if (clear && dist >= c.CHARGE_RANGE_MIN && dist <= c.CHARGE_RANGE_MAX && tick - e.lastAttackTick >= T(c.CHARGE_COOLDOWN)) {
        e.vx = e.vz = 0;
        setState(e, 'WINDUP', tick);
        out.push({ type: 'enemyWindup' });
        break;
      }
      const target = huntTarget(e, level, p, tick);
      turnToward(e, target, c.TURN_RATE, dt);
      setForward(e, c.MOVE_SPEED);
      break;
    }
    case 'WINDUP':
      // Stops and turns to the player; the aim locks at the end (GDD §11.3).
      e.vx = e.vz = 0;
      turnToward(e, playerPos, c.TURN_RATE, dt);
      if (age >= T(c.WINDUP_TIME)) {
        const aim = { x: p.x + p.vx * c.CHARGE_LEAD, z: p.z + p.vz * c.CHARGE_LEAD };
        e.yaw = yawTo(aim.x - e.x, aim.z - e.z);
        e.chargeFromX = e.x;
        e.chargeFromZ = e.z;
        setState(e, 'CHARGE', tick);
        out.push({ type: 'enemyCharged' });
        setForward(e, c.CHARGE_SPEED);
      }
      break;
    case 'CHARGE':
      turnToward(e, playerPos, c.CHARGE_TURN_RATE, dt);
      setForward(e, c.CHARGE_SPEED);
      break;
    case 'RECOVER':
      turnToward(e, playerPos, c.CHARGE_TURN_RATE, dt);
      approachVelocity(e, 0, 0, (c.CHARGE_SPEED / Math.max(0.05, c.RECOVERY_TIME)) * dt);
      if (age >= T(c.RECOVERY_TIME)) setState(e, 'HUNT', tick);
      break;
    case 'STUNNED':
      e.vx = e.vz = 0;
      if (age >= T(c.WALL_STUN_TIME)) setState(e, 'HUNT', tick);
      break;
  }

  moveAndSlide(e, level.wallIndex, dt, c.RADIUS);

  if (e.state === 'CHARGE') {
    const { fx, fz } = yawAxes(e.yaw);
    if (e.vx * fx + e.vz * fz < c.CHARGE_SPEED * 0.5) {
      // Flew into a wall: the reward for baiting it (GDD §11.5).
      e.lastAttackTick = tick;
      setState(e, 'STUNNED', tick);
      out.push({ type: 'enemyStunned' });
    } else if (Math.hypot(e.x - e.chargeFromX, e.z - e.chargeFromZ) >= c.CHARGE_MAX_DIST) {
      e.lastAttackTick = tick;
      setState(e, 'RECOVER', tick);
    }
  }
}

/** The player in sight, else the farthest nav cell ahead that the body can reach straight (GDD §11.1). */
function huntTarget(e: Enemy, level: Level, p: Player, tick: number): Point {
  const c = tuning.enemy;
  if (lineOfSight(level.wallIndex, e, p)) return { x: p.x, z: p.z };
  const f = level.nav.frame;
  const nav = e.nav && e.nav.grid === level.nav ? e.nav : (e.nav = new NavField(level.nav));
  const goal = cellAt(f, p.x, p.z);
  if (nav.goal < 0 || (goal !== nav.goal && tick - e.navTick >= T(c.REPATH_TIME))) {
    nav.build(p.x, p.z, e.x, e.z, c.RADIUS);
    e.navTick = tick;
  }
  const steps = Math.max(1, Math.round(c.NAV_LOOKAHEAD / f.cell));
  let path = nav.descend(e.x, e.z, steps);
  if (!path.length) {
    // Knocked off the explored part (a charge, a stun): rebuild now.
    nav.build(p.x, p.z, e.x, e.z, c.RADIUS);
    e.navTick = tick;
    path = nav.descend(e.x, e.z, steps);
  }
  for (let i = path.length - 1; i > 0; i--) {
    const q = cellCenter(f, path[i]!);
    if (lineOfSight(level.wallIndex, e, q, c.RADIUS)) return q;
  }
  return path.length > 1 ? cellCenter(f, path[1]!) : { x: p.x, z: p.z };
}
