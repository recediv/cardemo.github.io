import * as THREE from '../vendor/three.module.js';
import { createUnderglowStrips } from './underglow.js';
import { createBodyShellGeometry, createUnderbodyMechanism, EXHAUST_TIP } from './underbody.js';
import { FRONT_OPENINGS, createCarFront } from './car-front.js';
import { createCarExterior } from './car-body.js';
import { createCarGlass, createWindowFrames, createCabinFrameGeometry, createCabinGlassGeometry } from './car-glass.js';

export const POPUP_OPEN_ANGLE = -0.95;
const POPUP_HEADLIGHT = { x: 0.415, z: 1.115, width: 0.35, length: 0.37, seam: 0.006 };

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

let racingNumberTexture;

function numberTexture() {
  if (racingNumberTexture) return racingNumberTexture;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff8e8'; context.beginPath(); context.arc(128, 128, 117, 0, Math.PI * 2); context.fill();
  context.strokeStyle = '#192129'; context.lineWidth = 7; context.stroke();
  context.fillStyle = '#192129'; context.font = '900 146px Arial, sans-serif';
  context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('27', 128, 138);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return racingNumberTexture = texture;
}

function bodyTop(z) {
  for (let i = 1; i < bodySections.length; i++) {
    const a = bodySections[i - 1], b = bodySections[i];
    if (z <= b[0]) return THREE.MathUtils.lerp(a[3], b[3], (z - a[0]) / (b[0] - a[0]));
  }
  return bodySections[bodySections.length - 1][3];
}

function appendTopPanel(positions, xMin, xMax, zMin, zMax, offset) {
  if (xMax <= xMin || zMax <= zMin) return;
  const stations = [zMin, ...bodySections.map(section => section[0]).filter(z => z > zMin && z < zMax), zMax];
  for (let i = 0; i < stations.length - 1; i++) {
    const za = stations[i], zb = stations[i + 1], ya = bodyTop(za) + offset, yb = bodyTop(zb) + offset;
    positions.push(xMin, ya, za, xMin, yb, zb, xMax, ya, za,
      xMax, ya, za, xMin, yb, zb, xMax, yb, zb);
  }
}

