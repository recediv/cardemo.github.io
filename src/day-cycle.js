import * as THREE from '../vendor/three.module.js';

// Adapted from Bruno Simon's DayCycles / MeshDefaultMaterial (MIT).
// The source deliberately assigns separate light, shadow and fog palettes.
// License: vendor/BRUNO-SIMON-LICENSE.txt.
const definitions = {
  dawn: { light: '#ffa882', shadow: '#db6492', ambient: '#c493b3', top: '#b68dbb', horizon: '#ffc28e', intensity: 1.1, sun: 2.4, hemi: 1.35 },
  day: { light: '#ffd2c2', shadow: '#8065bc', ambient: '#c7dcf2', top: '#81b5d4', horizon: '#cee4dc', intensity: 1.2, sun: 2.7, hemi: 1.6 },
  dusk: { light: '#ff8181', shadow: '#593979', ambient: '#ae84ba', top: '#70598e', horizon: '#f2a4aa', intensity: 1.05, sun: 2.0, hemi: 1.1 },
  night: { light: '#647bff', shadow: '#352757', ambient: '#606da1', top: '#101b3b', horizon: '#282e59', intensity: 0.85, sun: 0.65, hemi: 0.75 },
};
const presets = Object.fromEntries(Object.entries(definitions).map(([name, values]) => [name, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'string' ? new THREE.Color(value) : value]))]));
const stops = [[0, 'night'], [4.5, 'night'], [7, 'dawn'], [10, 'day'], [16, 'day'], [18.5, 'dusk'], [21.5, 'night'], [24, 'night']];

export class DayPalette {
  constructor() {
    for (const key of ['light', 'shadow', 'ambient', 'top', 'horizon']) this[key] = new THREE.Color();
    this.uniforms = { sceneLightColor: { value: this.light }, sceneShadowColor: { value: this.shadow }, sceneLightIntensity: { value: 1 }, sceneLightDirection: { value: new THREE.Vector3() } };
    this.update(14);
  }
  update(hour) {
    hour = ((hour % 24) + 24) % 24;
    let i = 0; while (i < stops.length - 2 && hour >= stops[i + 1][0]) i++;
    const a = presets[stops[i][1]], b = presets[stops[i + 1][1]], t = THREE.MathUtils.smootherstep(hour, stops[i][0], stops[i + 1][0]);
    for (const key of ['light', 'shadow', 'ambient', 'top', 'horizon']) this[key].copy(a[key]).lerp(b[key], t);
    for (const key of ['intensity', 'sun', 'hemi']) this[key] = THREE.MathUtils.lerp(a[key], b[key], t);
    this.uniforms.sceneLightIntensity.value = this.intensity;
  }
}

export function applySceneStyle(material, palette, groundNormal = false, options = {}) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = shader => {
    previous(shader);
    Object.assign(shader.uniforms, palette.uniforms);
    shader.fragmentShader = 'uniform vec3 sceneLightColor; uniform vec3 sceneShadowColor; uniform vec3 sceneLightDirection; uniform float sceneLightIntensity;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>');
    const orientation = groundNormal ? 'vec3(0.0, 1.0, 0.0)' : 'inverseTransformDirection(normal, viewMatrix)';
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      vec3 styleNormal = ${orientation};
      float coreShade = 1.0 - smoothstep(-0.3, 0.8, dot(styleNormal, sceneLightDirection));
      float castShade = 1.0 - getShadowMask();
      float shade = clamp(max(coreShade * 0.65, castShade * 0.82), 0.0, 1.0);
      ${options.baseShadow ? `shade = max(shade, ${options.baseShadow});` : ''}
      vec3 litColor = diffuseColor.rgb * sceneLightColor * sceneLightIntensity;
      vec3 shadeColor = diffuseColor.rgb * sceneShadowColor;
      outgoingLight = mix(litColor, shadeColor, shade) + reflectedLight.directDiffuse * ${Number(options.directLight ?? 0.22).toFixed(2)} + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `bruno-scene-style-v2-${groundNormal}-${options.baseShadow ?? 'none'}-${options.directLight ?? 0.22}`;
  return material;
}
