import * as THREE from '../vendor/three.module.js';
import { randomGenerator } from './simulation.js';

export function createSoilTextures() {
  const size = 512, color = new Uint8Array(size * size * 4), height = new Uint8Array(size * size);
  const random = randomGenerator(5841);
  const field = cells => ({ cells, values: Float32Array.from({ length: cells * cells }, random) });
  const broad = field(6), clumps = field(24), grit = field(128);
  const sample = (field, x, y) => {
    const n = field.cells, px = x / size * n, py = y / size * n, ix = Math.floor(px), iy = Math.floor(py);
    const fx = px - ix, fy = py - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const get = (a, b) => field.values[((iy + b) % n) * n + (ix + a) % n];
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(get(0, 0), get(1, 0), u), THREE.MathUtils.lerp(get(0, 1), get(1, 1), u), v) - 0.5;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const patch = sample(broad, x, y), clod = sample(clumps, x, y), grain = sample(grit, x, y), index = y * size + x;
    const tone = Math.round(THREE.MathUtils.clamp(0.94 + patch * 0.14 + clod * 0.1 + grain * 0.025, 0, 1) * 255);
    color[index * 4] = color[index * 4 + 1] = color[index * 4 + 2] = tone; color[index * 4 + 3] = 255;
    height[index] = Math.round((0.5 + patch * 0.16 + clod * 0.2 + grain * 0.045) * 255);
  }
  const map = new THREE.DataTexture(color, size, size, THREE.RGBAFormat), bump = new THREE.DataTexture(height, size, size, THREE.RedFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [map, bump]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(260 / 8, 230 / 8);
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
    texture.anisotropy = 4; texture.needsUpdate = true;
  }
  return { map, bump };
}
