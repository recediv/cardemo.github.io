import * as THREE from '../vendor/three.module.js';

const REAR_Z = -1.6;
const LENS_Z = REAR_Z + 0.024;

function contour(x, y, width, height, corner) {
  const left = x - width / 2, right = x + width / 2;
  const bottom = y - height / 2, top = y + height / 2;
  return [[left + corner, bottom], [right - corner, bottom], [right, bottom + corner], [right, top - corner],
    [right - corner, top], [left + corner, top], [left, top - corner], [left, bottom + corner]];
}

export const REAR_OPENINGS = [-1, 1].map(side => ({
  x: side * 0.445, y: 0.141, contour: contour(side * 0.445, 0.141, 0.49, 0.092, 0.011),
}));

let rearGeometry;

function geometryFromTriangles(positions) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

function createGeometry() {
  const recess = [], bumper = [];
  const quad = (positions, a, b, c, d) => positions.push(...a, ...b, ...c, ...b, ...d, ...c);
  for (const { x, y, contour: face } of REAR_OPENINGS) {
    const inner = face.map(([px, py]) => [x + (px - x) * 0.95, y + (py - y) * 0.78, REAR_Z + 0.037]);
    for (let i = 0; i < face.length; i++) {
      const next = (i + 1) % face.length;
      // Recess walls open towards the rear; the lenses sit inside the body.
      quad(recess, [...face[next], REAR_Z], [...face[i], REAR_Z], inner[next], inner[i]);
    }
    const shape = inner.map(([px, py]) => new THREE.Vector2(px, py));
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(shape, [])) recess.push(...inner[a], ...inner[c], ...inner[b]);
  }

  const face = [[-0.72, 0], [-0.692, -0.016], [0.692, -0.016], [0.72, 0],
    [0.72, 0.05], [0.692, 0.07], [-0.692, 0.07], [-0.72, 0.05]];
  const outer = face.map(([x, y]) => [x, y, REAR_Z - 0.02]);
  const mount = face.map(([x, y]) => [x * 1.038, y, REAR_Z + 0.015]);
  for (let i = 0; i < face.length; i++) {
    const next = (i + 1) % face.length;
    quad(bumper, outer[i], outer[next], mount[i], mount[next]);
  }
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(face.map(([x, y]) => new THREE.Vector2(x, y)), [])) {
    bumper.push(...outer[a], ...outer[c], ...outer[b], ...mount[a], ...mount[b], ...mount[c]);
  }
  const lens = (width, height, corner) => {
    const face = contour(0, 0, width, height, corner), positions = [];
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(face.map(([x, y]) => new THREE.Vector2(x, y)), [])) {
      positions.push(...face[a], 0, ...face[c], 0, ...face[b], 0);
    }
    return geometryFromTriangles(positions);
  };
  return { recess: geometryFromTriangles(recess), bumper: geometryFromTriangles(bumper),
    tailLens: lens(0.35, 0.055, 0.006), reverseLens: lens(0.072, 0.05, 0.005),
    trim: new THREE.BoxGeometry(1.16, 0.022, 0.016).translate(0, -0.031, REAR_Z - 0.005) };
}

export function createCarRear(trim, tails, reverseLamps) {
  rearGeometry ??= createGeometry();
  const root = new THREE.Group(); root.name = 'rear-assembly';
  const housing = new THREE.Mesh(rearGeometry.recess, trim); housing.name = 'recessed-rear-housings';
  housing.receiveShadow = true; root.add(housing);
  const bumper = new THREE.Mesh(rearGeometry.bumper, trim); bumper.name = 'rear-bumper';
  bumper.castShadow = bumper.receiveShadow = true; root.add(bumper);
  const lowerTrim = new THREE.Mesh(rearGeometry.trim, trim); lowerTrim.name = 'rear-diffuser';
  lowerTrim.receiveShadow = true; root.add(lowerTrim);
  for (const side of [-1, 1]) {
    for (const [name, geometry, material, x] of [['rear-lamp', rearGeometry.tailLens, tails, side * 0.487],
      ['reverse-lamp', rearGeometry.reverseLens, reverseLamps, side * 0.255]]) {
      const lens = new THREE.Mesh(geometry, material); lens.name = name;
      lens.position.set(x, 0.141, LENS_Z); lens.receiveShadow = true; root.add(lens);
    }
  }
  return root;
}
