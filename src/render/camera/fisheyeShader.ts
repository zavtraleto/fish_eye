import type * as THREE from 'three';

// GLSL for the vertex fisheye (GDD §4); formulas mirror fisheyeMath.ts.
// Every world material is patched once and shares these uniforms.

/** The projection writes them each frame. */
export const fisheyeUniforms = {
  uHalfFov: { value: Math.PI / 2 },
  uStereo: { value: 1 },
  uAspect: { value: 1 },
  uNear: { value: 0.05 },
  uFar: { value: 60 },
  /** Drawing buffer size, pixels. */
  uViewport: { value: { x: 1, y: 1 } },
};

/**
 * Fog distance multiplier of signal materials (enemy, white START wall): below
 * 1 they fade over a longer range (GDD §10, §11). The scene writes it.
 */
export const signalFogScale = { value: 1 };
const worldFogScale = { value: 1 };

const SHARED = /* glsl */ `
uniform float uHalfFov;
uniform float uStereo;
uniform float uAspect;
varying vec3 vFishDir;
`;

const VERTEX_HEAD = /* glsl */ `
${SHARED}
uniform float uNear;
uniform float uFar;
uniform float uFogScale;
// Image radius for a ray theta off the axis (1 = horizontal screen edge).
float fisheyeRadius(float theta, float halfFov, float stereo) {
  return stereo > 0.5 ? tan(theta * 0.5) / tan(halfFov * 0.5) : theta / halfFov;
}
// Direct fisheye projection of a view-space point. Depth is linear in distance.
vec4 fisheyeProject(vec3 p) {
  float len = max(length(p), 1e-6);
  float theta = acos(clamp(-p.z / len, -1.0, 1.0));
  float dl = length(p.xy);
  vec2 dir = dl > 1e-6 ? p.xy / dl : vec2(0.0);
  float r = fisheyeRadius(min(theta, 3.1), uHalfFov, uStereo);
  float z = (len - uNear) / (uFar - uNear) * 2.0 - 1.0;
  // Far outside the image: past the far plane, so triangles that wrap behind the viewer get clipped.
  if (theta > uHalfFov + 0.5) z = 2.0;
  return vec4(dir.x * r, dir.y * r * uAspect, z, 1.0);
}
`;

const FRAGMENT_HEAD = /* glsl */ `
${SHARED}
uniform vec2 uViewport;
// A triangle whose corners straddle the view's back projects across the whole
// image. Its surface direction then points far from the pixel's own direction:
// drop such fragments. Honest triangles stay within a few degrees.
void fisheyeGuard() {
  vec2 ndc = gl_FragCoord.xy / uViewport * 2.0 - 1.0;
  vec2 p = vec2(ndc.x, ndc.y / uAspect);
  float r = length(p);
  float theta = uStereo > 0.5 ? 2.0 * atan(r * tan(uHalfFov * 0.5)) : r * uHalfFov;
  vec2 d = r > 1e-6 ? p / r : vec2(0.0);
  vec3 pixel = vec3(d * sin(theta), -cos(theta));
  if (dot(normalize(vFishDir), pixel) < 0.7) discard;
}
`;

/**
 * Adds the fisheye projection, the wrap guard and radial fog to a built-in
 * material. `signal` materials fade over the longer signal fog range.
 */
export function patchMaterial(material: THREE.Material, opts: { signal?: boolean } = {}): void {
  const fogScale = opts.signal ? signalFogScale : worldFogScale;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fisheyeUniforms, { uFogScale: fogScale });
    shader.vertexShader = (VERTEX_HEAD + shader.vertexShader)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFishDir = mvPosition.xyz;\ngl_Position = fisheyeProject(mvPosition.xyz);')
      // Radial fog: planar depth fog brightens the edges of a wide view.
      .replace('#include <fog_vertex>', '#ifdef USE_FOG\n\tvFogDepth = length( mvPosition.xyz ) * uFogScale;\n#endif');
    shader.fragmentShader = (FRAGMENT_HEAD + shader.fragmentShader).replace('void main() {', 'void main() {\n\tfisheyeGuard();');
  };
}
