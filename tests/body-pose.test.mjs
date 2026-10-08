import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../vendor/three.module.js';
import { CarBodyPose } from '../src/body-pose.js';
import { createRacingCar } from '../src/car-model.js';
import { createRacingWheel } from '../src/wheels.js';
import { Vehicle } from '../src/vehicle.js';
import { Physics } from '../src/physics.js';
import { BestLapGhost } from '../src/ghost.js';
import { EnvironmentState } from '../src/simulation.js';
import { withCanvas } from './canvas.mjs';
import { loadAmmo } from './ammo-loader.mjs';

const Ammo = await loadAmmo(), dt = 1 / 120;

function fixture() {
  const scene = new THREE.Scene(), physics = new Physics(Ammo);
  const track = { spawn: { position: new THREE.Vector3(), yaw: 0 },
    nearest: (_, result = {}) => Object.assign(result, { onRoad: true, progress: 0, distance: 0 }),
    point: () => ({ position: new THREE.Vector3(), yaw: 0 }) };
  const vehicle = withCanvas(() => new Vehicle(scene, physics, track, () => {})), environment = new EnvironmentState();
  const input = { forward: false, backward: false, left: false, right: false, brake: false, boost: false };
  const step = () => { physics.beforeStep(); vehicle.preStep(dt, input, environment); physics.step(dt); vehicle.postStep(dt); };
  for (let i = 0; i < 360; i++) step();
  return { scene, physics, vehicle, environment, input, step };
}

test('The raised shell retains the tire contact positions and normal physical rotation without extra landing animation', () => {
  const { vehicle, physics, environment } = fixture();
  physics.render(1); vehicle.render(1, environment);
  assert.equal(vehicle.inContactCount, 4);
  assert.ok(Math.abs(vehicle.mesh.position.y - vehicle.item.position.y - 0.06) < 0.001);
  assert.ok(vehicle.mesh.quaternion.clone().normalize().angleTo(vehicle.item.quaternion.clone().normalize()) < 1e-6);
  for (const wheel of vehicle.wheels) assert.ok(Math.abs(wheel.mesh.position.y - 0.4) < 0.006);
  const physical = vehicle.item.position.toArray().concat(vehicle.item.quaternion.toArray());
  const wheelPoses = vehicle.wheels.map(wheel => wheel.position.toArray());
  const displayed = vehicle.mesh.position.toArray().concat(vehicle.mesh.quaternion.toArray());
  for (let i = 0; i < 30; i++) vehicle.render(1, environment);
  assert.deepEqual(vehicle.mesh.position.toArray().concat(vehicle.mesh.quaternion.toArray()), displayed);
  assert.deepEqual(vehicle.item.position.toArray().concat(vehicle.item.quaternion.toArray()), physical);
  assert.deepEqual(vehicle.wheels.map(wheel => wheel.position.toArray()), wheelPoses);
});

test('The best-lap ghost records the raised body before rendering while keeping the same frame size', () => {
  const { vehicle, scene, input, step } = fixture();
  input.forward = true; for (let i = 0; i < 120; i++) step();
  const ghost = new BestLapGhost(scene, vehicle);
  vehicle.mesh.position.set(999, 999, 999);
  ghost.capture(1); ghost.step(dt, { lastLap: 1 }, true); ghost.render(1);
  assert.ok(ghost.mesh.position.distanceTo(vehicle.bodyPose.pose.position) < 1e-6);
  assert.equal(ghost.best[0].poses.length, 35);
});

test('Tires clear the round shell throughout physical spring compression and full steering', () => {
  const car = withCanvas(() => createRacingCar(0.18)), shell = car.getObjectByName('tapered-body');
  const wheels = Array.from({ length: 4 }, () => createRacingWheel());
  const vehicle = { centerOfMassOffset: 0.18, mesh: car,
    item: { position: new THREE.Vector3(), previousPosition: new THREE.Vector3(), quaternion: new THREE.Quaternion(), previousQuaternion: new THREE.Quaternion() },
    wheels: wheels.map(mesh => ({ position: mesh.position, previousPosition: mesh.position })) };
  const pose = new CarBodyPose(vehicle), ray = new THREE.Raycaster(), point = new THREE.Vector3(), hits = [];
  let checked = 0;
  for (const height of [-0.22, -0.10, 0.04, 0.15]) for (const steer of [0, -0.46, 0.46]) {
    for (let i = 0; i < 4; i++) wheels[i].position.set(i % 2 ? 0.86 : -0.86, height, i < 2 ? 1 : -1.04);
    pose.render(1); car.updateMatrixWorld(true);
    for (let i = 0; i < 4; i++) {
      const side = i % 2 ? 1 : -1, wheel = wheels[i];
      wheel.rotation.y = i < 2 ? steer : 0; wheel.updateMatrixWorld(true);
      const tire = wheel.getObjectByName('rubber-tire'), positions = tire.geometry.attributes.position;
      for (let v = 0; v < positions.count; v++) {
        point.fromBufferAttribute(positions, v).applyMatrix4(tire.matrixWorld);
        if (side * point.x > 0.94) continue;
        ray.set(new THREE.Vector3(side * 2, point.y, point.z), new THREE.Vector3(-side, 0, 0));
        hits.length = 0; ray.intersectObject(shell, false, hits);
        if (!hits.length) continue;
        checked++;
        assert.ok(side * (point.x - hits[0].point.x) > 0.01, `Tire intersects its arch: wheel ${i}, steer ${steer}`);
      }
    }
  }
  assert.ok(checked > 1000);
});

test('Neon strips stay supported by the sill between the new wheel openings', () => {
  const car = withCanvas(() => createRacingCar()), strips = car.userData.underglowMesh;
  car.updateMatrixWorld(true); strips.geometry.computeBoundingBox();
  assert.ok(strips.geometry.boundingBox.min.z > -0.53 && strips.geometry.boundingBox.max.z < 0.49);
  const positions = strips.geometry.attributes.position, ray = new THREE.Raycaster();
  const shell = car.getObjectByName('tapered-body');
  for (let i = 0; i < positions.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(strips.matrixWorld);
    ray.set(point, new THREE.Vector3(0, 1, 0));
    const hit = ray.intersectObject(shell)[0];
    assert.ok(hit && hit.distance < 0.011, 'Neon must stay in the body groove rather than span the empty wheel opening');
  }
});
