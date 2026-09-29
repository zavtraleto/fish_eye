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
};

const VERTEX_HEAD = /* glsl */ `
uniform float uHalfFov;
uniform float uStereo;
uniform float uAspect;
uniform float uNear;
uniform float uFar;
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

/** Adds the fisheye projection and radial fog to a built-in material. */
export function patchMaterial(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fisheyeUniforms);
    shader.vertexShader = (VERTEX_HEAD + shader.vertexShader)
      .replace('#include <project_vertex>', '#include <project_vertex>\ngl_Position = fisheyeProject(mvPosition.xyz);')
      // Radial fog: planar depth fog brightens the edges of a wide view.
      .replace('#include <fog_vertex>', '#ifdef USE_FOG\n\tvFogDepth = length( mvPosition.xyz );\n#endif');
  };
}
