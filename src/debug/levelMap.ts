import { generateLevel } from '../sim/level/gen/generate';
import type { StructureGraph } from '../sim/level/gen/structure';
import type { Level, ModuleKind } from '../sim/level/level';

// Top-down debug map of a generated level (GDD §7, §15.3): zones by module,
// walls, anchor points, candidate passages, the graph, the green line, START
// and the heart, and the graph's metrics. Pages through levels and seeds;
// "play" restarts the run there.

const SIZE = 560;
const PAD = 24;

/** Dim module tints; the signal colours stay for START, the heart and the route (VISUAL.md §1). */
const MODULE_RGB: Record<ModuleKind, [number, number, number]> = {
  start: [90, 90, 84],
  heart: [34, 70, 44],
  hall: [48, 52, 64],
  gallery: [36, 40, 52],
  throat: [66, 50, 40],
  honeycomb: [60, 48, 66],
  colonnade: [44, 58, 66],
  rotunda: [58, 58, 40],
};

export class LevelMap {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly title: HTMLSpanElement;
  private readonly info: HTMLPreElement;
  private seed = 1;
  private level = 1;

  constructor(
    parent: HTMLElement,
    private readonly onPlay: (seed: number, level: number) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'level-map';
    const bar = document.createElement('div');
    bar.className = 'level-map-bar';
    this.title = document.createElement('span');
    const button = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        fn();
      });
      return b;
    };
    bar.append(
      button('◀', () => this.show(this.seed, Math.max(1, this.level - 1))),
      this.title,
      button('▶', () => this.show(this.seed, this.level + 1)),
      button('seed+1', () => this.show(this.seed + 1, this.level)),
      button('play', () => this.onPlay(this.seed, this.level)),
      button('×', () => (this.visible = false)),
    );
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.info = document.createElement('pre');
    this.root.append(bar, this.canvas, this.info);
    parent.appendChild(this.root);
    this.visible = false;
  }

  set visible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  /** The level `level` of run `seed` gets (GDD §15.2). */
  show(seed: number, level: number): void {
    this.seed = seed >>> 0;
    this.level = level;
    const t0 = performance.now();
    const { level: lvl, structure: g, tries } = generateLevel(this.seed, level);
    const ms = performance.now() - t0;
    this.title.textContent = ` L${level} · seed ${this.seed} `;
    if (!g) {
      this.info.textContent = `every try failed: the test level stands in (${ms.toFixed(0)} ms)`;
      return;
    }
    const m = g.metrics;
    this.info.textContent = [
      `nodes ${m.nodes}  edges ${m.edges}  cycles ${m.cycles}  bridges ${m.bridges}`,
      `junctions ${(m.junctions * 100).toFixed(0)}%  routes ${m.routes}  heart ${m.heartDist} steps`,
      `graph attempts ${g.attempts}  relaxed ${g.relaxed}  level tries ${tries}  ${lvl.walls.length} walls  ${ms.toFixed(0)} ms`,
    ].join('\n');
    this.draw(g, lvl);
  }

  private draw(g: StructureGraph, lvl: Level): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.fillStyle = '#0b0c10';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const f = lvl.frame;
    const xs = [...g.points.map((p) => p.x), f.x0, f.x0 + f.w * f.cell];
    const zs = [...g.points.map((p) => p.z), f.z0, f.z0 + f.h * f.cell];
    const minX = Math.min(...xs);
    const minZ = Math.min(...zs);
    const span = Math.max(Math.max(...xs) - minX, Math.max(...zs) - minZ, 1);
    const k = (SIZE - 2 * PAD) / span;
    // North up: z grows upward on the map.
    const toX = (x: number) => PAD + (x - minX) * k;
    const toY = (z: number) => SIZE - PAD - (z - minZ) * k;
    const at = (i: number) => [toX(g.points[i]!.x), toY(g.points[i]!.z)] as const;
    const dot = (i: number, r: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(...at(i), r, 0, Math.PI * 2);
      ctx.fill();
    };
    const stroke = (color: string, width: number, draw: () => void) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      draw();
      ctx.stroke();
    };

    // Zones by module, one pixel per raster cell, flipped to north up.
    const img = new ImageData(f.w, f.h);
    for (let c = 0; c < lvl.cellZone.length; c++) {
      const z = lvl.cellZone[c]!;
      if (z < 0) continue;
      const [r, gr, b] = MODULE_RGB[lvl.zones[z]!.module];
      const i = c % f.w;
      const j = f.h - 1 - (c - i) / f.w;
      img.data.set([r, gr, b, 255], (j * f.w + i) * 4);
    }
    const raster = document.createElement('canvas');
    raster.width = f.w;
    raster.height = f.h;
    raster.getContext('2d')!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(raster, toX(f.x0), toY(f.z0 + f.h * f.cell), f.w * f.cell * k, f.h * f.cell * k);

    stroke('#1a1c26', 1, () => {
      for (const e of g.candidates) {
        ctx.moveTo(...at(e.a));
        ctx.lineTo(...at(e.b));
      }
    });
    g.points.forEach((_, i) => dot(i, 2, '#2c3040'));
    stroke('#8a90a0', 1, () => {
      for (const w of lvl.walls) {
        ctx.moveTo(toX(w.ax), toY(w.az));
        ctx.lineTo(toX(w.bx), toY(w.bz));
      }
    });
    stroke('#f4f4ec', 3, () => {
      ctx.moveTo(toX(lvl.startWall.ax), toY(lvl.startWall.az));
      ctx.lineTo(toX(lvl.startWall.bx), toY(lvl.startWall.bz));
    });
    // The green line as the player sees it.
    stroke('#3dff6e', 2, () => lvl.route.forEach((p, i) => (i ? ctx.lineTo(toX(p.x), toY(p.z)) : ctx.moveTo(toX(p.x), toY(p.z)))));
    dot(g.start, 5, '#f4f4ec');
    dot(g.heart, 5, '#3dff6e');
  }
}