export function createRacingCar(centerOfMassOffset = 0, { simplified = false } = {}) {
  const root = new THREE.Group(); root.name = 'racing-coupe-27';
  const paint = new THREE.MeshStandardMaterial({ color: '#d82d32', roughness: 0.3, metalness: 0.22 });
  const white = new THREE.MeshStandardMaterial({ color: '#fff3df', roughness: 0.35, metalness: 0.1 });
  const stripePaint = white.clone();
  stripePaint.polygonOffset = true; stripePaint.polygonOffsetFactor = -1; stripePaint.polygonOffsetUnits = -1;
  const trim = new THREE.MeshStandardMaterial({ color: '#182127', roughness: 0.62, metalness: 0.1 });
  const glass = createCarGlass(simplified);
  const mesh = (geometry, material, name) => {
    const item = new THREE.Mesh(geometry, material); item.name = name;
    item.castShadow = item.receiveShadow = true; root.add(item); return item;
  };
  const box = (size, position, material, name) => {
    const item = mesh(new THREE.BoxGeometry(...size), material, name); item.position.set(...position); return item;
  };
  mesh(simplified ? loft(bodyRings) : createBodyShellGeometry(bodyRings, FRONT_OPENINGS), simplified ? paint : [paint, trim], 'tapered-body');
  mesh(createCabinGlassGeometry(cabinRings), glass, 'sloping-windows');
  if (!simplified) {
    mesh(createCabinFrameGeometry(cabinRings), paint, 'cabin-frame');
    mesh(createWindowFrames(cabinRings), trim, 'window-gaskets').castShadow = false;
  }
  box([1.13, 0.045, 0.83], [0, 0.735, -0.27], paint, 'low-roof').rotation.x = 0.026;
  box([1.78, 0.075, 0.28], [0, 0.65, -1.35], trim, 'rear-wing');
  for (const side of [-1, 1]) {
    if (!simplified) {
      box([0.075, 0.29, 0.075], [side * 0.53, 0.48, -1.35], trim, 'wing-support');
      box([0.055, 0.13, 0.32], [side * 0.87, 0.685, -1.35], paint, 'wing-endplate');
    }
    // Fixed stripes stop at the moving headlight covers.
    const vertices = [];
    const stripeMin = side * 0.22 - 0.085, stripeMax = side * 0.22 + 0.085;
    const holeMin = side * POPUP_HEADLIGHT.x - POPUP_HEADLIGHT.width / 2 - POPUP_HEADLIGHT.seam;
    const holeMax = side * POPUP_HEADLIGHT.x + POPUP_HEADLIGHT.width / 2 + POPUP_HEADLIGHT.seam;
    const holeStart = POPUP_HEADLIGHT.z, holeEnd = holeStart + POPUP_HEADLIGHT.length;
    for (let i = 0; i < bodySections.length - 1; i++) {
      const [za] = bodySections[i], [zb] = bodySections[i + 1];
      if (za < 0.55 && zb > -1.02) continue;
      if (zb <= holeStart || za >= holeEnd) {
        appendTopPanel(vertices, stripeMin, stripeMax, za, zb, 0.006);
        continue;
      }
      const start = Math.max(za, holeStart), end = Math.min(zb, holeEnd);
      appendTopPanel(vertices, stripeMin, stripeMax, za, start, 0.006);
      appendTopPanel(vertices, stripeMin, Math.min(stripeMax, holeMin), start, end, 0.006);
      appendTopPanel(vertices, Math.max(stripeMin, holeMax), stripeMax, start, end, 0.006);
      appendTopPanel(vertices, stripeMin, stripeMax, end, zb, 0.006);
    }
    const stripe = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    stripe.computeVertexNormals(); mesh(stripe, stripePaint, 'racing-stripe').castShadow = false;
    box([0.17, 0.006, 0.8], [side * 0.22, 0.764, -0.27], simplified ? stripePaint : white, 'roof-stripe').rotation.x = 0.026;
    if (!simplified) {
      const vent = box([0.13, 0.009, 0.29], [side * 0.49, bodyTop(0.87) + 0.004, 0.87], trim, 'bonnet-vent'); vent.rotation.x = 0.14;
    }
  }
  box([1.05, 0.09, 0.05], [0, -0.035, -1.61], trim, 'rear-diffuser');
  const lamps = simplified ? stripePaint : new THREE.MeshStandardMaterial({ color: '#edf0eb', emissive: '#fffaf2', emissiveIntensity: 0 });
  const popupLamps = simplified ? null : new THREE.MeshStandardMaterial({ color: '#e8edf1', emissive: '#fff4e5', emissiveIntensity: 0, roughness: 0.18, metalness: 0.12 });
  const tails = simplified ? paint : new THREE.MeshStandardMaterial({ color: '#d0242c', emissive: '#ff0808', emissiveIntensity: 0 });
  const reverseLamps = simplified ? null : new THREE.MeshStandardMaterial({ color: '#cbd0d1', emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.25 });
  const exhaustMetal = simplified ? null : new THREE.MeshStandardMaterial({ color: '#9ca4aa', roughness: 0.3, metalness: 0.65 });
  const exhaustInside = simplified ? null : new THREE.MeshStandardMaterial({ color: '#090c0e', roughness: 1, side: THREE.DoubleSide });
  const exteriorMaterials = { paint, trim, metal: exhaustMetal };
  for (const part of createCarExterior(bodySections, cabinRings, simplified)) {
    const item = mesh(part.geometry, exteriorMaterials[part.material], part.name);
    item.castShadow = false;
  }
  const exhaustOutlets = [];
  if (simplified) {
    box([1.16, 0.06, 0.064], [0, -0.005, 1.606], paint, 'front-bumper');
    box([0.56, 0.028, 0.007], [0, 0.07, 1.641], trim, 'front-air-intake');
    for (const side of [-1, 1]) box([0.148, 0.03, 0.006], [side * 0.43, 0.073, 1.645], lamps, 'front-marker');
  } else root.add(createCarFront(paint, trim, lamps, 'front-marker'));
  for (const side of [-1, 1]) {
    box([0.37, 0.055, 0.035], [side * 0.5, 0.15, -1.614], tails, 'rear-lamp');
    if (!simplified) {
      box([0.108, 0.072, 0.035], [side * 0.255, 0.15, -1.615], trim, 'reverse-lamp-frame');
      box([0.084, 0.05, 0.038], [side * 0.255, 0.15, -1.62], reverseLamps, 'reverse-lamp');
    }

    const popupX = side * POPUP_HEADLIGHT.x, popupZ = POPUP_HEADLIGHT.z, hingeY = bodyTop(popupZ) + 0.01;
    const coverGeometry = (halfWidth, offset, thickness) => {
      const geometry = loft([0, 1.4 - popupZ, POPUP_HEADLIGHT.length].map(z => {
        const y = bodyTop(popupZ + z) + offset - hingeY;
        return [[-halfWidth, y - thickness, z], [halfWidth, y - thickness, z], [halfWidth, y, z], [-halfWidth, y, z]];
      })).toNonIndexed();
      geometry.computeVertexNormals();
      return geometry;
    };
    const recess = mesh(coverGeometry(POPUP_HEADLIGHT.width / 2 + POPUP_HEADLIGHT.seam, 0.002, 0.006), trim, 'headlight-recess');
    recess.position.set(popupX, hingeY, popupZ);
    const popup = new THREE.Group(); popup.name = side < 0 ? 'popup-headlight-left' : 'popup-headlight-right';
    popup.position.set(popupX, hingeY, popupZ); root.add(popup);
    const lid = new THREE.Mesh(coverGeometry(POPUP_HEADLIGHT.width / 2, 0.006, 0.025), paint);
    lid.name = 'headlight-cover';
    lid.castShadow = lid.receiveShadow = true; popup.add(lid);
    const coverStripeVertices = [];
    appendTopPanel(coverStripeVertices, Math.max(side * 0.22 - 0.085, popupX - POPUP_HEADLIGHT.width / 2),
      Math.min(side * 0.22 + 0.085, popupX + POPUP_HEADLIGHT.width / 2), popupZ, popupZ + POPUP_HEADLIGHT.length, 0.006);
    const coverStripeGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(coverStripeVertices, 3));
    coverStripeGeometry.translate(-popupX, -hingeY, -popupZ); coverStripeGeometry.computeVertexNormals();
    const coverStripe = new THREE.Mesh(coverStripeGeometry, stripePaint); coverStripe.name = 'headlight-cover-stripe';
    coverStripe.receiveShadow = true; popup.add(coverStripe);
    if (simplified) continue;
    const face = new THREE.Group(); face.position.set(0, -0.124, 0.3); face.rotation.x = -POPUP_OPEN_ANGLE + 0.05; popup.add(face);
    const top = new THREE.Vector3(0, 0.083, 0).applyQuaternion(face.quaternion).add(face.position);
    const bottom = new THREE.Vector3(0, -0.083, 0).applyQuaternion(face.quaternion).add(face.position);
    const housing = new THREE.Mesh(loft([
      [[-0.161, -0.105, 0.05], [0.161, -0.105, 0.05], [0.161, -0.032, 0.018], [-0.161, -0.032, 0.018]],
      [[-0.161, bottom.y, bottom.z], [0.161, bottom.y, bottom.z], [0.161, top.y, top.z], [-0.161, top.y, top.z]],
    ]), trim);
    housing.name = 'headlight-housing'; housing.castShadow = housing.receiveShadow = true; popup.add(housing);
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.276, 0.12), popupLamps);
    lens.name = 'popup-headlight-lens'; lens.position.z = 0.006; lens.receiveShadow = true; face.add(lens);
    const source = new THREE.Object3D(); source.name = 'popup-light-source'; source.position.z = 0.016; face.add(source);

    if (side > 0) {
      // The chassis points along +Z, so +X is its left side.
      const pipe = mesh(new THREE.LatheGeometry([
        [0.052, 0.13], [0.05, -0.121], [0.051, -0.133], [0.062, -0.133],
        [0.065, -0.121], [0.062, -0.104], [0.061, 0.13], [0.052, 0.13],
      ].map(([radius, length]) => new THREE.Vector2(radius, length)), 24), exhaustMetal, 'exhaust-tip');
      pipe.rotation.x = Math.PI / 2; pipe.position.set(EXHAUST_TIP.x, EXHAUST_TIP.y, EXHAUST_TIP.z);
      const inner = mesh(new THREE.CylinderGeometry(0.051, 0.051, 0.21, 20, 1, true), exhaustInside, 'exhaust-inner');
      inner.rotation.x = Math.PI / 2; inner.position.set(EXHAUST_TIP.x, EXHAUST_TIP.y, EXHAUST_TIP.z - 0.023);
      const end = mesh(new THREE.CircleGeometry(0.051, 20), exhaustInside, 'exhaust-dark-end');
      end.rotation.y = Math.PI; end.position.set(EXHAUST_TIP.x, EXHAUST_TIP.y, EXHAUST_TIP.z + 0.083);
      exhaustOutlets.push(new THREE.Vector3(EXHAUST_TIP.x, EXHAUST_TIP.y, EXHAUST_TIP.z - 0.141));
    }
  }
  if (!simplified) {
    const number = new THREE.MeshStandardMaterial({ map: numberTexture(), transparent: true, alphaTest: 0.1, roughness: 0.45, toneMapped: false });
    for (const side of [-1, 1]) {
      const decal = mesh(new THREE.PlaneGeometry(0.43, 0.43), number, 'race-number');
      decal.position.set(side * 0.813, 0.07, -0.12); decal.rotation.y = side * Math.PI / 2;
      decal.castShadow = false;
    }
  }
  root.userData.lampMaterial = lamps; root.userData.popupLampMaterial = popupLamps; root.userData.tailMaterial = tails;
  root.userData.reverseLampMaterial = reverseLamps;
  root.userData.glassMaterial = glass;
  root.userData.exhaustOutlets = exhaustOutlets;
  if (!simplified) {
    root.add(createUnderbodyMechanism());
    const underglow = createUnderglowStrips(bodySections); root.add(underglow);
    root.userData.underglowMaterial = underglow.material; root.userData.underglowMesh = underglow;
  }
  for (const child of root.children) child.position.y += centerOfMassOffset;
  return root;
}
