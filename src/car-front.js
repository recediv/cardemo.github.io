import * as THREE from '../vendor/three.module.js';

const FRONT_Z = 1.64;
const LENS_Z = 1.61;

function opening(x, y, width, height, type) {
  const left = x - width / 2, right = x + width / 2;
  const bottom = y - height / 2, top = y + height / 2, corner = 0.007;
  return { x, y, type, contour: [
    [left + corner, bottom], [right - corner, bottom], [right, bottom + corner], [right, top - corner],
    [right - corner, top], [left + corner, top], [left, top - corner], [left, bottom + corner],
  ] };
}

export const FRONT_OPENINGS = [
  opening(-0.43, 0.073, 0.18, 0.054, 'lamp'),
  opening(0.43, 0.073, 0.18, 0.054, 'lamp'),
  opening(0, 0.07, 0.56, 0.042, 'grille'),
];

let frontGeometry;

function geometryFromTriangles(positions) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

function createGeometry() {
  const recess = [], bumper = [];
  const quad = (positions, a, b, c, d) => positions.push(...a, ...b, ...c, ...b, ...d, ...c);
  for (const { x, y, contour, type } of FRONT_OPENINGS) {
    const inner = contour.map(([px, py]) => [x + (px - x) * 0.85, y + (py - y) * 0.7, 1.602]);
    for (let i = 0; i < contour.length; i++) {
      const next = (i + 1) % contour.length;
      // The walls face into the opening; the lamp sits behind the painted nose.
      quad(recess, [...contour[i], FRONT_Z], [...contour[next], FRONT_Z], inner[i], inner[next]);
    }
    const shape = inner.map(([px, py]) => new THREE.Vector2(px, py));
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(shape, [])) recess.push(...inner[a], ...inner[b], ...inner[c]);
    if (type === 'grille') {
      for (const barY of [0.064, 0.076]) {
        const bar = new THREE.BoxGeometry(0.45, 0.004, 0.006).translate(0, barY, 1.607).toNonIndexed();
        recess.push(...bar.attributes.position.array); bar.dispose();
      }
    }
  }

  const face = [[-0.58, -0.021], [-0.55, -0.039], [0.55, -0.039], [0.58, -0.021],
    [0.58, 0.016], [0.55, 0.031], [-0.55, 0.031], [-0.58, 0.016]];
  const front = face.map(([x, y]) => [x, y, 1.637]);
  const rear = face.map(([x, y]) => [x * 1.04, y + 0.01, 1.55]);
  for (let i = 0; i < face.length; i++) {
    const next = (i + 1) % face.length;
    quad(bumper, rear[i], rear[next], front[i], front[next]);
  }
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(face.map(([x, y]) => new THREE.Vector2(x, y)), [])) {
    bumper.push(...front[a], ...front[b], ...front[c], ...rear[a], ...rear[c], ...rear[b]);
  }
  return { recess: geometryFromTriangles(recess), bumper: geometryFromTriangles(bumper),
    lens: new THREE.PlaneGeometry(0.148, 0.03) };
}

export function createCarFront(paint, trim, lamps, lampName) {
  frontGeometry ??= createGeometry();
  const root = new THREE.Group(); root.name = 'front-assembly';
  const recess = new THREE.Mesh(frontGeometry.recess, trim); recess.name = 'recessed-front-housings';
  recess.receiveShadow = true; root.add(recess);
  const bumper = new THREE.Mesh(frontGeometry.bumper, paint); bumper.name = 'front-bumper';
  bumper.castShadow = bumper.receiveShadow = true; root.add(bumper);
  for (const { x, y, type } of FRONT_OPENINGS) {
    if (type !== 'lamp') continue;
    const lens = new THREE.Mesh(frontGeometry.lens, lamps); lens.name = lampName;
    lens.position.set(x, y, LENS_Z); lens.receiveShadow = true; root.add(lens);
    const source = new THREE.Object3D(); source.name = `front-light-source-${x < 0 ? 'left' : 'right'}`;
    source.position.set(x, y, LENS_Z + 0.005); root.add(source);
  }
  return root;
}
