import './styles.css';
import { version } from '../package.json';
import { loadTuningOverrides, tuning } from './config/tuning';
import { InputState } from './core/input/commands';
import { attachKeyboard, attachMouseLook } from './core/input/devices';
import { GameLoop } from './core/loop';
import { randomSeed } from './core/rng';
import { Sfx } from './audio/sfx';
import type { DebugActions, DebugPanel } from './debug/debugPanel';
import { DebugOverlay } from './debug/overlay';
import { parseDebugParams } from './debug/params';
import { SceneRenderer } from './render/scene';
import type { RunResult } from './sim/run';
import { World, type Cheats } from './sim/world';
import { loadBest, saveIfBest } from './ui/best';
import { Screens } from './ui/screens';

function byId(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e;
}

loadTuningOverrides();
const params = parseDebugParams(window.location.search);
if (params.timescale !== 1) tuning.sim.TIME_SCALE = params.timescale;

const stage = byId('stage');
const ui = byId('ui');

const cheats: Cheats = { god: params.god };
/** Every run gets a new seed; `?seed=` pins it for debugging (GDD §14.2). */
const nextSeed = () => params.seed ?? randomSeed();
let world = new World({ seed: nextSeed(), cheats });

const input = new InputState();
input.look.yaw = world.level.spawn.yaw;
attachKeyboard(input);

const view = new SceneRenderer(stage);
const sfx = new Sfx();
view.renderer.domElement.addEventListener('pointerdown', () => sfx.unlock());
attachMouseLook(input, view.renderer.domElement);

const screens = new Screens(ui, stage);
let best = loadBest();

// ---------- Debug ----------
const overlay = new DebugOverlay(ui);
let panel: DebugPanel | null = null;
let logEvents = false;
let debugOn = false;

function restart(opts: { seed?: number | 'random' } = {}): void {
  const seed = opts.seed === 'random' ? randomSeed() : opts.seed ?? world.seed;
  world = new World({ seed, cheats, startState: 'PLAYING' });
  input.clear();
  input.look.yaw = world.level.spawn.yaw;
  input.look.pitch = 0;
  screens.newBest = false;
  panel?.syncSeed(seed);
}

/** Keeps the view direction of the new level's spawn. */
function onLevelStarted(): void {
  input.look.yaw = world.level.spawn.yaw;
  input.look.pitch = 0;
}

function onDied(): void {
  const result: RunResult = { seed: world.seed, eyes: world.run.eyesExtracted, runTime: world.run.runTicks / tuning.sim.SIM_HZ, version };
  screens.newBest = saveIfBest(result);
  if (screens.newBest) best = result;
}

const actions: DebugActions = {
  getSeed: () => world.seed,
  restart,
  kill: () => world.kill(),
  toEye: () => {
    const p = world.player;
    p.x = p.prevX = world.level.eye.x;
    p.z = p.prevZ = world.level.eye.z + 1;
  },
  setOverlayVisible: (v) => (overlay.visible = v),
  setLogEvents: (v) => (logEvents = v),
  cheats,
};

/** The panel is lazy-loaded so Tweakpane stays out of the main chunk. */
async function setDebug(on: boolean): Promise<void> {
  debugOn = on;
  overlay.visible = on;
  if (on && !panel) {
    const { DebugPanel } = await import('./debug/debugPanel');
    panel = new DebugPanel(loop.clock, actions);
  }
  if (panel) panel.visible = debugOn;
}

const toggle = document.createElement('button');
toggle.className = 'debug-toggle';
toggle.type = 'button';
toggle.textContent = 'DBG';
toggle.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  void setDebug(!debugOn);
});
ui.appendChild(toggle);

// ---------- Loop ----------
const loop = new GameLoop(
  { hz: tuning.sim.SIM_HZ, maxFrameTime: tuning.sim.MAX_FRAME_TIME },
  {
    tick() {
      world.step({ commands: input.drain(), held: input.held, yaw: input.look.yaw });
      const events = world.events.splice(0);
      for (const e of events) {
        if (logEvents) console.debug('[sim]', e);
        sfx.onEvent(e);
        if (e.type === 'levelStarted') onLevelStarted();
        else if (e.type === 'died') onDied();
        else if (e.type === 'restartRequested') restart({ seed: nextSeed() });
      }
    },
    render(alpha, frameSeconds) {
      view.render(world, input.look, world.simFrozen ? 0 : alpha, frameSeconds);
      screens.update(world, best);
      const p = world.player;
      overlay.update(frameSeconds, {
        stats: loop.stats,
        state: `${world.state} ${world.phase} L${world.levelNumber}`,
        seed: world.seed,
        tick: world.tick,
        timeScale: loop.clock.timeScale,
        paused: loop.clock.paused,
        extra:
          `canvas ${view.renderer.domElement.width}×${view.renderer.domElement.height}\n` +
          `pos ${p.x.toFixed(2)} ${p.z.toFixed(2)}  speed ${Math.hypot(p.vx, p.vz).toFixed(2)}`,
      });
    },
  },
);
loop.clock.timeScale = tuning.sim.TIME_SCALE;
overlay.visible = false;
if (params.debug) void setDebug(true);
loop.start();

// Dev-only handle for tests in the browser (CLAUDE.md → Verifying in the browser).
// Without Pointer Lock, drive `input.held`, `input.look` and `input.push()` directly.
if (import.meta.env.DEV) {
  Object.assign(window, {
    __game: {
      get world() {
        return world;
      },
      input,
      loop,
      view,
      tuning,
      cheats,
      restart,
      actions,
    },
  });
}
