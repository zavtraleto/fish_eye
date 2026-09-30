import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING, mergeTuning, secondsToTicks as T, tuning } from '../src/config/tuning';
import { noButtons } from '../src/core/input/commands';
import { chooseSpawnNode, createEnemy, enemyTouches, type Enemy } from '../src/sim/enemy';
import { graphDistances, graphPath, lineOfSight, nodeAnchor } from '../src/sim/level/query';
import { yawTo } from '../src/sim/look';
import { createPlayer } from '../src/sim/player';
import { World } from '../src/sim/world';
import { fixedLevels, idle, walk } from './helpers';

/** The big EYE room of the fixed level: rect(128, 83, 160, 113). */
const EYE_ROOM = 5;
const START_ROOM = 0;

function playing(god = false): World {
  return new World({ seed: 1, startState: 'PLAYING', cheats: { god }, levels: fixedLevels });
}

/** Puts a hunting enemy at (x, z) facing the player. */
function hunter(w: World, x: number, z: number): Enemy {
  const p = w.player;
  const e = createEnemy(x, z, yawTo(p.x - x, p.z - z), w.tick);
  e.state = 'HUNT';
  w.enemy = e;
  return e;
}

function place(w: World, x: number, z: number): void {
  const p = w.player;
  p.x = p.prevX = x;
  p.z = p.prevZ = z;
  p.vx = p.vz = 0;
}

