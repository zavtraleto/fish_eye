import type { BindingApi } from '@tweakpane/core';
import { Pane, type FolderApi, type TabPageApi } from 'tweakpane';
import { DEFAULT_TUNING, resetTuning, saveTuningOverrides, tuning } from '../config/tuning';
import type { FixedStepClock } from '../core/loop';
import type { Cheats } from '../sim/world';
import {
  TUNE_LAYOUT,
  changedValues,
  formatChanges,
  layoutGroups,
  matchesFilter,
  resetGroups,
  sliderRange,
  stringOptions,
  tuningControlKind,
  type GroupKey,
  type TuneFolder,
} from './tuningLayout';

export interface DebugActions {
  getSeed(): number;
  /** Omitted seed keeps the current one; 'random' rolls a new seed. */
  restart(opts: { seed?: number | 'random' }): void;
  /** Ends the run as if the enemy touched the player. */
  kill(): void;
  /** Teleports the player next to the EYE. */
  toEye(): void;
  setOverlayVisible(v: boolean): void;
  setLogEvents(v: boolean): void;
  cheats: Cheats;
}

/** Folder expansion, panel expansion and the selected tab survive reloads. */
const UI_STORAGE_KEY = 'fisheye.debug.ui.v1';

interface UiState {
  folds: Record<string, boolean>;
  expanded: boolean;
  tab: number;
}

function loadUi(): UiState {
  const fallback: UiState = { folds: {}, expanded: window.innerWidth >= 600, tab: 0 };
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<UiState>) } : fallback;
  } catch {
    return fallback;
  }
}

type Groups = Record<string, Record<string, number | boolean | string>>;

interface Entry {
  group: GroupKey;
  key: string;
  title: string;
  binding: BindingApi;
  folders: readonly FolderNode[];
}

interface FolderNode {
  path: string;
  api: FolderApi;
}

/** Tweakpane debug panel (GDD §15.3): Tune (every tunable, live and persisted) and Tools. */
export class DebugPanel {
  private readonly root: HTMLElement;
  private readonly pane: Pane;
  private readonly ui = loadUi();
  private readonly entries: Entry[] = [];
  private readonly folders: FolderNode[] = [];
  private readonly filterInput: HTMLInputElement;
  private readonly changedButton: HTMLButtonElement;
  private readonly copyButton: HTMLButtonElement;
  private onlyChanged = false;
  /** Folder expansion is being set by the panel, not the user: do not remember it. */
  private folding = false;
  private readonly state = { seed: 0, timeScale: 1, paused: false, showOverlay: true, logEvents: false };

  constructor(private clock: FixedStepClock, private actions: DebugActions) {
    this.root = document.createElement('div');
    this.root.className = 'debug-panel';
    document.body.appendChild(this.root);
    this.pane = new Pane({ container: this.root, title: 'Debug', expanded: this.ui.expanded });
    this.pane.on('fold', (ev) => {
      if (ev.target !== (this.pane as unknown)) return;
      this.ui.expanded = ev.expanded;
      this.saveUi();
    });

    const bar = document.createElement('div');
    bar.className = 'debug-panel-bar';
    this.filterInput = document.createElement('input');
    this.filterInput.type = 'search';
    this.filterInput.placeholder = 'filter';
    this.filterInput.addEventListener('input', () => this.refreshVisibility());
    this.changedButton = this.barButton('changed', () => {
      this.onlyChanged = !this.onlyChanged;
      this.refreshVisibility();
    });
    this.copyButton = this.barButton('copy', () => this.copyChanges());
    const reset = this.barButton('reset all', () => this.resetAll());
    bar.append(this.filterInput, this.changedButton, this.copyButton, reset);

    this.state.seed = actions.getSeed();
    this.state.timeScale = tuning.sim.TIME_SCALE;
    const tab = this.pane.addTab({ pages: [{ title: 'Tune' }, { title: 'Tools' }] });
    const initial = Math.min(1, Math.max(0, this.ui.tab));
    tab.pages[initial]!.selected = true;
    // The filter bar only serves the Tune tab.
    const showBar = (index: number) => (bar.style.display = index === 0 ? '' : 'none');
    tab.on('select', (ev) => {
      this.ui.tab = ev.index;
      showBar(ev.index);
      this.saveUi();
    });
    for (const f of TUNE_LAYOUT) this.buildTune(tab.pages[0]!, f, []);
    this.buildTools(tab.pages[1]!);
    // After the blades: Tweakpane inserts its own blades at the start of the content.
    (this.pane.element.querySelector('.tp-rotv_c') ?? this.pane.element).prepend(bar);
    showBar(initial);
    this.refreshVisibility();
  }

