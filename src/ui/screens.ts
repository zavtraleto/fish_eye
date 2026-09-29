import { secondsToTicks as T, tuning } from '../config/tuning';
import { t } from '../i18n';
import type { RunResult } from '../sim/run';
import type { World } from '../sim/world';
import { formatClock, formatCount, formatSeconds } from './format';

// DOM screens and HUD (GDD §14.3). Reads World every frame and rebuilds text
// only when it changes; one-shot effects come in through `onEvent` from main.ts.

type Line = [cls: string, text: string];

export class Screens {
  private readonly hud: HTMLElement;
  private readonly hudEscape: HTMLElement;
  private readonly hudMain: HTMLElement;
  private readonly screen: HTMLElement;
  private readonly flash: HTMLElement;
  private screenKey = '';
  private hudKey = '';
  /** Set by main.ts when a run ends. */
  newBest = false;

  constructor(
    ui: HTMLElement,
    private readonly stage: HTMLElement,
  ) {
    this.hud = div('hud');
    this.hudMain = div('hud-main');
    this.hudEscape = div('hud-escape');
    this.hudEscape.textContent = t('hud.escape');
    this.hud.append(this.hudMain, this.hudEscape);
    this.screen = div('screen');
    this.flash = div('death-flash');
    ui.append(this.flash, this.hud, this.screen);
  }

  update(world: World, best: RunResult | null): void {
    const s = world.state;
    const runTime = world.run.runTicks / tuning.sim.SIM_HZ;

    const showHud = s === 'PLAYING' || s === 'LEVEL_CLEAR' || s === 'PAUSED';
    this.hud.style.display = showHud ? '' : 'none';
    if (showHud) {
      const text = `${t('hud.eyes', { eyes: formatCount(world.run.eyesExtracted) })}   ${formatClock(runTime)}`;
      if (text !== this.hudKey) this.hudMain.textContent = this.hudKey = text;
      this.hudEscape.style.visibility = world.phase === 'ESCAPE' && s !== 'LEVEL_CLEAR' ? 'visible' : 'hidden';
    }

    this.updateDeath(world);
    this.setLines(this.linesFor(world, best, runTime));
  }

  private linesFor(world: World, best: RunResult | null, runTime: number): Line[] {
    const bestLine: Line[] = best ? [['small', t('best.line', { eyes: best.eyes, time: formatClock(best.runTime) })]] : [];
    switch (world.state) {
      case 'TITLE':
        return [['title', t('title.name')], ['prompt', t('title.start')], ...bestLine, ['small dim', t('title.controls')]];
      case 'PAUSED':
        return [['title', t('pause.title')], ['prompt', t('pause.resume')]];
      case 'LEVEL_CLEAR':
        return [
          [
            'line',
            t('clear.line', {
              eye: formatCount(world.run.eyesExtracted),
              escape: formatSeconds(world.escapeTicks / tuning.sim.SIM_HZ),
              total: formatClock(runTime),
            }),
          ],
        ];
      case 'DEAD': {
        if (world.stateTicks < T(tuning.run.DEATH_COLLAPSE_TIME)) return [];
        const lines: Line[] = [
          ['title threat', t('dead.title')],
          ['line', t('dead.eyes', { eyes: world.run.eyesExtracted })],
          ['line', t('dead.time', { time: formatClock(runTime) })],
        ];
        lines.push(this.newBest ? ['small', t('dead.newBest')] : (bestLine[0] ?? ['small', '']));
        if (world.canRestart) lines.push(['prompt', t('dead.restart')]);
        return lines;
      }
      default:
        return [];
    }
  }

  /** Red-white flash, then the picture collapses to a line (GDD §14.3). */
  private updateDeath(world: World): void {
    if (world.state !== 'DEAD') {
      this.stage.style.transform = '';
      this.flash.style.opacity = '0';
      return;
    }
    const collapse = Math.max(1, T(tuning.run.DEATH_COLLAPSE_TIME));
    const k = Math.min(1, world.stateTicks / collapse);
    this.stage.style.transform = `scaleY(${Math.max(0.003, 1 - k * k)})`;
    this.flash.style.opacity = String(Math.max(0, 1 - k * 3));
  }

  private setLines(lines: Line[]): void {
    const key = JSON.stringify(lines);
    if (key === this.screenKey) return;
    this.screenKey = key;
    this.screen.replaceChildren(
      ...lines.map(([cls, text]) => {
        const e = div(cls);
        e.textContent = text;
        return e;
      }),
    );
    this.screen.style.display = lines.length ? '' : 'none';
  }
}

function div(cls: string): HTMLElement {
  const e = document.createElement('div');
  e.className = cls;
  return e;
}
