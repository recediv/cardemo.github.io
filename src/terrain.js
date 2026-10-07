import * as THREE from '../vendor/three.module.js';
import { clamp, smoothstep } from './simulation.js';
import { TERRAIN_SIZE, WORLD_SIZE } from './scene-config.js';

// Terrain.colorNode / Grass.terrainNode, adapted from folio-2025 (MIT).
// The track needs its own terrain data. The shared material follows Terrain.js;
// its land palette is adjusted for autumn. License: vendor/BRUNO-SIMON-LICENSE.txt.
export const terrainShader = `
  uniform sampler2D terrainDataMap; uniform sampler2D terrainGradient;
  uniform vec2 terrainSize; uniform vec3 terrainGrassColor; uniform vec3 terrainDryGrassColor;
  uniform float terrainWetness;
  vec3 terrainColor(vec4 data) {
    vec3 dirt = texture2D(terrainGradient, vec2(0.5, 1.0 - data.b)).rgb;
    vec3 grass = mix(terrainGrassColor, terrainDryGrassColor, smoothstep(0.38, 0.62, data.r));
    return mix(dirt, grass, data.g) * (1.0 - terrainWetness * 0.24);
  }
`;

export function createTerrainField(track, river = null) {
  const size = new THREE.Vector2(TERRAIN_SIZE.width, TERRAIN_SIZE.depth), resolution = 256;
  const data = new Uint8Array(resolution * resolution * 4);
  const hash = (x, z) => ((Math.imul(x + 741, 374761393) ^ Math.imul(z + 217, 668265263)) >>> 0) / 4294967295;
  const noise = (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z), u = smoothstep(0, 1, x - ix), v = smoothstep(0, 1, z - iz);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix, iz), hash(ix + 1, iz), u), THREE.MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), u), v);
  };
  const roadEdge = track.width / 2 + track.curbWidth;
  for (let z = 0; z < resolution; z++) for (let x = 0; x < resolution; x++) {
    const worldX = ((x + 0.5) / resolution - 0.5) * size.x;
    const worldZ = ((z + 0.5) / resolution - 0.5) * size.y;
    const distance = track.nearest({ x: worldX, z: worldZ }).distance;
    const variation = noise(worldX * 0.043 + 31, worldZ * 0.043 + 47) * 0.75 + noise(worldX * 0.13, worldZ * 0.13) * 0.25;
    let density = 0.76 + smoothstep(0.22, 0.68, variation) * 0.24;
    density *= smoothstep(roadEdge + 0.1, roadEdge + 0.65, distance);
    // Continuous grass along the course; rare natural clearings stay deeper
    // in the forest so bare ground never makes stripes beside the kerbs.
    const clearing = smoothstep(0.17, 0.3, variation);
    density *= THREE.MathUtils.lerp(1, clearing, smoothstep(roadEdge + 9, roadEdge + 14, distance));
    // Only the fixed edge of the landscape tapers into the mountain foothills.
    density *= 1 - smoothstep(WORLD_SIZE.width / 2 - 5, WORLD_SIZE.width / 2, Math.abs(worldX));
    density *= 1 - smoothstep(WORLD_SIZE.depth / 2 - 5, WORLD_SIZE.depth / 2, Math.abs(worldZ));
    if (river) density *= river.landMask(worldX, worldZ);
    const i = (z * resolution + x) * 4;
    data[i] = Math.round(variation * 255);
    data[i + 1] = Math.round(density * 255);
    const riverBank = river ? 1 - river.landMask(worldX, worldZ) : 0;
    data[i + 2] = Math.round(230 - riverBank * 32);
    data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 16;
  const context = canvas.getContext('2d'), gradient = context.createLinearGradient(0, 0, 0, 16);
  for (const [stop, color] of [[0.1, '#b18e60'], [0.3, '#829b91'], [0.9, '#13375f']]) gradient.addColorStop(stop, color);
  context.fillStyle = gradient; context.fillRect(0, 0, 1, 16);
  const gradientTexture = new THREE.CanvasTexture(canvas);
  // Keep the palette order explicit: low coordinates mean warm dry soil,
  // high coordinates mean cool water, matching our terrain data channel.
  gradientTexture.flipY = false;
  gradientTexture.colorSpace = THREE.SRGBColorSpace;
  gradientTexture.magFilter = gradientTexture.minFilter = THREE.LinearFilter;
  gradientTexture.generateMipmaps = false;

  const sampleDensity = (x, z) => {
    const px = clamp((x / size.x + 0.5) * resolution - 0.5, 0, resolution - 1);
    const pz = clamp((z / size.y + 0.5) * resolution - 0.5, 0, resolution - 1);
    const ix = Math.floor(px), iz = Math.floor(pz), nx = Math.min(ix + 1, resolution - 1), nz = Math.min(iz + 1, resolution - 1);
    const get = (a, b) => data[(b * resolution + a) * 4 + 1] / 255;
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(get(ix, iz), get(nx, iz), px - ix), THREE.MathUtils.lerp(get(ix, nz), get(nx, nz), px - ix), pz - iz);
  };
  const clearGrass = (x, z, radius, amount = 1) => {
    const minX = Math.max(0, Math.floor(((x - radius) / size.x + 0.5) * resolution));
    const maxX = Math.min(resolution - 1, Math.ceil(((x + radius) / size.x + 0.5) * resolution));
    const minZ = Math.max(0, Math.floor(((z - radius) / size.y + 0.5) * resolution));
    const maxZ = Math.min(resolution - 1, Math.ceil(((z + radius) / size.y + 0.5) * resolution));
    for (let row = minZ; row <= maxZ; row++) for (let col = minX; col <= maxX; col++) {
      const dx = ((col + 0.5) / resolution - 0.5) * size.x - x;
      const dz = ((row + 0.5) / resolution - 0.5) * size.y - z;
      const fade = 1 - smoothstep(radius * 0.35, radius, Math.hypot(dx, dz));
      const i = (row * resolution + col) * 4 + 1;
      data[i] = Math.round(data[i] * (1 - fade * amount));
    }
    texture.needsUpdate = true;
  };
  return {
    size, sampleDensity, clearGrass,
    isLand: (x, z, margin = 0) => !river || !river.isNear(x, z, margin),
    surfaceHeight: (x, z) => river ? Math.max(river.groundHeight(x, z), river.contains(x, z) ? river.waterLevel : -Infinity) : 0,
    uniforms: {
      terrainDataMap: { value: texture }, terrainGradient: { value: gradientTexture },
      terrainSize: { value: size }, terrainGrassColor: { value: new THREE.Color('#889b57') }, terrainDryGrassColor: { value: new THREE.Color('#b9a16b') }, terrainWetness: { value: 0 },
    },
  };
}

export function applyTerrain(material, uniforms) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = shader => {
    previous(shader); Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec2 terrainPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nterrainPosition = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = terrainShader + 'varying vec2 terrainPosition;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= terrainColor(texture2D(terrainDataMap, terrainPosition / terrainSize + 0.5));');
  };
  material.customProgramCacheKey = () => `${key}-bruno-terrain-v1`;
  return material;
}
