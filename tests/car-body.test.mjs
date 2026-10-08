import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../vendor/three.module.js';
import { createRacingCar } from '../src/car-model.js';
import { createRacingWheel } from '../src/wheels.js';
import { WheelSuspension } from '../src/suspension.js';
import { withCanvas } from './canvas.mjs';

test('Both sides retain fitted door seams and separate flush handles', () => {
  const car = withCanvas(() => createRacingCar()); car.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  for (const name of ['door-seams', 'door-handles', 'cabin-frame']) {
    const part = car.getObjectByName(name); assert.ok(part, name);
    for (const attribute of Object.values(part.geometry.attributes)) for (const value of attribute.array) assert.ok(Number.isFinite(value));
    part.geometry.computeBoundingBox(); assert.ok(part.geometry.boundingBox.min.x < -0.5 && part.geometry.boundingBox.max.x > 0.5);
  }
  for (const side of [-1, 1]) {
    ray.set(new THREE.Vector3(side * 2, 0.208, -0.446), new THREE.Vector3(-side, 0, 0));
    const hit = ray.intersectObject(car, true)[0];
    assert.equal(hit?.object.name, 'door-handles');
    assert.ok(Math.abs(hit.point.x) < 0.83, 'Handle must sit in the door rather than float beside it');
  }
});

test('Glass, door frames and window seals fit the same mirrored surface on both sides', () => {
  const car = withCanvas(() => createRacingCar()); car.updateMatrixWorld(true);
  const glass = car.getObjectByName('sloping-windows'), ray = new THREE.Raycaster();
  let samples = 0;
  for (let y = 0.325; y < 0.71; y += 0.027) for (let z = -1.0; z < 0.61; z += 0.047) {
    const hits = [], visible = [];
    for (const side of [-1, 1]) {
      ray.set(new THREE.Vector3(side * 2, y, z), new THREE.Vector3(-side, 0, 0));
      hits.push(ray.intersectObject(glass)[0]); visible.push(ray.intersectObject(car, true)[0]);
    }
    assert.equal(Boolean(hits[0]), Boolean(hits[1]), `Asymmetric glass coverage at ${y}, ${z}`);
    if (!hits[0]) continue;
    samples++;
    assert.ok(Math.abs(hits[0].point.x + hits[1].point.x) < 1e-6, `Different glass surfaces at ${y}, ${z}`);
    assert.ok(hits[0].normal.clone().multiply(new THREE.Vector3(-1, 1, 1)).distanceTo(hits[1].normal) < 1e-5, 'Glass shading must be mirrored');
    assert.equal(visible[0].object.name, visible[1].object.name, `Frame disappears under the glass at ${y}, ${z}`);
    assert.ok(Math.abs(visible[0].point.x + visible[1].point.x) < 1e-6, 'Window frames must follow the same profile');
  }
  assert.ok(samples > 250);
});

test('Door outlines reach the roof, with separate door and quarter windows fitted into the painted cabin frame', () => {
  const car = withCanvas(() => createRacingCar()); car.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(), outline = car.getObjectByName('door-seams');
  outline.geometry.computeBoundingBox();
  assert.ok(outline.geometry.boundingBox.max.y > 0.72 && outline.geometry.boundingBox.min.y < -0.16);
  for (const side of [-1, 1]) {
    for (const [y, z, expected] of [[0.5, -0.6, 'cabin-frame'], [0.5, -0.10, 'sloping-windows'], [0.48, -0.75, 'sloping-windows']]) {
      ray.set(new THREE.Vector3(side * 2, y, z), new THREE.Vector3(-side, 0, 0));
      assert.equal(ray.intersectObject(car, true)[0]?.object.name, expected);
    }
    const z = -0.64 + 0.11 * (0.5 - 0.326) / (0.7205 - 0.326);
    ray.set(new THREE.Vector3(side * 2, 0.5, z), new THREE.Vector3(-side, 0, 0));
    assert.equal(ray.intersectObject(car, true)[0]?.object.name, 'door-seams', 'Door seam must continue along the window frame');
  }
});

