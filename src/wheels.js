import * as THREE from '../vendor/three.module.js';
import { randomGenerator, smoothstep } from './simulation.js';

let wheelAssets;

function rubberTextures() {
  const width = 512, height = 256, color = new Uint8Array(width * height * 4), relief = new Uint8Array(width * height);
  const random = randomGenerator(75193);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height;
    const tread = smoothstep(0.25, 0.32, v) * (1 - smoothstep(0.68, 0.75, v));
    const phase = u * 32 + Math.abs(v - 0.5) * 5, row = phase - Math.floor(phase);
    let groove = 1 - smoothstep(0.045, 0.105, Math.min(row, 1 - row));
    for (const channel of [0.36, 0.46, 0.54, 0.64]) groove = Math.max(groove, 1 - smoothstep(0.005, 0.013, Math.abs(v - channel)));
    const recess = groove * tread;
    const sidewall = (1 - tread) * Math.sin(v * Math.PI * 60) ** 12;
    const tone = 0.95 - recess * 0.34 - sidewall * 0.035 + (random() - 0.5) * 0.035;
    const index = y * width + x, value = Math.round(tone * 255);
    color[index * 4] = color[index * 4 + 1] = color[index * 4 + 2] = value; color[index * 4 + 3] = 255;
    relief[index] = Math.round((0.76 - recess * 0.5 - sidewall * 0.04) * 255);
  }
  const map = new THREE.DataTexture(color, width, height, THREE.RGBAFormat), bumpMap = new THREE.DataTexture(relief, width, height, THREE.RedFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [map, bumpMap]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.anisotropy = 4; texture.needsUpdate = true;
  }
  return { map, bumpMap };
}

function joinParts(parts) {
  const positions = [], normals = [], uvs = [], indices = [];
  for (const part of parts) {
    const first = positions.length / 3, p = part.attributes.position, n = part.attributes.normal, uv = part.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i)); normals.push(n.getX(i), n.getY(i), n.getZ(i));
      uvs.push(uv?.getX(i) ?? 0, uv?.getY(i) ?? 0);
    }
    for (let i = 0; i < (part.index?.count ?? p.count); i++) indices.push(first + (part.index ? part.index.getX(i) : i));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeBoundingSphere();
  return geometry;
}

function createAssets() {
  const profile = [[0.25, -0.15], [0.3, -0.16], [0.355, -0.155], [0.388, -0.126], [0.4, -0.08], [0.4, 0],
    [0.4, 0.08], [0.388, 0.126], [0.355, 0.155], [0.3, 0.16], [0.25, 0.15]].map(([r, y]) => new THREE.Vector2(r, y));
  const tire = new THREE.LatheGeometry(profile, 48).rotateZ(Math.PI / 2);
  const tireMaterial = new THREE.MeshStandardMaterial({ color: '#242629', ...rubberTextures(), bumpScale: 0.012, roughness: 0.97, metalness: 0.01 });

  const spokeShape = new THREE.Shape();
  spokeShape.moveTo(-0.028, 0.045); spokeShape.lineTo(0.029, 0.045); spokeShape.lineTo(0.043, 0.208);
  spokeShape.lineTo(0.025, 0.248); spokeShape.lineTo(-0.028, 0.238); spokeShape.lineTo(-0.041, 0.2); spokeShape.closePath();
  const spoke = new THREE.ExtrudeGeometry(spokeShape, { depth: 0.026, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.005, bevelThickness: 0.004 })
    .translate(0, 0, -0.013).rotateY(Math.PI / 2);
  const lip = new THREE.TorusGeometry(0.25, 0.016, 8, 48).rotateY(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.066, 0.066, 0.046, 24).rotateZ(Math.PI / 2);
  const bolt = new THREE.SphereGeometry(0.011, 6, 4), metalParts = [new THREE.CylinderGeometry(0.246, 0.246, 0.28, 48, 1, true).rotateZ(Math.PI / 2)];
  const rotor = new THREE.RingGeometry(0.074, 0.213, 48).rotateY(Math.PI / 2), rotorParts = [];
  for (const side of [-1, 1]) {
    metalParts.push(lip.clone().translate(side * 0.151, 0, 0), hub.clone().translate(side * 0.154, 0, 0));
    rotorParts.push(rotor.clone().translate(side * 0.113, 0, 0));
    for (let i = 0; i < 6; i++) {
      const angle = i / 6 * Math.PI * 2;
      metalParts.push(spoke.clone().rotateX(angle).translate(side * 0.145, 0, 0));
      metalParts.push(bolt.clone().translate(side * 0.182, Math.cos(angle) * 0.045, Math.sin(angle) * 0.045));
    }
  }
  return {
    tire, tireMaterial, rim: joinParts(metalParts), rotor: joinParts(rotorParts),
    rimMaterial: new THREE.MeshStandardMaterial({ color: '#c5cdd4', metalness: 0.62, roughness: 0.28 }),
    rotorMaterial: new THREE.MeshStandardMaterial({ color: '#424950', metalness: 0.35, roughness: 0.6, side: THREE.DoubleSide }),
  };
}

export function createRacingWheel() {
  wheelAssets ??= createAssets();
  const root = new THREE.Group(); root.name = 'six-spoke-racing-wheel';
  for (const [name, geometry, material] of [['rubber-tire', wheelAssets.tire, wheelAssets.tireMaterial],
    ['alloy-rim', wheelAssets.rim, wheelAssets.rimMaterial], ['brake-disc', wheelAssets.rotor, wheelAssets.rotorMaterial]]) {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
  }
  return root;
}
