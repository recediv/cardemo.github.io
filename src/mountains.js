import * as THREE from '../vendor/three.module.js';
import { WORLD_SIZE } from './scene-config.js';

// A continuous pair of ridges outside the forest, with rocky faces and foothills.
export function createMountainGeometry() {
  const sectors = 192, rows = 20, vertices = [], colors = [], indices = [];
  const soil = new THREE.Color('#778849'), rock = new THREE.Color('#89938c'), summit = new THREE.Color('#b1b8ad');
  const color = new THREE.Color();
  const noise = (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const hash = (a, b) => ((Math.imul(a, 374761393) ^ Math.imul(b, 668265263)) >>> 0) / 4294967295;
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix, iz), hash(ix + 1, iz), u), THREE.MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), u), v);
  };
  for (let row = 0; row <= rows; row++) for (let i = 0; i <= sectors; i++) {
    const angle = (i % sectors) / sectors * Math.PI * 2, dx = Math.cos(angle), dz = Math.sin(angle), t = row / rows;
    const radius = (x, z) => Math.pow(Math.pow(Math.abs(dx) / x, 6) + Math.pow(Math.abs(dz) / z, 6), -1 / 6);
    const inner = radius(WORLD_SIZE.width / 2 + 8, WORLD_SIZE.depth / 2 + 8), outer = radius(210, 183), r = THREE.MathUtils.lerp(inner, outer, t);
    const x = dx * r, z = dz * r;
    const crest = 0.42 + Math.sin(angle * 5) * 0.06;
    const front = Math.pow(Math.max(0, 1 - Math.abs(t - crest) / 0.4), 1.4);
    const back = Math.pow(Math.max(0, 1 - Math.abs(t - 0.76) / 0.24), 1.15);
    const frontHeight = 20 + Math.pow(0.5 + Math.sin(angle * 3 + 0.8) * 0.5, 4) * 25 + Math.cos(angle * 7) * 4;
    const backHeight = 23 + Math.pow(0.5 + Math.cos(angle * 4 - 0.4) * 0.5, 3) * 30;
    const roughness = noise(x * 0.065 + 71, z * 0.065 + 31) * 0.22 + noise(x * 0.18, z * 0.18) * 0.09;
    const y = Math.max(front * frontHeight, back * backHeight) * (0.83 + roughness) - 0.08;
    vertices.push(x, y, z);
    color.copy(soil).lerp(rock, THREE.MathUtils.smoothstep(y, 3, 22));
    color.lerp(summit, THREE.MathUtils.smoothstep(y, 28, 51)); color.multiplyScalar(0.94 + noise(x * 0.2, z * 0.2) * 0.12);
    colors.push(color.r, color.g, color.b);
    if (row < rows && i < sectors) {
      const a = row * (sectors + 1) + i, b = a + sectors + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  indexed.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); indexed.setIndex(indices);
  const geometry = indexed.toNonIndexed(); indexed.dispose();
  geometry.computeVertexNormals(); geometry.computeBoundingSphere(); return geometry;
}
