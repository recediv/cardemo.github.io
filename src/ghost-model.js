import * as THREE from '../vendor/three.module.js';
import { createRacingCar } from './car-model.js';

let carTemplate, wheelAssets;

function createCarTemplate() {
  const root = createRacingCar(0, { simplified: true }), batches = new Map();
  const point = new THREE.Vector3(), normal = new THREE.Vector3(), normalMatrix = new THREE.Matrix3();
  for (const part of [...root.children]) {
    if (!part.isMesh) continue;
    part.updateMatrix(); normalMatrix.getNormalMatrix(part.matrix);
    let batch = batches.get(part.material);
    if (!batch) batches.set(part.material, batch = { positions: [], normals: [], indices: [] });
    const offset = batch.positions.length / 3, positions = part.geometry.attributes.position, normals = part.geometry.attributes.normal;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(part.matrix);
      normal.fromBufferAttribute(normals, i).applyNormalMatrix(normalMatrix);
      batch.positions.push(point.x, point.y, point.z); batch.normals.push(normal.x, normal.y, normal.z);
    }
    for (let i = 0; i < (part.geometry.index?.count ?? positions.count); i++) batch.indices.push(offset + (part.geometry.index ? part.geometry.index.getX(i) : i));
    root.remove(part); part.geometry.dispose();
  }
  for (const [material, batch] of batches) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
    geometry.setIndex(batch.indices); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material); mesh.name = 'ghost-body-batch'; root.add(mesh);
  }
  root.userData = {};
  return root;
}

export function createGhostCar(centerOfMassOffset = 0) {
  carTemplate ??= createCarTemplate();
  const root = carTemplate.clone(true);
  for (const child of root.children) child.position.y += centerOfMassOffset;
  return root;
}

export function createGhostWheel() {
  wheelAssets ??= {
    tire: new THREE.LatheGeometry([[0.25, -0.15], [0.355, -0.15], [0.4, -0.08], [0.4, 0.08], [0.355, 0.15], [0.25, 0.15]]
      .map(([radius, y]) => new THREE.Vector2(radius, y)), 16).rotateZ(Math.PI / 2),
    rim: new THREE.CylinderGeometry(0.245, 0.245, 0.26, 12).rotateZ(Math.PI / 2),
    tireMaterial: new THREE.MeshStandardMaterial({ color: '#242629', roughness: 0.97, metalness: 0.01 }),
    rimMaterial: new THREE.MeshStandardMaterial({ color: '#c5cdd4', metalness: 0.3, roughness: 0.5 }),
  };
  const root = new THREE.Group(); root.name = 'ghost-wheel';
  for (const [name, geometry, material] of [['rubber-tire', wheelAssets.tire, wheelAssets.tireMaterial], ['alloy-rim', wheelAssets.rim, wheelAssets.rimMaterial]]) {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; root.add(mesh);
  }
  return root;
}
