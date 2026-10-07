import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../vendor/three.module.js';
import { EnvironmentState, RecoveryTimer, LapTimer, formatTime } from '../src/simulation.js';
import { Track } from '../src/track.js';
import { Physics } from '../src/physics.js';
import { Vehicle } from '../src/vehicle.js';
import { World } from '../src/world.js';
import { loadAmmo } from './ammo-loader.mjs';
import { withCanvas } from './canvas.mjs';
import './app.test.mjs';
import './visuals.test.mjs';
import './ground-details.test.mjs';

const Ammo = await loadAmmo();
const dt = 1 / 60;
function advanceEnvironment(environment, seconds) { for (let i = 0; i < Math.round(seconds / dt); i++) environment.step(dt); }
function setup(withForest = false) {
  const scene = new THREE.Scene(), track = new Track(scene), physics = new Physics(Ammo);
  track.attachPhysics(physics);
  const world = withForest ? withCanvas(() => new World(scene, physics, track)) : null;
  const environment = new EnvironmentState(); environment.autoTime = false;
  const notices = [], vehicle = new Vehicle(scene, physics, track, message => notices.push(message));
  const input = { forward: false, backward: false, left: false, right: false, brake: false, boost: false };
  function step(seconds) {
    for (let i = 0; i < Math.round(seconds / dt); i++) { physics.beforeStep(); vehicle.preStep(dt, input, environment); physics.step(dt); vehicle.postStep(dt); }
    physics.render(0.5); vehicle.render(0.5, environment);
  }
  return { scene, track, physics, world, environment, notices, vehicle, input, step };
}

test('Rain fills puddles, clear weather dries them, day dries faster than night', () => {
  const environment = new EnvironmentState(); environment.setTime(14); environment.setWeather('rain');
  advanceEnvironment(environment, 25); assert.ok(environment.rain > 0.99); assert.ok(environment.wetness > 0.9);
  environment.setWeather('clear'); advanceEnvironment(environment, 70);
  assert.ok(environment.rain < 0.01); assert.equal(environment.wetness, 0);
  const day = new EnvironmentState(), night = new EnvironmentState();
  for (const env of [day, night]) { env.wetness = 1; env.setWeather('clear'); }
  day.setTime(14); night.setTime(0); advanceEnvironment(day, 25); advanceEnvironment(night, 25);
  assert.ok(day.wetness < night.wetness - 0.2);
});

test('Time and recovery depend on elapsed seconds and ignore moving rolls', () => {
  const environment = new EnvironmentState(); environment.hour = 0; advanceEnvironment(environment, environment.dayDuration);
  assert.ok(Math.min(environment.hour, 24 - environment.hour) < 0.001);
  const recovery = new RecoveryTimer(3);
  assert.equal(recovery.step(-1, 10, 5), false); assert.equal(recovery.elapsed, 0);
  assert.equal(recovery.step(-1, 0, 2.9), false); assert.equal(recovery.step(-1, 0, 0.11), true);
  recovery.step(1, 0, 1); assert.equal(recovery.elapsed, 0);
});

test('Road is closed, faces upwards and projects onto its seam correctly', () => {
  const track = new Track(new THREE.Scene());
  const normal = track.road.geometry.attributes.normal, position = track.road.geometry.attributes.position;
  for (let i = 0; i < normal.count; i++) assert.ok(normal.getY(i) > 0.99);
  for (let side = 0; side < 2; side++) {
    assert.ok(Math.abs(position.getX(side) - position.getX(position.count - 2 + side)) < 1e-6);
    assert.ok(Math.abs(position.getZ(side) - position.getZ(position.count - 2 + side)) < 1e-6);
  }
  for (const t of [0.002, 0.25, 0.7, 0.998]) { const nearest = track.nearest(track.point(t).position); assert.ok(nearest.distance < 0.005); assert.ok(Math.abs(nearest.progress - t) < 0.001); }
});

test('Actual Bullet vehicle accelerates, turns, brakes and reverses', () => {
  const game = setup(); game.step(2); const start = game.vehicle.item.position.clone();
  game.input.forward = true; game.step(3);
  assert.ok(game.vehicle.speed > 7); assert.ok(game.vehicle.item.position.distanceTo(start) > 15);
  const beforeTurn = game.vehicle.item.quaternion.clone(); game.input.left = true; game.step(1.5);
  assert.ok(beforeTurn.angleTo(game.vehicle.item.quaternion) > 0.4);
  game.input.forward = false; game.input.left = false; game.input.brake = true; game.step(2);
  assert.ok(game.vehicle.speed < 0.8);
  game.input.brake = false; game.input.backward = true; game.step(2);
  const velocity = game.vehicle.body.getLinearVelocity();
  assert.ok(velocity.x() * game.vehicle.forward.x + velocity.z() * game.vehicle.forward.z < -1);
});

test('A physical roof landing automatically restores the car after three stopped seconds', () => {
  const game = setup(); game.step(2); game.vehicle.flip();
  game.step(2); assert.equal(game.vehicle.recoveries, 0); assert.ok(game.vehicle.up.y < 0.35);
  game.step(4); assert.equal(game.vehicle.recoveries, 1); assert.ok(game.vehicle.up.y > 0.95); assert.ok(game.vehicle.surface.onRoad);
  game.step(4); assert.equal(game.vehicle.recoveries, 1);
});

