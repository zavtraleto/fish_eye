import { tuning } from '../../../config/tuning';
import { Rng } from '../../../core/rng';
import { levelStructure } from '../../../data/difficulty';
import { buildLevel } from '../build';
import { fixedLevel } from '../fixed';
import type { Level } from '../level';
import { skeletonDef } from './skeleton';
import { generateStructure, type StructureGraph } from './structure';

// Level N of a run (GDD §7): structure graph → skeleton shapes → built level.
// A geometry the build rejects (a passage the graph does not have, a broken
// white wall) is simply tried again; generation never hangs.

export interface GeneratedLevel {
  level: Level;
  /** Null when every try failed and the test level stood in. */
  structure: StructureGraph | null;
  tries: number;
}

export function generateLevel(seed: number, n: number): GeneratedLevel {
  const rng = new Rng(seed).fork(`level:${n}`);
  for (let tries = 1; tries <= tuning.gen.LEVEL_TRIES; tries++) {
    const structure = generateStructure(rng, levelStructure(n));
    try {
      return { level: buildLevel(skeletonDef(rng, structure)), structure, tries };
    } catch {
      // Rejected geometry: the next try draws a new structure from the same stream.
    }
  }
  return { level: buildLevel(fixedLevel()), structure: null, tries: tuning.gen.LEVEL_TRIES };
}
