import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../vendor/three.module.js';
import { createRacingCar } from '../src/car-model.js';
import { Physics } from '../src/physics.js';
import { Track } from '../src/track.js';
import { Vehicle } from '../src/vehicle.js';
import { loadAmmo } from './ammo-loader.mjs';
import { withCanvas } from './canvas.mjs';

test('Rear lamps expose separate red tail lights and white reverse lenses', () => {
  const car = withCanvas(() => createRacingCar(0.18)); car.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(), materials = car.userData;
  for (const [name, material] of [['rear-lamp', materials.tailMaterial], ['reverse-lamp', materials.reverseLampMaterial]]) {
    const lenses = car.children.filter(part => part.name === name); assert.equal(lenses.length, 2);
    for (const lens of lenses) {
      assert.equal(lens.material, material);
      for (const offset of [-0.015, 0, 0.015]) {
        ray.set(new THREE.Vector3(lens.position.x + offset, lens.position.y, -3), new THREE.Vector3(0, 0, 1));
        assert.equal(ray.intersectObject(car, true)[0]?.object, lens, 'A rear lens must remain visible outside the body');
      }
    }
  }
  const red = materials.tailMaterial.emissive, white = materials.reverseLampMaterial.emissive;
  assert.ok(red.r > red.g * 10 && red.r > red.b * 10);
  assert.equal(white.r, white.g); assert.equal(white.g, white.b); assert.ok(white.r > 0);
  assert.notEqual(materials.tailMaterial, materials.reverseLampMaterial);
});

test('Vehicle lights follow real braking and reverse motion independently of automatic or manual headlights', async () => {
  const Ammo = await loadAmmo(), scene = new THREE.Scene(), track = new Track(scene), physics = new Physics(Ammo);
  track.attachPhysics(physics);
  const vehicle = withCanvas(() => new Vehicle(scene, physics, track, () => {})), materials = vehicle.mesh.userData;
  const environment = { daylight: 1, elapsed: 0, rain: 0, windStrength: 0.8, wetness: 0 };
  const input = { forward: false, backward: false, left: false, right: false, brake: false, boost: false }, dt = 1 / 60;
  const step = (frames = 1) => {
    for (let i = 0; i < frames; i++) {
      environment.elapsed += dt; physics.beforeStep(); vehicle.preStep(dt, input, environment);
      physics.step(dt); vehicle.postStep(dt); physics.render(1); vehicle.render(1, environment);
    }
  };
  const forwardSpeed = () => {
    const velocity = vehicle.body.getLinearVelocity(), forward = new THREE.Vector3(0, 0, 1).applyQuaternion(vehicle.item.quaternion);
    return velocity.x() * forward.x + velocity.y() * forward.y + velocity.z() * forward.z;
  };
  const checkHeadlights = enabled => {
    assert.ok(vehicle.headlights.every(light => enabled ? light.intensity > 200 : light.intensity === 0));
    assert.ok(enabled ? materials.popupLampMaterial.emissiveIntensity > 2.9 : materials.popupLampMaterial.emissiveIntensity === 0);
    assert.ok(enabled ? materials.lampMaterial.emissiveIntensity > 1 : materials.lampMaterial.emissiveIntensity === 0);
    assert.equal(materials.underglowMesh.visible, enabled);
    assert.ok(enabled ? materials.underglowMaterial.opacity > 0.8 : materials.underglowMaterial.opacity === 0);
  };
  step(120); checkHeadlights(false);
  assert.equal(materials.tailMaterial.emissiveIntensity, 0); assert.equal(materials.reverseLampMaterial.emissiveIntensity, 0);
  input.forward = true; step(150); assert.ok(forwardSpeed() > 7);
  assert.equal(materials.tailMaterial.emissiveIntensity, 0); assert.equal(materials.reverseLampMaterial.emissiveIntensity, 0);
  input.forward = false; input.backward = true; step();
  assert.ok(forwardSpeed() > 1, 'Pressing reverse while moving forward must brake first');
  assert.equal(materials.tailMaterial.emissiveIntensity, 2.5); assert.equal(materials.reverseLampMaterial.emissiveIntensity, 0);
  for (let i = 0; i < 300 && forwardSpeed() > -0.7; i++) step();
  assert.ok(forwardSpeed() < -0.7); assert.equal(materials.reverseLampMaterial.emissiveIntensity, 2.4);
  assert.equal(materials.tailMaterial.emissiveIntensity, 0, 'Reversing alone must not illuminate the brake lights');
  input.backward = false; step();
  assert.ok(forwardSpeed() < -0.15); assert.equal(materials.reverseLampMaterial.emissiveIntensity, 2.4, 'Reverse lights must remain lit when coasting backwards');
  input.brake = true; step();
  assert.equal(materials.tailMaterial.emissiveIntensity, 2.5); assert.equal(materials.reverseLampMaterial.emissiveIntensity, 2.4);
  step(180); assert.ok(Math.abs(forwardSpeed()) < 0.15); assert.equal(materials.reverseLampMaterial.emissiveIntensity, 0);
  input.brake = false; step(); assert.equal(materials.tailMaterial.emissiveIntensity, 0);
  environment.daylight = 0; step(120); checkHeadlights(true);
  assert.equal(materials.tailMaterial.emissiveIntensity, 0.45); assert.equal(materials.glassMaterial.userData.daylight.value, 0);
  const light = vehicle.headlights[0]; assert.ok(light.color.r >= light.color.g && light.color.g > light.color.b, 'Headlights must use warm white');
  assert.ok(light.color.equals(materials.popupLampMaterial.emissive));
  input.brake = true; step(); assert.equal(materials.tailMaterial.emissiveIntensity, 2.5);
  input.brake = false; step(); assert.equal(materials.tailMaterial.emissiveIntensity, 0.45);
  vehicle.headlightSystem.control.toggle(); step(120); checkHeadlights(false);
  assert.equal(materials.tailMaterial.emissiveIntensity, 0);
  input.brake = true; step(); assert.equal(materials.tailMaterial.emissiveIntensity, 2.5);
  input.brake = false; input.backward = true;
  for (let i = 0; i < 120 && forwardSpeed() > -0.7; i++) step();
  assert.ok(forwardSpeed() < -0.7); assert.equal(materials.reverseLampMaterial.emissiveIntensity, 2.4);
  checkHeadlights(false);
  input.backward = false; vehicle.reset(); step();
  assert.equal(materials.reverseLampMaterial.emissiveIntensity, 0); assert.equal(materials.tailMaterial.emissiveIntensity, 0);
  vehicle.headlightSystem.control.mode = 'auto'; step(120); checkHeadlights(true);
  environment.daylight = 0.68; step(120); assert.ok(vehicle.headlightSystem.opening > 0.999);
  environment.daylight = 1; step(120); checkHeadlights(false);
  assert.equal(materials.tailMaterial.emissiveIntensity, 0); assert.equal(materials.glassMaterial.userData.daylight.value, 1);
  environment.daylight = 0.68; step(120); assert.ok(vehicle.headlightSystem.opening < 0.001, 'Twilight hysteresis must prevent repeated popup movement');
  environment.daylight = 1; step(120); vehicle.headlightSystem.control.toggle(); step(120); checkHeadlights(true);
  vehicle.headlightSystem.control.toggle(); step(120); checkHeadlights(false);
  let lightCount = 0; scene.traverse(object => { if (object.isLight) lightCount++; }); assert.equal(lightCount, 2);
});
