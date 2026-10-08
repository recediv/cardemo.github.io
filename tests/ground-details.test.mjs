import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../vendor/three.module.js';
import { Track } from '../src/track.js';
import { GroundDetails } from '../src/ground-details.js';
import { DayPalette } from '../src/day-cycle.js';

function setup() {
  const scene = new THREE.Scene(), track = new Track(scene);
  const details = new GroundDetails(scene, {}, track, { clearGrass() {}, sampleDensity() { return 0; } }, [], new DayPalette(), { windDirection: { value: new THREE.Vector2(1, 0) } });
  return { details, environment: { windStrength: 0 } };
}

test('A stationary car leaves leaves at rest; a fast swept pass launches nearby leaves and they settle', () => {
  const { details, environment } = setup(), leaf = details.leaves[0], start = leaf.position.clone();
  details.pushFromVehicle(start, { x: 0, z: 0 }, 1 / 60);
  assert.equal(details.active.size, 0);
  assert.ok(leaf.position.equals(start));
  details.pushFromVehicle(start.clone().add(new THREE.Vector3(-5, 0, 0)), { x: 0, z: 0 }, 1 / 60);
  details.pushFromVehicle(start.clone().add(new THREE.Vector3(5, 0, 0)), { x: 20, z: 0 }, 1 / 60);
  assert.ok(details.active.has(0), 'The car crossed the leaf between frames');
  for (let i = 0; i < 30; i++) details.update(1 / 60, environment);
  assert.ok(leaf.position.y > start.y + 0.2);
  assert.ok(leaf.position.distanceTo(start) > 0.5);
  for (let i = 0; i < 600; i++) details.update(1 / 60, environment);
  assert.equal(details.active.size, 0);
  assert.ok(Math.abs(leaf.position.y - details.groundHeight(leaf.position.x, leaf.position.z) - 0.018) < 1e-8);
  assert.ok(details.buckets.get(leaf.cell).has(0), 'Settled leaves re-enter the proximity lookup');
  details.previousVehicle = null;
  details.pushFromVehicle(leaf.position, { x: 12, z: 0 }, 1 / 60);
  assert.ok(details.active.has(0), 'The same leaf can be scattered again');
  for (const value of details.mesh.instanceMatrix.array) assert.ok(Number.isFinite(value));
});

test('Leaf flight depends on elapsed time rather than frame count', () => {
  const run = dt => {
    const { details, environment } = setup(), leaf = details.leaves[0];
    details.pushFromVehicle(leaf.position, { x: 12, z: 0 }, dt);
    for (let i = 0; i < Math.round(1.5 / dt); i++) details.update(dt, environment);
    return leaf.position;
  };
  assert.ok(run(1 / 30).distanceTo(run(1 / 120)) < 0.15);
});

test('A fast pass strengthens its early wake without repeating the same impulse', () => {
  const { details } = setup(), leaf = details.leaves[0], start = leaf.position.clone();
  details.buckets.clear(); details.leaves = [leaf]; details.putToRest(0);
  const velocity = { x: 44, z: 0 };
  details.pushFromVehicle(start.clone().add(new THREE.Vector3(-3.1, 0, 0)), velocity);
  assert.ok(leaf.velocity.length() < 0.2, 'The first edge contact is only a light wake');
  details.elapsed += 2.9 / velocity.x;
  details.pushFromVehicle(start.clone().add(new THREE.Vector3(-0.2, 0, 0)), velocity);
  assert.ok(leaf.velocity.length() > 16, 'The close pass must replace the weak edge response within its cooldown');
  assert.ok(leaf.velocity.y > 3, 'Racing speed also lifts the leaves');
  assert.equal(details.scatterCount, 1, 'One pass receives one total impulse');
  const peak = leaf.velocity.clone();
  for (let i = 0; i < 12; i++) details.pushFromVehicle(start, velocity);
  assert.ok(leaf.velocity.equals(peak), 'Repeated render calls cannot multiply the same kick');
});

test('Slow driving leaves the ordinary wind simulation unchanged', () => {
  const { details, environment } = setup(), reference = setup().details;
  environment.windStrength = 0.7;
  const start = details.leaves[0].position.clone();
  let speed = 0;
  const vehicle = {
    body: { getLinearVelocity: () => ({ x: () => speed, z: () => 0 }) },
    mesh: { position: start.clone().add(new THREE.Vector3(0, 0.5, 0)) },
  };
  for (const slowSpeed of [0, 1, 4, 5.5, 6]) {
    speed = slowSpeed;
    for (let i = 0; i < 30; i++) {
      vehicle.mesh.position.x += speed / 60;
      details.update(1 / 60, environment, vehicle);
      reference.update(1 / 60, environment);
    }
  }
  assert.equal(details.scatterCount, 0);
  for (let i = 0; i < details.leaves.length; i++) {
    assert.ok(details.leaves[i].position.equals(reference.leaves[i].position));
    assert.ok(details.leaves[i].velocity.equals(reference.leaves[i].velocity));
  }
  assert.deepEqual(details.active, reference.active);
});

test('The vehicle wake blends in smoothly above slow driving speed', () => {
  const { details } = setup(), leaf = details.leaves[0], start = leaf.position.clone();
  details.buckets.clear(); details.leaves = [leaf]; details.putToRest(0);
  const kick = speed => {
    leaf.velocity.set(0, 0, 0); leaf.lastPush = -2; details.previousVehicle = null;
    details.pushFromVehicle(start, { x: speed, z: 0 });
    return leaf.velocity.length();
  };
  assert.equal(kick(6), 0);
  assert.ok(kick(6.001) < 0.00001, 'Crossing the threshold does not produce a sudden kick');
  assert.ok(kick(6.1) < 0.01);
  const nearThreshold = kick(7), roadSpeed = kick(10), racingSpeed = kick(44);
  assert.ok(nearThreshold > 0 && roadSpeed > nearThreshold && racingSpeed > roadSpeed);
});

test('Racing-speed leaf flight stays stronger than a moderate pass at different render rates', () => {
  const pass = (speed, dt) => {
    const { details, environment } = setup(), leaf = details.leaves[0], start = leaf.position.clone();
    details.buckets.clear(); details.leaves = [leaf]; details.mesh.count = 1; details.putToRest(0);
    let x = -4, peakHeight = 0, peakSpeed = 0;
    const vehicle = {
      body: { getLinearVelocity: () => ({ x: () => speed, z: () => 0 }) },
      mesh: { position: start.clone().add(new THREE.Vector3(x, 0.5, 0)) },
    };
    for (let time = 0; time < 8 / speed + 2; time += dt) {
      x += speed * dt; vehicle.mesh.position.x = start.x + x;
      details.update(dt, environment, vehicle);
      peakHeight = Math.max(peakHeight, leaf.position.y - leaf.floor);
      peakSpeed = Math.max(peakSpeed, leaf.velocity.length());
    }
    return { peakHeight, peakSpeed, scattered: details.scatterCount };
  };
  const moderate = pass(12, 1 / 60);
  for (const dt of [1 / 120, 1 / 60, 1 / 30, 0.1]) {
    const fast = pass(44, dt);
    assert.equal(fast.scattered, 1, `The swept path catches the leaf at dt=${dt}`);
    assert.ok(fast.peakSpeed > moderate.peakSpeed * 1.5, `Fast flight remains stronger at dt=${dt}`);
    assert.ok(fast.peakHeight > moderate.peakHeight + 0.3, `Fast flight remains visible at dt=${dt}: ${JSON.stringify({ fast, moderate })}`);
  }
});
