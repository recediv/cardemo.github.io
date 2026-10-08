import * as THREE from '../vendor/three.module.js';

const roofAssets = new Map();

export function createCarRoof(rings, simplified = false) {
  if (roofAssets.has(simplified)) return roofAssets.get(simplified);
  const back = rings[1][2][2], front = rings[2][2][2], start = back - 0.025, end = front + 0.025;
  const lengthSegments = simplified ? 6 : 12, crossSegments = simplified ? 6 : 12;
  const stations = [start, ...Array.from({ length: lengthSegments + 1 }, (_, i) => THREE.MathUtils.lerp(back, front, i / lengthSegments)), end];
  const widthAt = z => {
    const distance = Math.min(z - start, end - z), corner = 0.04;
    return 0.552 - (distance < corner ? corner - Math.sqrt(Math.max(0, corner * corner - (corner - distance) ** 2)) : 0);
  };
  const baseAt = z => {
    for (let i = 1; i < rings.length; i++) {
      const a = rings[i - 1][2], b = rings[i][2];
      if (z <= b[2]) return THREE.MathUtils.lerp(a[1], b[1], (z - a[2]) / (b[2] - a[2]));
    }
    return rings.at(-1)[2][1];
  };
  const heightAt = (x, z) => {
    const t = THREE.MathUtils.clamp((z - back) / (front - back), 0, 1);
    return baseAt(z) + 0.004 + 0.025 * Math.sin(Math.PI * t) * (1 - (x / widthAt(z)) ** 2);
  };
  const geometry = (positions, indices) => {
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); result.setIndex(indices);
    result.computeVertexNormals(); result.computeBoundingSphere(); return result;
  };
  const positions = [], indices = [], row = crossSegments + 1, count = stations.length * row;
  for (const lower of [false, true]) for (const z of stations) for (let i = 0; i <= crossSegments; i++) {
    const x = THREE.MathUtils.lerp(-widthAt(z), widthAt(z), i / crossSegments);
    positions.push(x, lower ? baseAt(z) - 0.006 : heightAt(x, z), z);
  }
  for (let i = 0; i < stations.length - 1; i++) for (let j = 0; j < crossSegments; j++) {
    const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
    indices.push(a, c, b, b, c, d, a + count, b + count, c + count, b + count, d + count, c + count);
  }
  const side = (a, b) => indices.push(a, b, a + count, b, b + count, a + count);
  for (let i = 0; i < stations.length - 1; i++) {
    side((i + 1) * row, i * row);
    side(i * row + crossSegments, (i + 1) * row + crossSegments);
  }
  for (let j = 0; j < crossSegments; j++) {
    side(j, j + 1);
    side((stations.length - 1) * row + j + 1, (stations.length - 1) * row + j);
  }
  const stripes = [-1, 1].map(side => {
    const positions = [], indices = [];
    for (const z of stations) for (const x of [side * 0.22 - 0.085, side * 0.22 + 0.085]) positions.push(x, heightAt(x, z) + 0.0015, z);
    for (let i = 0; i < stations.length - 1; i++) {
      const a = i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    return geometry(positions, indices);
  });
  const assets = { roof: geometry(positions, indices), stripes };
  roofAssets.set(simplified, assets); return assets;
}
