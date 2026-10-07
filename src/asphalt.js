import * as THREE from '../vendor/three.module.js';
import { randomGenerator } from './simulation.js';

export function createAsphaltTextures() {
  const size = 512, color = new Uint8Array(size * size * 4), relief = new Uint8Array(size * size);
  const random = randomGenerator(82571), cells = 16;
  const patches = Float32Array.from({ length: cells * cells }, random);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size * cells, py = y / size * cells, ix = Math.floor(px), iy = Math.floor(py);
    const fx = px - ix, fy = py - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const get = (dx, dy) => patches[((iy + dy) % cells) * cells + (ix + dx) % cells];
    const patch = THREE.MathUtils.lerp(THREE.MathUtils.lerp(get(0, 0), get(1, 0), u), THREE.MathUtils.lerp(get(0, 1), get(1, 1), u), v) - 0.5;
    const grain = random(), stone = grain > 0.88 ? (grain - 0.88) * 0.75 : grain < 0.07 ? -0.07 : 0;
    const tone = Math.round(THREE.MathUtils.clamp(0.9 + patch * 0.1 + (grain - 0.5) * 0.11 + stone, 0, 1) * 255), index = y * size + x;
    color[index * 4] = color[index * 4 + 1] = color[index * 4 + 2] = tone; color[index * 4 + 3] = 255;
    relief[index] = Math.round((0.5 + (grain - 0.5) * 0.35 + patch * 0.08 + stone) * 255);
  }
  const map = new THREE.DataTexture(color, size, size, THREE.RGBAFormat);
  const bumpMap = new THREE.DataTexture(relief, size, size, THREE.RedFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [map, bumpMap]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(3, 1);
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.anisotropy = 4; texture.needsUpdate = true;
  }
  return { map, bumpMap };
}
