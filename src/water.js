import * as THREE from '../vendor/three.module.js';
import { createGrassNoise } from './vegetation.js';

// CPU port of folio-2025's Noises.voronoiNode(uv, 8). The three channels
// retain its nearest distance, distance between edges and stable cell ID.
// WaterSurface uses these channels for expanding rain rings, not normal maps.
// Source: https://github.com/brunosimon/folio-2025 (MIT).
// License: vendor/BRUNO-SIMON-LICENSE.txt.
function createVoronoiNoise() {
  const size = 128, repeat = 8, data = new Uint8Array(size * size * 4);
  const fract = x => x - Math.floor(x);
  const modulo = x => ((x % repeat) + repeat) % repeat;
  const hash = (x, y) => [fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123), fract(Math.sin(x * 269.5 + y * 183.3) * 43758.5453123)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + 0.5) / size * repeat, py = (y + 0.5) / size * repeat;
    const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
    let nearest = 1, second = 1, bestX = 0, bestY = 0;
    for (let ny = -1; ny <= 1; ny++) for (let nx = -1; nx <= 1; nx++) {
      const point = hash(modulo(ix + nx), modulo(iy + ny));
      const distance = Math.hypot(nx + point[0] - fx, ny + point[1] - fy);
      if (distance < nearest) {
        second = nearest; nearest = distance; bestX = ix + nx; bestY = iy + ny;
      } else if (distance < second) second = distance;
    }
    const i = (y * size + x) * 4;
    data[i] = Math.round(nearest * 255);
    data[i + 1] = Math.round((second - nearest) * 255);
    data[i + 2] = Math.round(hash(fract(bestX / repeat), fract(bestY / repeat))[0] * 255);
    data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// Optional fallback for isolated Lake instances. In the world, the water uses
// the very same gradient texture as the surrounding terrain.
function createGradient() {
  const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 16;
  const context = canvas.getContext('2d'), gradient = context.createLinearGradient(0, 0, 0, 16);
  for (const [stop, color] of [[0.1, '#b18e60'], [0.3, '#829b91'], [0.9, '#13375f']]) gradient.addColorStop(stop, color);
  context.fillStyle = gradient; context.fillRect(0, 0, 1, 16);
  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false;
  return texture;
}

export function createWaterUniforms(terrain) {
  return {
    lakeGradient: terrain?.uniforms.terrainGradient ?? { value: createGradient() },
    lakePerlin: { value: createGrassNoise() }, lakeVoronoi: { value: createVoronoiNoise() },
    lakeWindTime: { value: 0 }, lakeRainTime: { value: 0 }, lakeRain: { value: 0 },
  };
}

// GLSL adaptation of WaterSurface's ripplesNode, splashesNode and shoreNode.
// TSL's chained x.step(edge) is GLSL step(edge, x), hence the inverted masks.
// The positions are fixed lake coordinates; no camera-relative noise or blur.
const detailsShader = `
  uniform sampler2D lakePerlin; uniform sampler2D lakeVoronoi;
  uniform float lakeWindTime; uniform float lakeRainTime; uniform float lakeRain;
  float lakeHash(float x) { return fract(sin(x) * 43758.5453123); }
  float lakeDetails(vec2 position, float depth) {
    float baseRipple = (depth + lakeWindTime * 0.5) * 10.0;
    float rippleIndex = floor(baseRipple);
    float noise = texture2D(lakePerlin, (position + rippleIndex / 0.345) * 0.1).r;
    float rippleValue = fract(baseRipple) - (1.3 - depth * 1.3) + noise;
    float rippleAA = max(fwidth(baseRipple) + fwidth(noise), 0.012);
    float ripple = 1.0 - smoothstep(-0.4 - rippleAA, -0.4 + rippleAA, rippleValue);

    vec3 voronoi = texture2D(lakeVoronoi, position * 0.33).rgb;
    float splashPerlin = texture2D(lakePerlin, position * (0.33 * 0.25)).r;
    float timeRandom = lakeHash(voronoi.b * 123456.0) + splashPerlin;
    float splashTime = lakeRainTime * 6.0 + timeRandom;
    float splashPhase = fract(voronoi.r - splashTime);
    float edgeMultiplier = clamp((voronoi.g - 0.14) / (1.0 - 0.14), 0.0, 1.0);
    float thickness = 0.3 * edgeMultiplier;
    float splashAA = max(fwidth(voronoi.r), 0.006);
    float splash = 1.0 - smoothstep(thickness - splashAA, thickness + splashAA, splashPhase);
    splash *= smoothstep(0.0, 0.04, edgeMultiplier);
    float visibilityRandom = lakeHash(voronoi.b * 654321.0);
    float visibility = fract(visibilityRandom + splashPerlin);
    splash *= 1.0 - smoothstep(lakeRain * lakeRain - 0.03, lakeRain * lakeRain + 0.03, visibility);
    splash *= smoothstep(0.0, 0.035, lakeRain);

    float shoreAA = max(fwidth(depth), 0.002);
    float shore = 1.0 - smoothstep(0.17 - shoreAA, 0.17 + shoreAA, depth);
    return max(max(ripple, splash), shore);
  }
`;

export function applyLakeSurface(material, uniforms, details = false) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = shader => {
    previous(shader); Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'attribute float lakeDepth; varying float vLakeDepth; varying vec2 vLakePosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLakeDepth = lakeDepth; vLakePosition = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = 'varying float vLakeDepth; varying vec2 vLakePosition;\n' + shader.fragmentShader;
    if (details) {
      shader.fragmentShader = detailsShader + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `
        diffuseColor.a *= lakeDetails(vLakePosition, vLakeDepth);
        #include <alphatest_fragment>
      `);
    } else {
      shader.fragmentShader = 'uniform sampler2D lakeGradient;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        diffuseColor.rgb *= texture2D(lakeGradient, vec2(0.5, mix(0.3, 0.9, vLakeDepth))).rgb;
      `);
    }
  };
  material.customProgramCacheKey = () => `${key}-bruno-lake-v2-${details}`;
  return material;
}
