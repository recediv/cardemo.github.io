import * as THREE from '../vendor/three.module.js';
import { applySceneStyle } from './day-cycle.js';
import { randomGenerator } from './simulation.js';

function createDeckTextures() {
  const size = 512, boardSize = size / 4, color = new Uint8Array(size * size * 4), relief = new Uint8Array(size * size);
  const random = randomGenerator(46281), shades = Array.from({ length: 4 }, () => 0.9 + random() * 0.12);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const board = Math.floor(y / boardSize), across = y % boardSize, along = x / size * Math.PI * 2;
    const grain = Math.sin(across * 0.66 + Math.sin(along * 2 + board) * 1.5) * 0.018
      + Math.sin(across * 0.2 + Math.sin(along * 3 + board)) * 0.012;
    const seam = across < 2 || across >= boardSize - 2 ? 1 : 0;
    const tone = shades[board] + grain + (random() - 0.5) * 0.025 - seam * 0.2, index = y * size + x;
    color[index * 4] = Math.round(164 * tone); color[index * 4 + 1] = Math.round(130 * tone);
    color[index * 4 + 2] = Math.round(88 * tone); color[index * 4 + 3] = 255;
    relief[index] = Math.round((0.55 + grain * 2 - seam * 0.25) * 255);
  }
  const map = new THREE.DataTexture(color, size, size, THREE.RGBAFormat), bumpMap = new THREE.DataTexture(relief, size, size, THREE.RedFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [map, bumpMap]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.anisotropy = 4; texture.needsUpdate = true;
  }
  return { map, bumpMap };
}

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
  let deckDistance = 0, previousY = 0;
  for (let i = 0; i <= segments; i++) {
    const z = (i / segments - 0.5) * length, y = rampHeight(z, length, height);
    if (i > 0) deckDistance += Math.hypot(length / segments, y - previousY);
    previousY = y;
    for (const x of [-width / 2, width / 2]) { vertices.push(x, y, z); uvs.push((x + width / 2) / 2, deckDistance / 1.6); }
    if (i < segments) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const deckIndexCount = indices.length;
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
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices);
  geometry.addGroup(0, deckIndexCount, 0); geometry.addGroup(deckIndexCount, indices.length - deckIndexCount, 1);
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

export function addTrackRamps(scene, physics, track, palette, obstacles) {
  const deck = applySceneStyle(new THREE.MeshStandardMaterial({ color: '#ffffff', ...createDeckTextures(), bumpScale: 0.004, roughness: 0.95,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), palette);
  const sides = applySceneStyle(new THREE.MeshStandardMaterial({ color: '#514537', roughness: 1,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), palette);
  const paint = applySceneStyle(new THREE.MeshStandardMaterial({ color: '#efc25c', roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), palette);
  const ramps = findStraightSpots(track, obstacles).map((p, i) => {
    const width = 4, length = 10.5, height = 1.1;
    const geometry = createWedge(width, length, height), ramp = new THREE.Mesh(geometry, [deck, sides]);
    ramp.name = `straight-ramp-${i + 1}`; ramp.position.copy(p.position).setY(track.height); ramp.rotation.y = p.yaw;
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
      arrows.push(x, rampHeight(localZ, length, height) + 0.006, localZ);
    }
    for (const side of [-1, 1]) for (let section = 0; section < 32; section++) {
      const z0 = -length / 2 + 0.24 + section / 32 * (length - 0.48), z1 = -length / 2 + 0.24 + (section + 1) / 32 * (length - 0.48);
      const x0 = side * (width / 2 - 0.18) - 0.035, x1 = x0 + 0.07;
      for (const [x, z] of [[x0, z0], [x0, z1], [x1, z0], [x1, z0], [x0, z1], [x1, z1]]) arrows.push(x, rampHeight(z, length, height) + 0.006, z);
    }
    const markings = new THREE.BufferGeometry(); markings.setAttribute('position', new THREE.Float32BufferAttribute(arrows, 3)); markings.computeVertexNormals();
    const arrowMesh = new THREE.Mesh(markings, paint); arrowMesh.name = 'ramp-guides'; arrowMesh.receiveShadow = true; ramp.add(arrowMesh);
    return {
      mesh: ramp, progress: p.progress,
      surfaceAt(position, result) {
        const dx = position.x - p.position.x, dz = position.z - p.position.z;
        const along = dx * p.tangent.x + dz * p.tangent.z, across = dx * p.tangent.z - dz * p.tangent.x;
        if (Math.abs(along) > length / 2 || Math.abs(across) > width / 2 + 0.8) return false;
        const t = along / length + 0.5, side = THREE.MathUtils.clamp((width / 2 + 0.8 - Math.abs(across)) / 0.8, 0, 1);
        const slope = height / length * t * (4 - 3 * t) * side;
        result.height = track.height + rampHeight(along, length, height) * side;
        result.normal.set(-p.tangent.x * slope, 1, -p.tangent.z * slope);
        if (side < 1) {
          const crossSlope = -Math.sign(across) * rampHeight(along, length, height) / 0.8;
          result.normal.x -= p.tangent.z * crossSlope; result.normal.z += p.tangent.x * crossSlope;
        }
        result.normal.normalize(); return true;
      },
      coversPoint(position, padding = 0) {
        const dx = position.x - p.position.x, dz = position.z - p.position.z;
        const along = dx * p.tangent.x + dz * p.tangent.z, across = dx * p.tangent.z - dz * p.tangent.x;
        return Math.abs(along) < length / 2 + padding && Math.abs(across) < width / 2 + 0.8 + padding;
      },
    };
  });
  if (track.markings) {
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(); let count = 0;
    for (let index = 0; index < track.markings.count; index++) {
      track.markings.getMatrixAt(index, matrix); position.setFromMatrixPosition(matrix);
      if (ramps.some(ramp => ramp.coversPoint(position, 0.8))) continue;
      track.markings.setMatrixAt(count++, matrix);
    }
    track.markings.count = count; track.markings.instanceMatrix.needsUpdate = true;
  }
  return ramps;
}
