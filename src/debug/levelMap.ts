import { Rng } from '../core/rng';
import { levelStructure } from '../data/difficulty';
import { generateStructure, type StructureGraph } from '../sim/level/gen/structure';

// Top-down debug map of the level structure (GDD §7, §15.3): anchor points,
// candidate passages, the graph, the big loop, the green line, START and the
// heart, and the graph's metrics. Pages through levels and seeds.

const SIZE = 560;
const PAD = 24;

export class LevelMap {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly title: HTMLSpanElement;
  private readonly info: HTMLPreElement;
  private seed = 1;
  private level = 1;

  constructor(parent: HTMLElement) {
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

  /** The structure level `level` of run `seed` gets (GDD §15.2). */
  show(seed: number, level: number): void {
    this.seed = seed >>> 0;
    this.level = level;
    const t0 = performance.now();
    const g = generateStructure(new Rng(this.seed).fork(`level:${level}`), levelStructure(level));
    const ms = performance.now() - t0;
    this.title.textContent = ` L${level} · seed ${this.seed} `;
    const m = g.metrics;
    this.info.textContent =
      `nodes ${m.nodes}  edges ${m.edges}  cycles ${m.cycles}  bridges ${m.bridges}\n` +
      `junctions ${(m.junctions * 100).toFixed(0)}%  routes ${m.routes}  heart ${m.heartDist} steps\n` +
      `attempts ${g.attempts}  relaxed ${g.relaxed}  ${ms.toFixed(1)} ms`;
    this.draw(g);
  }

  private draw(g: StructureGraph): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.fillStyle = '#0b0c10';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const xs = g.points.map((p) => p.x);
    const zs = g.points.map((p) => p.z);
    const minX = Math.min(...xs);
    const minZ = Math.min(...zs);
    const span = Math.max(Math.max(...xs) - minX, Math.max(...zs) - minZ, 1);
    const k = (SIZE - 2 * PAD) / span;
    // North up: z grows upward on the map.
    const at = (i: number) => [PAD + (g.points[i]!.x - minX) * k, SIZE - PAD - (g.points[i]!.z - minZ) * k] as const;
    const line = (a: number, b: number, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(...at(a));
      ctx.lineTo(...at(b));
      ctx.stroke();
    };
    const dot = (i: number, r: number, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(...at(i), r, 0, Math.PI * 2);
      ctx.fill();
    };

    for (const e of g.candidates) line(e.a, e.b, '#1f2230', 1);
    for (const e of g.edges) line(e.a, e.b, '#6b7080', 3);
    for (let i = 0; i < g.loop.length; i++) line(g.loop[i]!, g.loop[(i + 1) % g.loop.length]!, '#a9aebb', 3);
    for (let i = 0; i + 1 < g.route.length; i++) line(g.route[i]!, g.route[i + 1]!, '#3dff6e', 2);
    g.points.forEach((_, i) => dot(i, 2, '#2c3040'));
    for (const n of g.nodes) dot(n, 6, '#8a8f9e');
    dot(g.start, 9, '#f4f4ec');
    dot(g.heart, 9, '#3dff6e');
  }
}
