import * as THREE from '../vendor/three.module.js';

export const EXHAUST_TIP = { x: 0.47, y: -0.12, z: -1.585 };

export function createBodyShellGeometry(bodyRings, frontOpenings = []) {
  const rings = bodyRings.map(ring => {
    const [left, right] = ring, floor = Math.min(left[1] + 0.16, ring[4][1] - 0.08);
    return [left,
      [left[0] + 0.028, left[1], left[2]], [left[0] + 0.028, left[1] + 0.023, left[2]],
      [left[0] + 0.09, left[1] + 0.023, left[2]], [left[0] + 0.09, left[1], left[2]],
      [left[0] + 0.12, left[1], left[2]], [left[0] + 0.12, floor, left[2]],
      [right[0] - 0.12, floor, right[2]], [right[0] - 0.12, right[1], right[2]],
      [right[0] - 0.09, right[1], right[2]], [right[0] - 0.09, right[1] + 0.023, right[2]],
      [right[0] - 0.028, right[1] + 0.023, right[2]], [right[0] - 0.028, right[1], right[2]],
      right, ...ring.slice(2)];
  });
  const positions = rings.flat(2), sides = rings[0].length, painted = [], underside = [];
  for (let ring = 0; ring < rings.length - 1; ring++) for (let side = 0; side < sides; side++) {
    const a = ring * sides + side, b = ring * sides + (side + 1) % sides;
    (side < 13 ? underside : painted).push(a, b, a + sides, b, b + sides, a + sides);
  }
  // The recessed cross-section is concave, so its end caps need triangulation.
  for (const end of [0, rings.length - 1]) {
    const contour = rings[end].map(([x, y]) => new THREE.Vector2(x, y));
    const vertices = contour.map((_, i) => end * sides + i), holes = [];
    if (end > 0) for (const opening of frontOpenings) {
      holes.push(opening.contour.map(([x, y]) => {
        vertices.push(positions.length / 3); positions.push(x, y, rings[end][0][2]);
        return new THREE.Vector2(x, y);
      }));
    }
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
      painted.push(vertices[a], vertices[end === 0 ? c : b], vertices[end === 0 ? b : c]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex([...painted, ...underside]);
  geometry.addGroup(0, painted.length, 0); geometry.addGroup(painted.length, underside.length, 1);
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

let underbodyAssets;

function createAssets() {
  const batches = { frame: { positions: [], normals: [] }, drivetrain: { positions: [], normals: [] }, exhaust: { positions: [], normals: [] } };
  const add = (batch, geometry) => {
    const triangles = geometry.index ? geometry.toNonIndexed() : geometry;
    batches[batch].positions.push(...triangles.attributes.position.array);
    batches[batch].normals.push(...triangles.attributes.normal.array);
    if (triangles !== geometry) triangles.dispose();
    geometry.dispose();
  };
  const box = (batch, size, position) => add(batch, new THREE.BoxGeometry(...size).translate(...position));
  const pipe = (batch, start, end, radius, segments = 8) => {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end), direction = b.clone().sub(a);
    const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    const center = a.add(b).multiplyScalar(0.5);
    add(batch, new THREE.CylinderGeometry(radius, radius, direction.length(), segments).applyQuaternion(rotation).translate(center.x, center.y, center.z));
  };

  for (const side of [-1, 1]) {
    box('frame', [0.075, 0.08, 2.05], [side * 0.425, -0.135, -0.21]);
    for (const z of [-1.15, -0.65, 0.45, 0.75]) {
      add('drivetrain', new THREE.CylinderGeometry(0.016, 0.016, 0.015, 6).translate(side * 0.425, -0.182, z));
    }
  }
  for (const z of [-0.91, -0.22, 0.5]) box('frame', [1.1, 0.06, 0.08], [0, -0.135, z]);
  pipe('frame', [-0.4, -0.12, -0.5], [0.4, -0.12, 0.38], 0.017);
  pipe('frame', [0.4, -0.12, -0.5], [-0.4, -0.12, 0.38], 0.017);

  box('drivetrain', [0.3, 0.12, 0.35], [0, -0.13, 0.55]);
  pipe('drivetrain', [0, -0.137, 0.4], [0, -0.137, 0.04], 0.075, 12);
  for (const z of [0.46, 0.55, 0.64]) box('frame', [0.29, 0.016, 0.028], [0, -0.195, z]);
  pipe('drivetrain', [0, -0.143, 0.05], [0, -0.143, -0.94], 0.024);
  for (const z of [0.015, -0.85]) {
    add('drivetrain', new THREE.TorusGeometry(0.04, 0.01, 4, 12).translate(0, -0.143, z));
  }
  add('drivetrain', new THREE.SphereGeometry(0.1, 12, 8).scale(1.6, 0.78, 1).translate(0, -0.132, -1.04));

  for (const z of [1, -1.04]) {
    const y = z > 0 ? -0.12 : -0.14;
    pipe('drivetrain', [-0.61, y, z], [0.61, y, z], 0.019);
    for (const side of [-1, 1]) {
      for (const offset of [-0.16, 0.16]) {
        pipe('frame', [side * 0.3, y + 0.025, z + offset], [side * 0.62, y, z], 0.015);
      }
      pipe('drivetrain', [side * 0.51, y - 0.005, z], [side * 0.48, y + 0.095, z], 0.011);
      const coil = Array.from({ length: 41 }, (_, i) => {
        const t = i / 40, angle = t * Math.PI * 10;
        return new THREE.Vector3(side * 0.5 + Math.cos(angle) * 0.028, y + 0.012 + t * 0.07, z + Math.sin(angle) * 0.028);
      });
      add('drivetrain', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coil), 40, 0.005, 4, false));
    }
  }

  const exhaustPath = [[0.16, -0.15, 0.59], [0.2, -0.153, 0.12], [0.26, -0.15, -0.3], [0.31, -0.147, -0.93]];
  for (let i = 1; i < exhaustPath.length; i++) pipe('exhaust', exhaustPath[i - 1], exhaustPath[i], 0.027);
  pipe('exhaust', [0.31, -0.124, -0.92], [0.31, -0.124, -1.3], 0.059, 12);
  const { x: tailX, y: tailY, z: tailZ } = EXHAUST_TIP;
  const tailCurve = new THREE.CatmullRomCurve3([
    [0.31, -0.124, -1.265], [0.32, -0.124, -1.325], [0.4, tailY, -1.36],
    [tailX, tailY, tailZ + 0.2], [tailX, tailY, tailZ + 0.17],
  ].map(point => new THREE.Vector3(...point)));
  add('exhaust', new THREE.TubeGeometry(tailCurve, 20, 0.027, 10, false));
  // The flared socket overlaps the chrome tip's inlet instead of ending in air.
  add('exhaust', new THREE.CylinderGeometry(0.027, 0.052, 0.05, 12)
    .rotateX(Math.PI / 2).translate(tailX, tailY, tailZ + 0.15));
  for (const z of [-1.02, -1.2]) {
    add('frame', new THREE.TorusGeometry(0.06, 0.007, 4, 12).translate(0.31, -0.124, z));
    pipe('frame', [0.37, -0.124, z], [0.398, -0.166, z], 0.009);
    pipe('frame', [0.398, -0.166, z], [0.425, -0.166, z], 0.009);
    box('frame', [0.028, 0.02, 0.04], [0.425, -0.174, z]);
  }
  add('frame', new THREE.TorusGeometry(0.04, 0.006, 4, 12).translate(tailX, tailY, tailZ + 0.15));
  pipe('frame', [tailX, tailY + 0.044, tailZ + 0.15], [tailX, -0.045, tailZ + 0.15], 0.008);
  box('frame', [0.06, 0.018, 0.045], [tailX, -0.043, tailZ + 0.15]);

  const materials = {
    frame: new THREE.MeshStandardMaterial({ color: '#293337', roughness: 0.85, metalness: 0.25 }),
    drivetrain: new THREE.MeshStandardMaterial({ color: '#8a969b', roughness: 0.62, metalness: 0.55 }),
    exhaust: new THREE.MeshStandardMaterial({ color: '#9b8467', roughness: 0.68, metalness: 0.45 }),
  };
  return Object.entries(batches).map(([name, batch]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
    geometry.computeBoundingSphere();
    return { name, geometry, material: materials[name] };
  });
}

export function createUnderbodyMechanism() {
  underbodyAssets ??= createAssets();
  const root = new THREE.Group(); root.name = 'underbody-mechanism';
  for (const { name, geometry, material } of underbodyAssets) {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = `underbody-${name}`;
    mesh.receiveShadow = true; root.add(mesh);
  }
  return root;
}
