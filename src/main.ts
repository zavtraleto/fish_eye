import './styles.css';
import { loadTuningOverrides, tuning } from './config/tuning';
import { InputState } from './core/input/commands';
import { attachKeyboard, attachSwipe, blockBrowserGestures } from './core/input/devices';
import { GameLoop } from './core/loop';
import { randomSeed } from './core/rng';
import type { DebugActions, DebugPanel } from './debug/debugPanel';
import { DebugOverlay } from './debug/overlay';
import { parseDebugParams } from './debug/params';
import { t } from './i18n';
import { SceneRenderer } from './render/scene';
import { World, type Cheats } from './sim/world';

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
let world = new World({ seed: params.seed ?? randomSeed(), cheats });

const input = new InputState();
attachKeyboard(input);
blockBrowserGestures();

const view = new SceneRenderer(stage);
attachSwipe(input, view.renderer.domElement);
window.addEventListener('resize', () => view.resize());

// ---------- HUD (DOM placeholder until the game has its own) ----------
const hud = document.createElement('div');
hud.className = 'hud';
ui.appendChild(hud);
let shownScore = -1;

// ---------- Debug ----------
const overlay = new DebugOverlay(ui);
let panel: DebugPanel | null = null;
let logEvents = false;
let debugOn = false;

function restart(opts: { seed?: number | 'random' }): void {
  const seed = opts.seed === 'random' ? randomSeed() : opts.seed ?? world.seed;
  world = new World({ seed, cheats });
  input.clear();
  panel?.syncSeed(seed);
}

const actions: DebugActions = {
  getSeed: () => world.seed,
  restart,
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
      world.step({ commands: input.drain(), held: input.heldDir });
      for (const e of world.events) {
        view.onEvent(e);
        if (logEvents) console.debug('[sim]', e);
      }
      world.events.length = 0;
    },
    render(alpha, frameSeconds) {
      view.render(world, world.simFrozen ? 0 : alpha, frameSeconds);
      if (world.score !== shownScore) {
        shownScore = world.score;
        hud.textContent = t('hud.score', { score: shownScore });
      }
      overlay.update(frameSeconds, {
        stats: loop.stats,
        state: world.state,
        seed: world.seed,
        tick: world.tick,
        timeScale: loop.clock.timeScale,
        paused: loop.clock.paused,
      });
    },
  },
);
loop.clock.timeScale = tuning.sim.TIME_SCALE;
overlay.visible = false;
if (params.debug) void setDebug(true);
loop.start();

// Dev-only handle for tests in the browser (CLAUDE.md → Verifying in the browser).
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
    },
  });
}
