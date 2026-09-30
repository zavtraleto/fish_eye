import { describe, expect, it } from 'vitest';
import { gridCuts } from '../src/render/levelMesh';

describe('level mesh cuts (VISUAL.md §11)', () => {
  it('cuts on the world grid so neighbours share seam vertices', () => {
    expect(gridCuts(-3.5, 3.5, 1)).toEqual([-3.5, -3, -2, -1, 0, 1, 2, 3, 3.5]);
    expect(gridCuts(37, 40, 1)).toEqual([37, 38, 39, 40]);
    // A corridor edge inside a room edge reuses the room's vertices.
    const room = gridCuts(-10, 14, 1);
    for (const v of gridCuts(-4, 4, 1)) expect(room).toContain(v);
  });

  it('never makes an empty piece', () => {
    const c = gridCuts(0.9999999, 2.0000001, 1);
    for (let i = 0; i + 1 < c.length; i++) expect(c[i + 1]! - c[i]!).toBeGreaterThan(0);
  });
});