test('Dynamic obstacles respond to collisions and emit an impact event', () => {
  const game = setup(); game.step(2);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(game.vehicle.item.quaternion);
  const position = game.vehicle.item.position.clone().addScaledVector(forward, 4).setY(0.55);
  const box = game.physics.box(new THREE.Object3D(), [1.05, 1.05, 1.05], position, 17);
  let impacts = 0; game.physics.onImpact = strength => { assert.ok(strength > 0 && strength <= 1); impacts++; };
  game.input.forward = true; game.step(2.5);
  assert.ok(box.position.distanceTo(position) > 0.4); assert.ok(impacts > 0);
});

test('Forest, grass, rain, puddles and headlights follow the shared environment', () => {
  const game = setup(true), camera = new THREE.PerspectiveCamera(); camera.position.set(10, 18, 25);
  const { world, environment, vehicle } = game;
  world.update(dt, environment, camera, false);
  assert.ok(world.grassCount >= 7000); assert.equal(world.obstacles.length, 22);
  assert.equal(world.rainLines.visible, false); assert.ok(world.puddles.every(p => !p.mesh.visible));
  environment.setTime(0); environment.setWeather('rain'); advanceEnvironment(environment, 25);
  world.update(dt, environment, camera, false); vehicle.render(1, environment);
  assert.equal(world.rainLines.visible, true); assert.ok(world.puddles.every(p => p.mesh.visible));
  assert.ok(world.inPuddle(world.puddles[0].mesh.position, environment.wetness));
  assert.ok(vehicle.headlights.every(light => light.intensity > 80));
  for (const coordinate of world.rainPositions) assert.ok(Number.isFinite(coordinate));
  world.setQuality(true); assert.ok(world.grassMeshes.reduce((sum, mesh) => sum + mesh.count, 0) <= 16000); assert.equal(world.rainCount, 350);
  world.setQuality(false); assert.equal(world.grassMeshes.reduce((sum, mesh) => sum + mesh.count, 0), world.grassCount); assert.equal(world.rainCount, 950);
  environment.setWeather('clear'); environment.setTime(14); advanceEnvironment(environment, 70);
  world.update(dt, environment, camera, true); vehicle.render(1, environment);
  assert.ok(world.puddles.every(p => !p.mesh.visible)); assert.ok(vehicle.headlights.every(light => light.intensity < 1));
  game.step(2); assert.ok(vehicle.up.y > 0.9);
});

test('Lap timing requires ordered checkpoints and preserves the best time on reset', () => {
  const timer = new LapTimer();
  timer.step(0.95, true, 8, 2); assert.equal(timer.step(0.01, true, 8, 2), false);
  for (const p of [0.26, 0.51, 0.76, 0.95]) timer.step(p, true, 8, 2);
  assert.equal(timer.step(0.01, true, 8, 2), true); assert.equal(timer.lap, 2); assert.ok(timer.best > 0);
  const best = timer.best; timer.reset(); assert.equal(timer.best, best); assert.equal(timer.lap, 1);
  assert.equal(formatTime(65.2), '01:05.2');
});

test('Car body vertices fit its compound colliders while all four suspension rays stay clear', () => {
  const { vehicle } = setup();
  for (const mesh of vehicle.mesh.children.filter(object => object.isMesh)) {
    mesh.updateMatrix(); const positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const vertex = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrix);
      assert.ok(vehicle.colliderParts.some(part => part.size.every((size, axis) => Math.abs(vertex.getComponent(axis) - part.position.getComponent(axis)) <= size / 2 + 1e-6)), `Exposed body vertex ${vertex.toArray()}`);
    }
  }
  for (const x of [-0.86, 0.86]) for (const z of [1, -1.04]) {
    assert.ok(!vehicle.colliderParts.some(part => Math.abs(x - part.position.x) < part.size[0] / 2 && Math.abs(z - part.position.z) < part.size[2] / 2));
  }
});

test('Resting suspension contacts the ground without levitation and a boosted wall hit stops the visible body', () => {
  const game = setup(); game.step(3);
  for (let i = 0; i < 5; i++) {
    game.step(1); assert.equal(game.vehicle.inContactCount, 4); assert.ok(game.vehicle.item.position.y > 0.35 && game.vehicle.item.position.y < 0.65);
    assert.ok(game.vehicle.wheels.every(wheel => Math.abs(wheel.position.y - game.track.height - 0.4) < 0.03));
  }
  const start = game.vehicle.item.position.clone(), forward = new THREE.Vector3(0, 0, 1).applyQuaternion(game.vehicle.item.quaternion);
  const wallPosition = start.clone().addScaledVector(forward, 12).setY(3);
  game.physics.box(new THREE.Object3D(), [20, 6, 1], wallPosition, 0, 0.8, game.vehicle.item.quaternion);
  game.input.forward = true; game.input.boost = true; game.step(4);
  game.physics.render(1); game.scene.updateMatrixWorld(true);
  let leadingEdge = -Infinity;
  game.vehicle.mesh.traverse(mesh => {
    if (!mesh.isMesh) return;
    const positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const vertex = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).sub(start);
      leadingEdge = Math.max(leadingEdge, vertex.dot(forward));
    }
  });
  assert.ok(game.vehicle.item.position.distanceTo(start) > 8, 'Car must actually reach the wall');
  assert.ok(leadingEdge <= 11.53, `Body penetrated the wall by ${leadingEdge - 11.5} metres`);
});
