// Projection math (GDD §4). Pure: the GLSL in fisheyeShader.ts mirrors these
// formulas, the tests check them here.

export type FisheyeMapping = 'equidistant' | 'stereographic';

export const DEG = Math.PI / 180;

/**
 * Image radius of a ray `theta` off the view axis, where 1 is the left/right
 * edge of the screen, which sits at `halfFov`.
 */
export function fisheyeRadius(theta: number, halfFov: number, mapping: FisheyeMapping): number {
  return mapping === 'stereographic' ? Math.tan(theta / 2) / Math.tan(halfFov / 2) : theta / halfFov;
}

export function parseMapping(value: string): FisheyeMapping {
  return value === 'equidistant' ? 'equidistant' : 'stereographic';
}