describe('enemy (GDD §11)', () => {
  beforeEach(() => mergeTuning(tuning, JSON.parse(JSON.stringify(DEFAULT_TUNING))));

  it('kills on contact unless the player is under it, and not while materializing', () => {
    const p = createPlayer(0, 0);
    const e = createEnemy(1, 0, 0, 0);
    expect(enemyTouches(e, p)).toBe(false); // MATERIALIZE
    e.state = 'CHARGE';
    expect(enemyTouches(e, p)).toBe(true);
    p.move.mode = 'slide';
    expect(enemyTouches(e, p)).toBe(false);
    p.move.mode = 'air';
    p.move.y = tuning.enemy.HOVER + tuning.enemy.HEIGHT + 0.1;
    expect(enemyTouches(e, p)).toBe(false);
    e.x = tuning.enemy.RADIUS + tuning.player.RADIUS + 0.01;
    p.move.mode = 'ground';
    p.move.y = 0;
    expect(enemyTouches(e, p)).toBe(false);
  });

  it('materializes harmlessly, then hunts', () => {
    const w = playing();
    w.spawnEnemy();
    const e = w.enemy!;
    expect(e.state).toBe('MATERIALIZE');
    idle(w, T(tuning.enemy.SPAWN_MATERIALIZE));
    expect(e.state).toBe('HUNT');
  });

  it('spawns off the escape path, at least two rooms away, and nearest among those', () => {
    const w = playing();
    const level = w.level;
    const room = chooseSpawnNode(level, EYE_ROOM, () => 0);
    const dist = graphDistances(level, EYE_ROOM);
    const escape = graphPath(level, EYE_ROOM, START_ROOM);
    expect(dist.get(room)).toBeGreaterThanOrEqual(2);
    expect(escape).not.toContain(room);
    const fair = level.graph.rooms.map((r) => r.id).filter((id) => (dist.get(id) ?? 0) >= 2 && !escape.includes(id));
    expect(dist.get(room)).toBe(Math.min(...fair.map((id) => dist.get(id)!)));
  });

  it('appears when the EYE is taken from FIRST_LEVEL on', () => {
    const w = playing();
    walk(w, w.level.route, () => w.phase === 'ESCAPE');
    expect(w.enemy).toBeNull();

    tuning.enemy.FIRST_LEVEL = 1;
    const w2 = playing();
    walk(w2, w2.level.route, () => w2.phase === 'ESCAPE');
    expect(w2.enemy).not.toBeNull();
    expect(w2.events).toContainEqual({ type: 'enemySpawned' });
  });

  it('winds up only in range, in sight and after the cooldown', () => {
    const w = playing(true);
    place(w, 132, 98);
    const e = hunter(w, 152, 98);
    idle(w, 1);
    expect(e.state).toBe('WINDUP');
    expect(w.events).toContainEqual({ type: 'enemyWindup' });

    const near = playing(true);
    place(near, 132, 98);
    const e2 = hunter(near, 132 + tuning.enemy.CHARGE_RANGE_MIN - 3, 98);
    idle(near, 1);
    expect(e2.state).toBe('HUNT');

    const cooling = playing(true);
    place(cooling, 132, 98);
    const e3 = hunter(cooling, 152, 98);
    e3.lastAttackTick = cooling.tick;
    idle(cooling, 1);
    expect(e3.state).toBe('HUNT');
  });

  it('locks the aim at the end of the windup: stepping aside makes it miss', () => {
    const w = playing(true);
    place(w, 132, 98);
    const e = hunter(w, 152, 98);
    idle(w, T(tuning.enemy.WINDUP_TIME) + 1);
    expect(e.state).toBe('CHARGE');
    const locked = e.yaw;
    place(w, 140, 88);
    idle(w, 6);
    const turned = Math.abs(Math.atan2(Math.sin(e.yaw - locked), Math.cos(e.yaw - locked)));
    expect(turned).toBeLessThanOrEqual(((tuning.enemy.CHARGE_TURN_RATE * Math.PI) / 180) * (7 / tuning.sim.SIM_HZ) + 1e-9);
  });

  it('is stunned by a wall, then hunts again', () => {
    const w = playing(true);
    place(w, 150, 88);
    const e = hunter(w, 140, 108);
    e.state = 'CHARGE';
    e.chargeFromX = e.x;
    e.chargeFromZ = e.z;
    e.yaw = yawTo(-1, 0); // at the room's west wall, x = 128, clear of its doorway
    let n = 0;
    while (e.state === 'CHARGE' && n++ < 120) idle(w, 1);
    expect(e.state).toBe('STUNNED');
    expect(w.events).toContainEqual({ type: 'enemyStunned' });
    idle(w, T(tuning.enemy.WALL_STUN_TIME));
    expect(e.state).toBe('HUNT');
  });

  it('recovers after CHARGE_MAX_DIST in the open', () => {
    tuning.enemy.CHARGE_MAX_DIST = 8;
    const w = playing(true);
    place(w, 150, 108);
    const e = hunter(w, 150, 98);
    e.state = 'CHARGE';
    e.chargeFromX = e.x;
    e.chargeFromZ = e.z;
    e.yaw = yawTo(-1, 0);
    let n = 0;
    while (e.state === 'CHARGE' && n++ < 120) idle(w, 1);
    expect(e.state).toBe('RECOVER');
    idle(w, T(tuning.enemy.RECOVERY_TIME));
    expect(e.state).toBe('HUNT');
  });

  it('finds a player standing still rooms away and kills them', () => {
    const w = playing();
    const c = nodeAnchor(w.level, 7);
    hunter(w, c.x, c.z);
    let n = 0;
    while (w.state === 'PLAYING' && n++ < T(40)) idle(w, 1);
    expect(w.state).toBe('DEAD');
  });

  it('a slide under a charge survives it', () => {
    const w = playing();
    place(w, 132, 98);
    const e = hunter(w, 150, 98);
    e.state = 'CHARGE';
    e.chargeFromX = e.x;
    e.chargeFromZ = e.z;
    e.yaw = yawTo(-1, 0);
    // Frozen mid-slide right in the charge's path.
    w.player.move.mode = 'slide';
    w.player.move.slideTick = Infinity;
    w.player.vx = tuning.slide.MIN_SPEED;
    tuning.slide.FRICTION = 0;
    let n = 0;
    while (e.x > 128 + tuning.enemy.RADIUS + 1 && e.state === 'CHARGE' && n++ < 120) {
      w.player.x = w.player.prevX = 132;
      w.step({ commands: [], held: { ...noButtons(), jump: true }, yaw: 0 });
    }
    expect(w.state).toBe('PLAYING');
    expect(e.x).toBeLessThan(132);
  });

  it('sees through doorways but not through walls', () => {
    const w = playing();
    const lvl = w.level;
    expect(lineOfSight(lvl.wallIndex, { x: 0, z: 0 }, { x: 50, z: 0 })).toBe(true); // START → A1 along the corridor
    expect(lineOfSight(lvl.wallIndex, { x: 0, z: 0 }, { x: 50, z: 50 })).toBe(false); // START → B1 through walls
  });
});
