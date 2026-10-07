import * as THREE from '../vendor/three.module.js';

// The visible surfaces and the physical hulls share these vertices.
const bodySections = [
  [-1.6, 0.75, -0.19, 0.24], [-1.02, 0.81, -0.23, 0.32],
  [0.55, 0.8, -0.23, 0.29], [1.4, 0.73, -0.12, 0.17], [1.64, 0.66, -0.055, 0.11],
];
const bodyRings = bodySections.map(([z, width, bottom, top]) => [
  [-width + 0.08, bottom, z], [width - 0.08, bottom, z],
  [width, bottom + 0.06, z], [width, top - 0.05, z],
  [width - 0.1, top, z], [-width + 0.1, top, z],
  [-width, top - 0.05, z], [-width, bottom + 0.06, z],
]);
const cabinRings = [
  [-1.04, 0.67, 0.62, 0.30, 0.35], [-0.65, 0.68, 0.54, 0.30, 0.73],
  [0.12, 0.66, 0.54, 0.29, 0.71], [0.62, 0.64, 0.61, 0.285, 0.31],
].map(([z, bottomWidth, topWidth, bottom, top]) => [
  [-bottomWidth, bottom, z], [bottomWidth, bottom, z], [topWidth, top, z], [-topWidth, top, z],
]);

export const RACING_COLLIDERS = [
  { name: 'body', size: [1.62, 0.55, 3.24], position: [0, 0, 0], points: bodyRings.flat() },
  { name: 'cabin', size: [1.36, 0.45, 1.66], position: [0, 0, 0], points: cabinRings.flat() },
  { name: 'spoiler', size: [1.78, 0.075, 0.28], position: [0, 0.65, -1.35] },
  ...[-1, 1].flatMap(side => [1, -1.04].flatMap(z => [
    // Surround the tire without intersecting the vertical suspension ray.
    { name: 'wheel-guard', size: [0.1, 0.52, 0.84], position: [side, -0.1, z] },
    ...[-1, 1].map(end => ({ name: 'wheel-guard', size: [0.36, 0.52, 0.08], position: [side * 0.86, -0.1, z + end * 0.38] })),
  ])),
];

function loft(rings) {
  const points = rings.flat(), positions = [], indices = [], sides = rings[0].length;
  for (const point of points) positions.push(...point);
  for (let ring = 0; ring < rings.length - 1; ring++) for (let side = 0; side < sides; side++) {
    const a = ring * sides + side, b = ring * sides + (side + 1) % sides;
    indices.push(a, b, a + sides, b, b + sides, a + sides);
  }
  for (let i = 1; i < sides - 1; i++) {
    indices.push(0, i + 1, i);
    const end = (rings.length - 1) * sides;
    indices.push(end, end + i, end + i + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

function numberTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff8e8'; context.beginPath(); context.arc(128, 128, 117, 0, Math.PI * 2); context.fill();
  context.strokeStyle = '#192129'; context.lineWidth = 7; context.stroke();
  context.fillStyle = '#192129'; context.font = '900 146px Arial, sans-serif';
  context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('27', 128, 138);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createRacingCar() {
  const root = new THREE.Group(); root.name = 'racing-coupe-27';
  const paint = new THREE.MeshStandardMaterial({ color: '#d82d32', roughness: 0.3, metalness: 0.22 });
  const white = new THREE.MeshStandardMaterial({ color: '#fff3df', roughness: 0.35, metalness: 0.1 });
  const trim = new THREE.MeshStandardMaterial({ color: '#182127', roughness: 0.62, metalness: 0.1 });
  const glass = new THREE.MeshStandardMaterial({ color: '#243944', roughness: 0.12, metalness: 0.45 });
  const mesh = (geometry, material, name) => {
    const item = new THREE.Mesh(geometry, material); item.name = name;
    item.castShadow = item.receiveShadow = true; root.add(item); return item;
  };
  const box = (size, position, material, name) => {
    const item = mesh(new THREE.BoxGeometry(...size), material, name); item.position.set(...position); return item;
  };
  const beam = (start, end, width, material) => {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end), direction = b.clone().sub(a);
    const item = box([width, direction.length(), width], a.add(b).multiplyScalar(0.5).toArray(), material, 'window-pillar');
    item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  };
  mesh(loft(bodyRings), paint, 'tapered-body');
  mesh(loft(cabinRings), glass, 'sloping-windows');
  box([1.13, 0.045, 0.83], [0, 0.735, -0.27], paint, 'low-roof').rotation.x = 0.026;
  box([1.78, 0.075, 0.28], [0, 0.65, -1.35], trim, 'rear-wing');
  for (const side of [-1, 1]) {
    box([0.075, 0.29, 0.075], [side * 0.53, 0.48, -1.35], trim, 'wing-support');
    box([0.055, 0.13, 0.32], [side * 0.87, 0.685, -1.35], paint, 'wing-endplate');
    beam([side * 0.64, 0.3, 0.59], [side * 0.54, 0.72, 0.1], 0.052, paint);
    beam([side * 0.66, 0.31, -1.0], [side * 0.54, 0.73, -0.63], 0.055, paint);
    // Two white racing stripes follow the actual bonnet and rear deck slopes.
    const vertices = [];
    for (let i = 0; i < bodySections.length - 1; i++) {
      const [za, , , ya] = bodySections[i], [zb, , , yb] = bodySections[i + 1];
      if (za < 0.55 && zb > -1.02) continue;
      const x = side * 0.22, half = 0.085;
      for (const point of [[x - half, ya + 0.006, za], [x - half, yb + 0.006, zb], [x + half, ya + 0.006, za],
        [x + half, ya + 0.006, za], [x - half, yb + 0.006, zb], [x + half, yb + 0.006, zb]]) vertices.push(...point);
    }
    const stripe = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    stripe.computeVertexNormals(); mesh(stripe, white, 'racing-stripe');
    box([0.17, 0.006, 0.8], [side * 0.22, 0.764, -0.27], white, 'roof-stripe').rotation.x = 0.026;
    const vent = box([0.13, 0.009, 0.38], [side * 0.49, 0.228, 0.98], trim, 'bonnet-vent'); vent.rotation.x = 0.14;
    box([0.075, 0.105, 0.26], [side * 0.805, 0.14, -0.5], trim, 'side-air-intake');
  }
  box([0.78, 0.075, 0.025], [0, 0.017, 1.655], trim, 'front-air-intake');
  box([1.05, 0.09, 0.05], [0, -0.035, -1.61], trim, 'rear-diffuser');
  const lamps = new THREE.MeshStandardMaterial({ color: '#fff4da', emissive: '#fff0c8', emissiveIntensity: 0 });
  const tails = new THREE.MeshStandardMaterial({ color: '#d0242c', emissive: '#ff2024', emissiveIntensity: 0.3 });
  for (const side of [-1, 1]) {
    box([0.25, 0.08, 0.035], [side * 0.54, 0.097, 1.652], lamps, 'headlamp');
    box([0.37, 0.055, 0.035], [side * 0.5, 0.15, -1.614], tails, 'rear-lamp');
  }
  const number = new THREE.MeshStandardMaterial({ map: numberTexture(), transparent: true, alphaTest: 0.1, roughness: 0.45, toneMapped: false });
  for (const side of [-1, 1]) {
    const decal = mesh(new THREE.PlaneGeometry(0.43, 0.43), number, 'race-number');
    decal.position.set(side * 0.813, 0.07, -0.12); decal.rotation.y = side * Math.PI / 2;
    decal.castShadow = false;
  }
  root.userData.lampMaterial = lamps; root.userData.tailMaterial = tails;
  return root;
}
