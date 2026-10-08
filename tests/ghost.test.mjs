import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../vendor/three.module.js';
import { createRacingCar } from '../src/car-model.js';
import { createRacingWheel } from '../src/wheels.js';
import { BestLapGhost } from '../src/ghost.js';
import { withCanvas } from './canvas.mjs';

function fixture() {
  const mesh = withCanvas(() => createRacingCar(0.18));
  return { mesh, item: mesh, centerOfMassOffset: 0.18, recoveries: 0,
    wheels: Array.from({ length: 4 }, () => ({ mesh: createRacingWheel(), position: new THREE.Vector3(), quaternion: new THREE.Quaternion() })) };
}

function cost(objects) {
  const geometries = new Set(); let meshes = 0, triangles = 0;
  for (const root of objects) root.traverse(part => {
    if (!part.isMesh) return;
    meshes++; triangles += (part.geometry.index?.count ?? part.geometry.attributes.position.count) / 3;
    geometries.add(part.geometry);
  });
  let bytes = 0;
  for (const geometry of geometries) {
    for (const attribute of Object.values(geometry.attributes)) bytes += attribute.array.byteLength;
    bytes += geometry.index?.array.byteLength ?? 0;
  }
  return { meshes, triangles, bytes };
}

test('Lightweight ghosts share cached geometry without lights, shadows, textures or mechanical details', t => {
  const vehicle = fixture(), scene = new THREE.Scene();
  const ghost = new BestLapGhost(scene, vehicle), other = new BestLapGhost(scene, vehicle);
  const full = cost([vehicle.mesh, ...vehicle.wheels.map(wheel => wheel.mesh)]), light = cost([ghost.group]);
  assert.ok(light.meshes <= 16 && light.meshes < full.meshes / 2);
  assert.ok(light.triangles < full.triangles / 4 && light.bytes < full.bytes / 4);
  const parts = [], otherParts = []; ghost.group.traverse(part => { if (part.isMesh) parts.push(part); });
  other.group.traverse(part => { if (part.isMesh) otherParts.push(part); });
  assert.equal(parts.length, otherParts.length);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]; assert.equal(part.geometry, otherParts[i].geometry);
    assert.notEqual(part.material, otherParts[i].material);
    assert.ok(part.material.isMeshStandardMaterial && part.material.transparent && !part.material.depthWrite);
    assert.equal(part.material.opacity, 0.3); assert.equal(part.castShadow, false); assert.equal(part.receiveShadow, false);
    assert.equal(part.material.map, null); assert.equal(part.material.bumpMap, null);
    for (const attribute of Object.values(part.geometry.attributes)) for (const value of attribute.array) assert.ok(Number.isFinite(value));
  }
  const forbidden = /underbody|underglow|exhaust|brake-disc|race-number|popup-light-source|popup-headlight-lens/;
  ghost.group.traverse(part => { assert.ok(!part.isLight && !part.isPoints); assert.doesNotMatch(part.name, forbidden); });
  const body = ghost.mesh.getObjectByName('ghost-body-batch');
  const realColour = vehicle.mesh.getObjectByName('tapered-body').material[0].color;
  assert.ok(new THREE.Vector3(...body.material.color.toArray()).distanceTo(new THREE.Vector3(...realColour.toArray())) > 0.5);
  const originalOpacity = vehicle.mesh.getObjectByName('tapered-body').material[0].opacity;
  body.material.opacity = 0.2;
  assert.equal(other.mesh.getObjectByName('ghost-body-batch').material.opacity, 0.3);
  assert.equal(vehicle.mesh.getObjectByName('tapered-body').material[0].opacity, originalOpacity);
  t.diagnostic(`Full car: ${full.meshes} meshes, ${full.triangles} triangles; ghost: ${light.meshes} meshes, ${light.triangles} triangles, ${light.bytes} geometry bytes`);
});

test('Simplifying the ghost preserves body and wheel interpolation and only the best valid lap', () => {
  const vehicle = fixture(), ghost = new BestLapGhost(new THREE.Scene(), vehicle);
  vehicle.item.position.set(12, 3, 20); vehicle.item.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  for (let i = 0; i < 4; i++) { vehicle.wheels[i].position.set(i, 0.4, 10); vehicle.wheels[i].quaternion.copy(vehicle.item.quaternion); }
  ghost.capture(4); ghost.step(1 / 60, { lastLap: 4 }, true);
  const best = ghost.best, saved = best.map(frame => [...frame.poses]);
  ghost.render(2); assert.equal(ghost.group.visible, true);
  assert.ok(ghost.mesh.position.distanceTo(new THREE.Vector3(6, 1.5, 10)) < 1e-6);
  assert.ok(ghost.mesh.quaternion.clone().normalize().angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4)) < 1e-6);
  for (let i = 0; i < 4; i++) assert.ok(ghost.wheels[i].position.distanceTo(new THREE.Vector3(i / 2, 0.2, 5)) < 1e-6);
  ghost.capture(5); ghost.step(1 / 60, { lastLap: 6 }, true);
  assert.equal(ghost.best, best); assert.deepEqual(best.map(frame => [...frame.poses]), saved);
  vehicle.recoveries++; ghost.step(1 / 60, { running: true, time: 1 }, false); ghost.step(1 / 60, { lastLap: 3 }, true);
  assert.equal(ghost.best, best);
  ghost.capture(2); ghost.step(1 / 60, { lastLap: 2 }, true);
  assert.notEqual(ghost.best, best); assert.equal(ghost.bestDuration, 2);
  const faster = ghost.best; ghost.reset(); assert.equal(ghost.best, faster);
  ghost.render(-1); assert.equal(ghost.group.visible, false);
  ghost.render(3); assert.equal(ghost.group.visible, false);
});
