import type { Point, Rect, Segment } from './geometry';
import type { LevelGraph } from './graph';

/** Floor area of a room or of the corridor of graph edge a–b; `height` is its ceiling (render only). */
export type Area =
  | { kind: 'room'; room: number; rect: Rect; height: number }
  | { kind: 'corridor'; a: number; b: number; rect: Rect; height: number };

/** The openings of edge a–b: midpoints on room a's and room b's wall. */
export interface Door {
  a: number;
  b: number;
  pa: Point;
  pb: Point;
}

/** A vertical wall quad for the renderer; `start` is the white START / EXIT wall. */
export interface WallFace {
  seg: Segment;
  y0: number;
  y1: number;
  kind: 'wall' | 'start';
}

/** A built level (GDD §8): the sim uses `walls`, the renderer `areas` and `faces`. */
export interface Level {
  graph: LevelGraph;
  areas: readonly Area[];
  doors: readonly Door[];
  walls: readonly Segment[];
  faces: readonly WallFace[];
  /** The white wall: touching it in ESCAPE clears the level (GDD §10). */
  startWall: Segment;
  spawn: { x: number; z: number; yaw: number };
  eye: Point;
  /** The green line, START centre to EYE (GDD §10). */
  route: readonly Point[];
}