  set visible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  /** Re-reads bound values changed outside the panel. */
  refresh(): void {
    this.pane.refresh();
    this.refreshVisibility();
  }

  syncSeed(seed: number): void {
    this.state.seed = seed;
    this.pane.refresh();
  }

  // ---------- Tune ----------

  private addFolder(parent: FolderApi | TabPageApi, title: string, parentPath: string): FolderNode {
    const path = parentPath ? `${parentPath}/${title}` : title;
    const api = parent.addFolder({ title, expanded: this.ui.folds[path] ?? false });
    const node = { path, api };
    api.on('fold', (ev) => {
      if (ev.target !== api || this.folding) return;
      this.ui.folds[path] = ev.expanded;
      this.saveUi();
    });
    this.folders.push(node);
    return node;
  }

  private buildTune(parent: FolderApi | TabPageApi, folder: TuneFolder, trail: readonly FolderNode[]): void {
    const node = this.addFolder(parent, folder.title, trail.at(-1)?.path ?? '');
    const chain = [...trail, node];
    const groups = layoutGroups([folder]);
    node.api.addButton({ title: `reset ${folder.title}` }).on('click', () => this.resetFolder(groups));
    for (const group of folder.groups ?? []) this.bindGroup(node.api, group, folder.title, chain);
    for (const child of folder.children ?? []) this.buildTune(node.api, child, chain);
  }

  private bindGroup(folder: FolderApi, group: GroupKey, title: string, chain: readonly FolderNode[]): void {
    const values = (tuning as unknown as Groups)[group]!;
    const defaults = (DEFAULT_TUNING as unknown as Groups)[group]!;
    for (const key of Object.keys(defaults)) {
      const def = defaults[key]!;
      const kind = tuningControlKind(def);
      let binding: BindingApi;
      if (kind === 'number') {
        const [min, max, step] = sliderRange(key, def as number);
        binding = folder.addBinding(values, key, { min, max, step });
      } else if (kind === 'color') {
        binding = folder.addBinding(values, key, { view: 'color' });
      } else if (kind === 'string' && stringOptions(key)) {
        const options = Object.fromEntries(stringOptions(key)!.map((o) => [o, o]));
        binding = folder.addBinding(values, key, { options });
      } else {
        binding = folder.addBinding(values, key);
      }
      binding.on('change', (ev) => {
        if (!ev.last) return;
        this.applyClock(key);
        saveTuningOverrides();
        this.refreshVisibility();
      });
      this.entries.push({ group, key, title, binding, folders: chain });
    }
  }

  private applyClock(key?: string): void {
    if (!key || key === 'TIME_SCALE') {
      this.clock.timeScale = tuning.sim.TIME_SCALE;
      this.state.timeScale = tuning.sim.TIME_SCALE;
    }
    if (!key || key === 'SIM_HZ') this.clock.options.hz = tuning.sim.SIM_HZ;
    if (!key || key === 'MAX_FRAME_TIME') this.clock.options.maxFrameTime = tuning.sim.MAX_FRAME_TIME;
  }

