import * as THREE from '../vendor/three.module.js';

// Two travelling noise layers, adapted from Bruno Simon's Wind.js (MIT).
// Local plants add their own response and flutter to this shared wind field.
export function createWindNoise() {
  const size = 128, cells = 8, data = new Uint8Array(size * size);
  const hash = (x, y) => ((Math.imul((x + cells) % cells, 374761393) ^ Math.imul((y + cells) % cells, 668265263)) >>> 0) / 4294967295;
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + 0.5) / size * cells, py = (y + 0.5) / size * cells;
    const ix = Math.floor(px), iy = Math.floor(py), u = fade(px - ix), v = fade(py - iy);
    const a = THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), u), b = THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u);
    data[y * size + x] = Math.round(THREE.MathUtils.lerp(a, b, v) * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
  texture.needsUpdate = true; return texture;
}

export const windShader = `
  uniform float worldTime; uniform float worldWind;
  uniform sampler2D windNoise; uniform vec2 windDirection; uniform vec2 windOffset;
  float forestWindNoise(vec2 root) {
    float first = texture2D(windNoise, root * 0.025 + windOffset).r - 0.5;
    float second = texture2D(windNoise, root * 0.014 + windOffset * 0.2 + 0.37).r - 0.5;
    return first + second;
  }
  vec2 forestWindOffset(vec2 root, float response) {
    float field = forestWindNoise(root);
    float gust = sin(worldTime * 0.85 + root.x * 0.11 + root.y * 0.08) * 0.22;
    float crosswind = sin(worldTime * 0.73 + root.x * 0.08 - root.y * 0.05) * 0.28;
    return (windDirection * (0.45 + field * 1.9 + gust) + vec2(-windDirection.y, windDirection.x) * crosswind) * worldWind * response;
  }
  vec2 forestTreeOffset(vec2 root, float response) {
    float first = texture2D(windNoise, root * 0.018 + windOffset * 0.38).r - 0.5;
    float second = texture2D(windNoise, root * 0.009 + windOffset * 0.09 + 0.23).r - 0.5;
    float field = first * 0.65 + second * 0.35;
    float gust = sin(worldTime * 0.58 + root.x * 0.06 + root.y * 0.045) * 0.48
      + sin(worldTime * 0.27 + root.x * 0.13) * 0.18;
    float side = sin(worldTime * 0.45 + root.x * 0.04 - root.y * 0.035) * 0.24;
    vec2 bend = (windDirection * (0.3 + field * 0.9 + gust) + vec2(-windDirection.y, windDirection.x) * side) * worldWind * response;
    return bend / (1.0 + length(bend) * 0.8);
  }
`;
