import type { LoopStats } from '../core/loop';

export interface OverlayInfo {
  stats: LoopStats;
  state: string;
  seed: number;
  tick: number;
  timeScale: number;
  paused: boolean;
  extra?: string;
}

/** Stats overlay (GDD §15.3): FPS and sim state, refreshed a few times per second. */
export class DebugOverlay {
  private readonly el: HTMLElement;
  private accum = Infinity;
  private minFps = Infinity;
  private minFpsWindow = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'debug-overlay';
    parent.appendChild(this.el);
  }

  set visible(v: boolean) {
    this.el.style.display = v ? '' : 'none';
  }

  get visible(): boolean {
    return this.el.style.display !== 'none';
  }

  update(frameSeconds: number, info: OverlayInfo): void {
    if (!this.visible) return;
    if (info.stats.fps > 0) this.minFps = Math.min(this.minFps, info.stats.fps);
    this.accum += frameSeconds;
    this.minFpsWindow += frameSeconds;
    if (this.minFpsWindow > 5) {
      this.minFpsWindow = 0;
      this.minFps = Infinity;
    }
    if (this.accum < 0.25) return;
    this.accum = 0;

    const s = info.stats;
    const fpsClass = s.fps > 0 && s.fps < 55 ? 'warn' : '';
    const minFps = Number.isFinite(this.minFps) ? this.minFps.toFixed(0) : '-';
    const dpr = window.devicePixelRatio || 1;
    this.el.innerHTML =
      `<span class="${fpsClass}">FPS ${s.fps.toFixed(0)} min ${minFps}</span>` +
      ` · ${info.state}${info.paused ? ' [PAUSED]' : ''} · x${info.timeScale}\n` +
      `frame ${s.frameMs.toFixed(2)} ms  ticks/f ${s.ticksLastFrame}  tick ${info.tick}\n` +
      `seed ${info.seed}  view ${window.innerWidth}×${window.innerHeight} @${dpr.toFixed(2)}` +
      (info.extra ? `\n${info.extra}` : '');
  }
}