  /** Filter and "changed only" hide bindings and empty folders; changed values are marked. */
  private refreshVisibility(): void {
    const query = this.filterInput.value.trim();
    const narrowing = query !== '' || this.onlyChanged;
    const changed = new Set(changedValues(tuning, DEFAULT_TUNING).map((c) => `${c.group}.${c.key}`));
    const shown = new Set<FolderNode>();
    for (const e of this.entries) {
      const isChanged = changed.has(`${e.group}.${e.key}`);
      e.binding.element.classList.toggle('debug-changed', isChanged);
      const visible = matchesFilter(query, e.group, e.key, e.title) && (!this.onlyChanged || isChanged);
      e.binding.hidden = !visible;
      if (visible) for (const f of e.folders) shown.add(f);
    }
    this.folding = true;
    for (const f of this.folders) {
      if (f.path.startsWith('Tools')) continue;
      f.api.hidden = narrowing && !shown.has(f);
      f.api.expanded = narrowing ? shown.has(f) : this.ui.folds[f.path] ?? false;
    }
    this.folding = false;
    this.changedButton.classList.toggle('on', this.onlyChanged);
    this.changedButton.textContent = `changed ${changed.size}`;
  }

  private resetFolder(groups: readonly GroupKey[]): void {
    resetGroups(tuning, DEFAULT_TUNING, groups);
    saveTuningOverrides();
    this.afterReset();
  }

  private resetAll(): void {
    resetTuning();
    this.afterReset();
  }

  private afterReset(): void {
    this.applyClock();
    this.pane.refresh();
    this.refreshVisibility();
  }

  private copyChanges(): void {
    const changes = changedValues(tuning, DEFAULT_TUNING);
    const text = formatChanges(changes);
    console.info('[tuning]\n' + text);
    navigator.clipboard?.writeText(text).catch(() => undefined);
    this.copyButton.textContent = `copied ${changes.length}`;
    setTimeout(() => (this.copyButton.textContent = 'copy'), 1200);
  }

  private barButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  private saveUi(): void {
    try {
      localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(this.ui));
    } catch {
      // storage unavailable
    }
  }

  // ---------- Tools ----------

  private buildTools(page: TabPageApi): void {
    const s = this.state;
    const a = this.actions;
    const folder = (title: string) => this.addFolder(page, title, 'Tools').api;

    const f = folder('Session');
    f.addBinding(s, 'seed', { step: 1 });
    f.addButton({ title: 'restart with seed' }).on('click', () => a.restart({ seed: s.seed >>> 0 }));
    f.addButton({ title: 'restart random seed' }).on('click', () => a.restart({ seed: 'random' }));
    f.addButton({ title: 'restart' }).on('click', () => a.restart({}));
    f.addButton({ title: 'copy repro link' }).on('click', () => this.copyLink());

    const tf = folder('Time');
    tf.addBinding(s, 'timeScale', { label: 'time scale', options: { '0.25×': 0.25, '0.5×': 0.5, '1×': 1, '2×': 2 } })
      .on('change', (ev) => {
        tuning.sim.TIME_SCALE = ev.value;
        this.clock.timeScale = ev.value;
        saveTuningOverrides();
        this.pane.refresh();
        this.refreshVisibility();
      });
    tf.addBinding(s, 'paused', { label: 'pause sim' }).on('change', (ev) => (this.clock.paused = ev.value));
    tf.addButton({ title: 'step 1 tick' }).on('click', () => this.clock.stepOnce(1));
    tf.addButton({ title: 'step 1 second' }).on('click', () => this.clock.stepOnce(tuning.sim.SIM_HZ));

    const vf = folder('View');
    vf.addBinding(s, 'showOverlay', { label: 'stats overlay' }).on('change', (ev) => a.setOverlayVisible(ev.value));
    vf.addBinding(s, 'logEvents', { label: 'log events' }).on('change', (ev) => a.setLogEvents(ev.value));

    const cf = folder('Cheats');
    cf.addBinding(a.cheats, 'god', { label: 'god mode' });
    cf.addButton({ title: 'teleport to EYE' }).on('click', () => a.toEye());
    cf.addButton({ title: 'kill player' }).on('click', () => a.kill());
  }

  private copyLink(): void {
    const url = new URL(window.location.href);
    url.searchParams.set('debug', '1');
    url.searchParams.set('seed', String(this.state.seed));
    const link = url.toString();
    console.info('[repro]', link);
    navigator.clipboard?.writeText(link).catch(() => undefined);
  }
}
