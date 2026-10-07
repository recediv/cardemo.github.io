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
