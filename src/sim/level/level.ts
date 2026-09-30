import type { Point, Segment } from './geometry';
import type { LevelGraph } from './graph';
import type { NavGrid } from './nav';
import type { GridFrame } from './raster';
import type { SegmentIndex } from './wallIndex';

/** Skeleton module of a zone (GDD §6). */
export type ModuleKind = 'start' | 'heart' | 'hall' | 'gallery' | 'throat' | 'honeycomb' | 'colonnade' | 'rotunda';

/** What a zone stands for in the graph: a node (a space) or an edge (a gallery, a throat). */
export type ZoneRef = { kind: 'node'; node: number } | { kind: 'edge'; a: number; b: number };

/** One space or passage of any shape (GDD §8). */
export interface Zone {
  id: number;
  ref: ZoneRef;
  module: ModuleKind;
  /** A point deep inside: route and spawn anchor. */
  anchor: Point;
  /** Ceiling; render only. */
  height: number;
}

/** Where zones a and b meet: the ends and the middle of their shared boundary. */
export interface Portal {
  a: number;
  b: number;
  p0: Point;
  p1: Point;
  mid: Point;
}

/** A vertical wall quad for the renderer; `start` is the white START / EXIT wall. */
export interface WallFace {
  seg: Segment;
  y0: number;
  y1: number;
  kind: 'wall' | 'start';
  /** Unit normal toward the open side, for shading. */
  nx: number;
  nz: number;
}

/** The free part of a raster cell and its zone: a floor and ceiling piece (render). */
export interface FloorPiece {
  points: readonly Point[];
  zone: number;
}

/** A built level (GDD §8): the sim uses zones, walls and nav, the renderer floor and faces. */
export interface Level {
  graph: LevelGraph;
  zones: readonly Zone[];
  portals: readonly Portal[];
  /** The zone raster: `cellZone[c]` is the zone of cell c, -1 where the cell is rock. */
  frame: GridFrame;
  cellZone: Int16Array;
  walls: readonly Segment[];
  /** `walls` in buckets, for collision and sight. */
  wallIndex: SegmentIndex;
  faces: readonly WallFace[];
  floor: readonly FloorPiece[];
  /** Flesh density per node of `frame` (0 bare … 1 flesh), for the renderer's tint; null without flesh. */
  density: Float32Array | null;
  /** Openings the flesh ate through walls, off the graph (GDD §6). */
  extraOpenings: number;
  nav: NavGrid;
  /** The white wall: touching it in ESCAPE clears the level (GDD §10). */
  startWall: Segment;
  spawn: { x: number; z: number; yaw: number };
  eye: Point;
  /** The green line, START to EYE (GDD §10). */
  route: readonly Point[];
}
