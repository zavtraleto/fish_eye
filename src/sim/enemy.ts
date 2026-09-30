import { secondsToTicks as T, tuning } from '../config/tuning';
import type { SimEvent } from './events';
import type { Point } from './level/geometry';
import type { Area, Level } from './level/level';
import { doorBetween, graphDistances, graphPath, lineOfSight, locate, sameArea } from './level/query';
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
  path: Point[];
  pathTick: number;
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
    path: [],
    pathTick: -Infinity,
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
 * Honest spawn (GDD §11.6): a room at least two graph steps from the player
 * and off the shortest EYE → START path if one exists; the nearest such
 * rooms, one picked by `pick`.
 */
export function chooseSpawnRoom(level: Level, playerRoom: number, pick: (n: number) => number): number {
  const dist = graphDistances(level, playerRoom);
  const escape = new Set(graphPath(level, level.graph.eye, level.graph.start));
  const rooms = level.graph.rooms.map((r) => r.id).filter((id) => id !== playerRoom);
  const far = rooms.filter((id) => (dist.get(id) ?? Infinity) >= 2);
  const off = far.filter((id) => !escape.has(id));
  const pool = off.length ? off : far.length ? far : rooms;
  const nearest = Math.min(...pool.map((id) => dist.get(id) ?? Infinity));
  const best = pool.filter((id) => dist.get(id) === nearest).sort((a, b) => a - b);
  return best[pick(best.length)] ?? playerRoom;
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
      const clear = lineOfSight(level.walls, e, playerPos, c.RADIUS);
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

  moveAndSlide(e, level.walls, dt, c.RADIUS);

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

/** The player when in reach, else the next point of a graph path (GDD §11.1). */
function huntTarget(e: Enemy, level: Level, p: Player, tick: number): Point {
  const here = locate(level, e.x, e.z);
  const there = locate(level, p.x, p.z);
  if (!here || !there || sameArea(here, there) || lineOfSight(level.walls, e, p)) {
    e.path = [];
    return { x: p.x, z: p.z };
  }
  if (e.path.length === 0 || tick - e.pathTick >= T(tuning.enemy.REPATH_TIME)) {
    e.path = planPath(level, here, there);
    e.pathTick = tick;
  }
  while (e.path.length && Math.hypot(e.path[0]!.x - e.x, e.path[0]!.z - e.z) < tuning.enemy.WAYPOINT_RADIUS) e.path.shift();
  return e.path[0] ?? { x: p.x, z: p.z };
}

/** Rooms an area touches, each with the door point that leads from the area into it. */
function exits(level: Level, area: Area): { room: number; door: Point | null }[] {
  if (area.kind === 'room') return [{ room: area.room, door: null }];
  const [onA, onB] = doorBetween(level, area.a, area.b);
  return [
    { room: area.a, door: onA },
    { room: area.b, door: onB },
  ];
}

/** Door points from the enemy's area to the player's, through the fewest rooms. */
function planPath(level: Level, from: Area, to: Area): Point[] {
  let best: Point[] | null = null;
  let bestSteps = Infinity;
  for (const s of exits(level, from)) {
    for (const g of exits(level, to)) {
      const rooms = graphPath(level, s.room, g.room);
      if (!rooms.length || rooms.length >= bestSteps) continue;
      const points: Point[] = [];
      if (s.door) points.push(s.door);
      for (let i = 0; i + 1 < rooms.length; i++) points.push(...doorBetween(level, rooms[i]!, rooms[i + 1]!));
      if (g.door) points.push(g.door);
      best = points;
      bestSteps = rooms.length;
    }
  }
  return best ?? [];
}
