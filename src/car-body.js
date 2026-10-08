import * as THREE from '../vendor/three.module.js';

const exteriorCache = new Map();

export function cabinSidePoint(rings, side, y, z, offset = 0) {
  const bottom = side > 0 ? 1 : 0, top = side > 0 ? 2 : 3;
  for (let i = 1; i < rings.length; i++) {
    for (const [a, b, c] of [[rings[i - 1][bottom], rings[i][bottom], rings[i - 1][top]], [rings[i][bottom], rings[i][top], rings[i - 1][top]]]) {
      const determinant = (b[1] - c[1]) * (a[2] - c[2]) + (c[2] - b[2]) * (a[1] - c[1]);
      const u = ((b[1] - c[1]) * (z - c[2]) + (c[2] - b[2]) * (y - c[1])) / determinant;
      const v = ((c[1] - a[1]) * (z - c[2]) + (a[2] - c[2]) * (y - c[1])) / determinant, w = 1 - u - v;
      if (u >= -1e-7 && v >= -1e-7 && w >= -1e-7) return [a[0] * u + b[0] * v + c[0] * w + side * offset, y, z];
    }
  }
  throw new RangeError(`Point lies outside the cabin: ${y}, ${z}`);
}

export function createCarExterior(bodySections, cabinRings, simplified = false) {
  const cacheKey = simplified ? 'ghost' : 'car';
  if (exteriorCache.has(cacheKey)) return exteriorCache.get(cacheKey);
  const batches = new Map();
  const triangle = (name, material, a, b, c, normal) => {
    if (!batches.has(name)) batches.set(name, { material, positions: [] });
    const cross = new THREE.Vector3().subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a))
      .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...c), new THREE.Vector3(...a)));
    batches.get(name).positions.push(...a, ...(cross.dot(new THREE.Vector3(...normal)) < 0 ? [...c, ...b] : [...b, ...c]));
  };
  const quad = (name, material, a, b, c, d, normal) => {
    triangle(name, material, a, b, c, normal); triangle(name, material, b, d, c, normal);
  };
  const section = z => {
    for (let i = 1; i < bodySections.length; i++) {
      const a = bodySections[i - 1], b = bodySections[i];
      if (z <= b[0]) {
        const t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
        return { width: THREE.MathUtils.lerp(a[1], b[1], t), bottom: THREE.MathUtils.lerp(a[2], b[2], t), top: THREE.MathUtils.lerp(a[3], b[3], t) };
      }
    }
    const last = bodySections.at(-1); return { width: last[1], bottom: last[2], top: last[3] };
  };
  const surface = (side, y, z, offset = 0) => {
    const s = section(z);
    const shoulder = THREE.MathUtils.clamp((y - s.top + 0.05) / 0.05, 0, 1);
    const skirt = THREE.MathUtils.clamp((s.bottom + 0.06 - y) / 0.06, 0, 1);
    return [side * (s.width - shoulder * 0.1 - skirt * 0.08 + offset), y, z];
  };
  if (!simplified) for (const side of [-1, 1]) {
    // The door continues through the belt line and around its side window.
    const outline = [
      { z: 0.465, y: -0.168, kind: 'body' },
      { z: 0.588, y: section(0.588).top - 0.052, kind: 'body' },
      { z: 0.588, y: section(0.588).top, kind: 'shoulder' },
      { z: 0.588, y: 0.286, kind: 'cabin' },
      { z: 0.588, y: 0.314, kind: 'cabin' },
      { z: 0.12, y: 0.705, kind: 'cabin' },
      { z: -0.53, y: 0.7205, kind: 'cabin' },
      { z: -0.64, y: 0.326, kind: 'cabin' },
      { z: -0.64, y: 0.3133, kind: 'cabin' },
      { z: -0.64, y: section(-0.64).top, kind: 'shoulder' },
      { z: -0.64, y: section(-0.64).top - 0.052, kind: 'body' },
      { z: -0.54, y: 0.068, kind: 'body' },
      { z: -0.435, y: -0.168, kind: 'body' },
    ];
    const doorPoint = (point, dy = 0, dz = 0) => point.kind === 'cabin'
      ? cabinSidePoint(cabinRings, side, point.y + dy, point.z + dz, 0.0025)
      : surface(side, point.y + dy, point.z + dz, 0.0025);
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length], edge = new THREE.Vector2(b.z - a.z, b.y - a.y).normalize();
      const inset = a.kind !== b.kind || a.kind === 'shoulder'
        ? new THREE.Vector2(0.003, 0) : new THREE.Vector2(edge.y, -edge.x).multiplyScalar(0.003);
      quad('door-seams', 'trim', doorPoint(a), doorPoint(b), doorPoint(a, inset.y, inset.x), doorPoint(b, inset.y, inset.x), [side, 1, 0]);
    }
    const pocket = [new THREE.Vector2(-0.414, 0.193), new THREE.Vector2(-0.397, 0.184), new THREE.Vector2(-0.285, 0.184),
      new THREE.Vector2(-0.274, 0.193), new THREE.Vector2(-0.274, 0.213), new THREE.Vector2(-0.291, 0.221), new THREE.Vector2(-0.403, 0.221), new THREE.Vector2(-0.414, 0.212)];
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(pocket, [])) {
      triangle('door-seams', 'trim', ...[a, b, c].map(i => surface(side, pocket[i].y, pocket[i].x - 0.10, 0.003)), [side, 0, 0]);
    }
    const grip = new THREE.BoxGeometry(0.009, 0.014, 0.101).translate(...surface(side, 0.208, -0.446, 0.009)).toNonIndexed();
    const p = grip.attributes.position;
    for (let i = 0; i < p.count; i += 3) triangle('door-handles', 'metal', ...[0, 1, 2].map(j => [p.getX(i + j), p.getY(i + j), p.getZ(i + j)]),
      [grip.attributes.normal.getX(i), grip.attributes.normal.getY(i), grip.attributes.normal.getZ(i)]);
    grip.dispose();
  }

  const parts = [...batches].map(([name, { material, positions }]) => {
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    return { name, material, geometry };
  });
  exteriorCache.set(cacheKey, parts); return parts;
}
