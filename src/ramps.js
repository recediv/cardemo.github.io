import * as THREE from '../vendor/three.module.js';
import { applySceneStyle } from './day-cycle.js';
import { createBarkTexture } from './vegetation.js';

function findStraightSpots(track, obstacles) {
  const length = track.curve.getLength(), candidates = [], chosen = [];
  for (let i = 0; i < 160; i++) for (const offset of [-1.45, 1.45]) {
    const progress = (i + 0.5) / 160;
    if (Math.min(progress, 1 - progress) < 0.37) continue;
    const p = track.point(progress, offset), forward = p.tangent;
    let bend = 0, turn = 0;
    // Judge both the run-up and the landing corridor, not just the ramp centre.
    for (const distance of [-16, -10, -6, 0, 6, 12, 18, 24, 30, 36]) {
      const sample = track.point(progress + distance / length, offset), delta = sample.position.clone().sub(p.position);
      bend = Math.max(bend, Math.abs(delta.x * forward.z - delta.z * forward.x));
      turn = Math.max(turn, Math.acos(THREE.MathUtils.clamp(sample.tangent.dot(forward), -1, 1)));
    }
    const blocked = obstacles.some(item => {
      const dx = item.position.x - p.position.x, dz = item.position.z - p.position.z;
      const along = dx * forward.x + dz * forward.z, across = Math.abs(dx * forward.z - dz * forward.x);
      return along > -14 && along < 24 && across < 1.75;
    });
    if (!blocked) candidates.push({ ...p, progress, score: bend + turn * 6 });
  }
  candidates.sort((a, b) => a.score - b.score);
  for (const candidate of candidates) {
    if (chosen.some(other => { const gap = Math.abs(other.progress - candidate.progress); return Math.min(gap, 1 - gap) * length < length * 0.24; })) continue;
    chosen.push(candidate); break;
  }
  return chosen;
}

const rampHeight = (z, length, height) => {
  const t = THREE.MathUtils.clamp(z / length + 0.5, 0, 1);
  return height * t * t * (2 - t);
};
function createWedge(width, length, height) {
  const vertices = [], uvs = [], indices = [], segments = 32;
  for (let i = 0; i <= segments; i++) {
    const z = (i / segments - 0.5) * length, y = rampHeight(z, length, height);
    for (const x of [-width / 2, width / 2]) { vertices.push(x, y, z); uvs.push(x / width + 0.5, i / segments * 4); }
    if (i < segments) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const triangle = (a, b, c) => {
    const first = vertices.length / 3;
    for (const [x, y, z] of [a, b, c]) { vertices.push(x, y, z); uvs.push(x / width + 0.5, z / length * 4); }
    indices.push(first, first + 1, first + 2);
  };
  for (let i = 0; i < segments; i++) for (const side of [-1, 1]) {
    const z0 = (i / segments - 0.5) * length, z1 = ((i + 1) / segments - 0.5) * length, x = side * width / 2;
    const a = [x + side * 0.8, 0, z0], b = [x, rampHeight(z0, length, height), z0], c = [x, rampHeight(z1, length, height), z1], d = [x + side * 0.8, 0, z1];
    if (side < 0) { triangle(a, c, b); triangle(a, d, c); } else { triangle(a, b, c); triangle(a, c, d); }
  }
  const z = length / 2;
  triangle([-width / 2, height, z], [-width / 2 - 0.8, 0, z], [width / 2, height, z]);
  triangle([width / 2, height, z], [-width / 2 - 0.8, 0, z], [width / 2 + 0.8, 0, z]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

export function addTrackRamps(scene, physics, track, palette, obstacles) {
  const material = applySceneStyle(new THREE.MeshStandardMaterial({ color: '#ae986f', map: createBarkTexture('brown'), roughness: 0.95 }), palette);
  const paint = applySceneStyle(new THREE.MeshStandardMaterial({ color: '#efc25c', roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), palette);
  return findStraightSpots(track, obstacles).map((p, i) => {
    const width = 4, length = 10.5, height = 1.1;
    const geometry = createWedge(width, length, height), ramp = new THREE.Mesh(geometry, material);
    ramp.name = `straight-ramp-${i + 1}`; ramp.position.copy(p.position).setY(track.height - 0.004); ramp.rotation.y = p.yaw;
    ramp.castShadow = ramp.receiveShadow = true; scene.add(ramp); ramp.updateMatrixWorld(true);
    // Convex sections share the visible curved profile. Bullet sees solid
    // surfaces, rather than a triangle mesh with exposed internal edges.
    const A = physics.A, shape = new A.btCompoundShape(), point = new A.btVector3(), transform = new A.btTransform();
    transform.setIdentity();
    for (let section = 0; section < 32; section++) {
      const z0 = (section / 32 - 0.5) * length, z1 = ((section + 1) / 32 - 0.5) * length;
      const part = new A.btConvexHullShape();
      for (const z of [z0, z1]) for (const side of [-1, 1]) {
        point.setValue(side * width / 2, rampHeight(z, length, height), z); part.addPoint(point, true);
        point.setValue(side * (width / 2 + 0.8), -0.02, z); part.addPoint(point, true);
      }
      part.setMargin(0.002); shape.addChildShape(transform, part); physics.shapes.push(part);
    }
    A.destroy(point); A.destroy(transform);
    const body = physics.body(null, shape, ramp.position.clone(), 0, 0.45, ramp.quaternion.clone());
    body.body.setRestitution(0);
    const arrows = [];
    for (const z of [-1.6, 0, 1.6]) for (const [x, localZ] of [[-0.72, z - 0.45], [0, z + 0.45], [-0.52, z - 0.45],
      [-0.52, z - 0.45], [0, z + 0.45], [0, z + 0.17], [0, z + 0.45], [0.72, z - 0.45], [0.52, z - 0.45],
      [0, z + 0.45], [0.52, z - 0.45], [0, z + 0.17]]) {
      arrows.push(x, rampHeight(localZ, length, height) + 0.014, localZ);
    }
    const markings = new THREE.BufferGeometry(); markings.setAttribute('position', new THREE.Float32BufferAttribute(arrows, 3)); markings.computeVertexNormals();
    const arrowMesh = new THREE.Mesh(markings, paint); arrowMesh.receiveShadow = true; ramp.add(arrowMesh);
    return { mesh: ramp, progress: p.progress };
  });
}