test('Axles, wishbones and dampers stay attached to the hubs through steering, wheel spin and suspension travel', () => {
  const scene = new THREE.Scene(), mesh = withCanvas(() => createRacingCar(0.18)); scene.add(mesh);
  const vehicle = { mesh, centerOfMassOffset: 0.18, wheels: Array.from({ length: 4 }, () => ({ mesh: createRacingWheel() })) };
  for (const wheel of vehicle.wheels) scene.add(wheel.mesh);
  const suspension = new WheelSuspension(vehicle), matrix = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
  const endpoint = (part, index, y) => { part.getMatrixAt(index, matrix); return new THREE.Vector3(0, y, 0).applyMatrix4(matrix).applyMatrix4(suspension.root.matrixWorld); };
  const check = (actual, expected) => assert.ok(actual.distanceTo(expected) < 2e-6, `Disconnected joint: ${actual.distanceTo(expected)}`);
  for (const angles of [[0, 0, 0], [0.25, 1.1, -0.15], [0, 0.6, Math.PI]]) for (const height of [-0.10, -0.22, -0.30]) {
    mesh.position.set(17, 2, -29); mesh.quaternion.setFromEuler(new THREE.Euler(...angles));
    const worldUp = up.clone().applyQuaternion(mesh.quaternion);
    for (const spin of [0, 1.7]) {
      for (let i = 0; i < 4; i++) {
        const wheel = vehicle.wheels[i].mesh, side = i % 2 === 0 ? -1 : 1, z = i < 2 ? 1 : -1.04;
        wheel.position.set(side * 0.86, height + 0.18, z).applyQuaternion(mesh.quaternion).add(mesh.position);
        wheel.quaternion.copy(mesh.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(up, i < 2 ? 0.4 : 0))
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), spin));
      }
      suspension.update(); scene.updateMatrixWorld(true);
      for (let i = 0; i < 4; i++) {
        const wheel = vehicle.wheels[i].mesh, side = i % 2 === 0 ? -1 : 1;
        const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(wheel.quaternion);
        const hub = wheel.position.clone().addScaledVector(axis, -side * 0.113);
        check(endpoint(suspension.drives, i * 3, 0.5), hub);
        check(endpoint(suspension.knuckles, i, 0), hub);
        check(endpoint(suspension.arms, [0, 5, 10, 14][i], 0.5), hub.clone().addScaledVector(worldUp, -0.066));
        check(endpoint(suspension.drives, i * 3 + 1, -0.5), hub.clone().addScaledVector(worldUp, 0.064));
        const z = i < 2 ? 1 : -1.04;
        const mount = new THREE.Vector3(side * 0.56, (z > 0 ? 0.075 : 0.105) + 0.18, z).applyQuaternion(mesh.quaternion).add(mesh.position);
        check(endpoint(suspension.springs, i, 0.11), mount);
      }
      for (const part of suspension.root.children) for (const value of part.instanceMatrix.array) assert.ok(Number.isFinite(value));
    }
  }
  assert.equal(suspension.root.children.length, 6); assert.ok(suspension.root.children.every(part => !part.castShadow));
});

test('Tinted windows remain opaque and their cached reflection shader follows the daylight uniform', () => {
  const car = withCanvas(() => createRacingCar()), windows = car.getObjectByName('sloping-windows');
  const material = windows.material, spoiler = car.getObjectByName('rear-wing').material;
  assert.equal(material.transparent, false); assert.equal(material.opacity, 1); assert.equal(material.depthWrite, true);
  assert.equal(material.transmission ?? 0, 0); assert.ok(material.roughness < spoiler.roughness / 4);
  assert.ok(material.color.b > spoiler.color.b * 2);
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader);
  const reference = shader.uniforms.carGlassDaylight, key = material.customProgramCacheKey();
  for (const daylight of [1, 0.5, 0]) { material.userData.daylight.value = daylight; assert.equal(reference.value, daylight); }
  assert.equal(material.customProgramCacheKey(), key, 'Time changes must not recompile the glass shader');
  assert.equal(shader.fragmentShader.match(/#include <opaque_fragment>/g).length, 1);
  const frames = car.getObjectByName('window-gaskets'); assert.ok(frames);
  for (const attribute of Object.values(frames.geometry.attributes)) for (const value of attribute.array) assert.ok(Number.isFinite(value));
});
