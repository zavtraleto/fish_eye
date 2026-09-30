import { describe, expect, it } from 'vitest';
import { NavField, type NavGrid } from '../src/sim/level/nav';
import { cellAt, cellCenter } from '../src/sim/level/raster';

/** A nav grid from a picture: '#' rock, '.' open (clearance 2), ',' narrow (clearance 0.5). Row 0 is z = 0. */
function grid(rows: string[]): NavGrid {
  const h = rows.length;
  const w = rows[0]!.length;
  const clearance = new Float32Array(w * h);
  rows.forEach((row, j) => [...row].forEach((ch, i) => (clearance[j * w + i] = ch === '.' ? 2 : ch === ',' ? 0.5 : 0)));
  return { frame: { x0: 0, z0: 0, cell: 1, w, h }, clearance };
}

const U = ['#########', '#.......#', '#.#####.#', '#.#####.#', '#.#####.#', '#########'];

describe('nav field (GDD §11.1)', () => {
  it('walks downhill around the U to the goal', () => {
    const g = grid(U);
    const nav = new NavField(g);
    nav.build(1.5, 4.5, 7.5, 4.5, 1);
    const path = nav.descend(7.5, 4.5, 100);
    expect(path[0]).toBe(cellAt(g.frame, 7.5, 4.5));
    expect(path.at(-1)).toBe(cellAt(g.frame, 1.5, 4.5));
    for (const c of path) expect(g.clearance[c]).toBeGreaterThan(0);
    for (let k = 1; k < path.length; k++) expect(nav.stepsAt(path[k]!)).toBeLessThan(nav.stepsAt(path[k - 1]!));
  });

  it('keeps out of cells too narrow for the body, except next to the goal', () => {
    // The narrow cell (5, 1) is four steps from the goal: beyond GOAL_SLACK.
    const g = grid(['#########', '#....,..#', '#.#####.#', '#.......#', '#########']);
    const nav = new NavField(g);
    nav.build(1.5, 1.5, 7.5, 1.5, 1);
    const path = nav.descend(7.5, 1.5, 100);
    expect(path.at(-1)).toBe(cellAt(g.frame, 1.5, 1.5));
    expect(path).not.toContain(cellAt(g.frame, 5.5, 1.5)); // goes round through row 3
    const near = new NavField(g);
    near.build(5.5, 1.5, 7.5, 1.5, 1); // the goal itself is narrow
    expect(near.stepsAt(cellAt(g.frame, 5.5, 1.5))).toBe(0);
    expect(near.stepsAt(cellAt(g.frame, 7.5, 1.5))).toBe(2);
  });

  it('does not cut corners diagonally between rock', () => {
    const g = grid(['####', '#.##', '##.#', '####']);
    const nav = new NavField(g);
    nav.build(1.5, 1.5, 2.5, 2.5, 1);
    expect(nav.stepsAt(cellAt(g.frame, 2.5, 2.5))).toBe(-1);
  });

  it('stops soon after reaching the enemy', () => {
    const row = '#' + '.'.repeat(60) + '#';
    const g = grid(['#'.repeat(62), row, '#'.repeat(62)]);
    const nav = new NavField(g);
    nav.build(1.5, 1.5, 10.5, 1.5, 1);
    expect(nav.stepsAt(cellAt(g.frame, 10.5, 1.5))).toBe(9);
    expect(nav.stepsAt(cellAt(g.frame, 40.5, 1.5))).toBe(-1);
  });

  it('gives an empty path from a cell it never reached', () => {
    const g = grid(U);
    const nav = new NavField(g);
    nav.build(1.5, 4.5, 1.5, 3.5, 1);
    expect(nav.descend(7.5, 4.5, 10)).toEqual([]);
    expect(cellCenter(g.frame, nav.goal)).toEqual({ x: 1.5, z: 4.5 });
  });
});
