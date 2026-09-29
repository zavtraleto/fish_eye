import type { Rect } from './geometry';
import type { LevelGraph } from './graph';

// Graph laid out as rectangles (GDD §8): the input of build.ts.

export interface LayoutRoom {
  id: number;
  rect: Rect;
  /** Ceiling height; render only. */
  height: number;
}

/** A straight corridor for graph edge a–b; its rectangle is derived from the rooms. */
export interface LayoutCorridor {
  a: number;
  b: number;
  width: number;
  /** Ceiling height; render only. */
  height: number;
}

export interface Layout {
  graph: LevelGraph;
  rooms: readonly LayoutRoom[];
  corridors: readonly LayoutCorridor[];
}
