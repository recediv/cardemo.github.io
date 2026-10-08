import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../vendor/three.module.js';
import { createRacingCar } from '../src/car-model.js';
import { HeadlightSystem } from '../src/headlights.js';
import { applyCarLighting } from '../src/car-lighting.js';
import { BestLapGhost } from '../src/ghost.js';
import { ExhaustSystem } from '../src/exhaust.js';
import { UnderglowSystem } from '../src/underglow.js';
import { withCanvas } from './canvas.mjs';

function fixture() {
  const scene = new THREE.Scene(), mesh = withCanvas(() => createRacingCar(0.18)); scene.add(mesh);
  const vehicle = { mesh, item: mesh, centerOfMassOffset: 0.18, recoveries: 0, throttle: 1,
    wheels: Array.from({ length: 4 }, () => ({ mesh: new THREE.Object3D(), position: new THREE.Vector3(), quaternion: new THREE.Quaternion() })),
    body: { getLinearVelocity: () => ({ x: () => 0, y: () => 0, z: () => 12 }) } };
  vehicle.headlightSystem = new HeadlightSystem(scene, mesh);
  return { scene, vehicle };
}

test('Front lenses are recessed and the muffler connects continuously to the tailpipe', () => {
  const car = withCanvas(() => createRacingCar()); car.updateMatrixWorld(true);
  const front = car.getObjectByName('front-assembly'), ray = new THREE.Raycaster();
  const lenses = front.children.filter(part => part.name === 'front-marker'); assert.equal(lenses.length, 2);
  for (const lens of lenses) for (const x of [-0.06, 0, 0.06]) for (const y of [-0.01, 0, 0.01]) {
    ray.set(new THREE.Vector3(lens.position.x + x, lens.position.y + y, 3), new THREE.Vector3(0, 0, -1));
    const hit = ray.intersectObject(car, true)[0];
    assert.equal(hit?.object, lens); assert.ok(1.64 - hit.point.z > 0.025);
  }
  assert.ok(car.getObjectByName('front-bumper'));
  const internal = car.getObjectByName('underbody-exhaust'), tip = car.getObjectByName('exhaust-tip');
  for (let z = -1.275; z >= -1.705; z -= 0.005) {
    let covered = false;
    for (let x = 0.29; x <= 0.54 && !covered; x += 0.005) {
      ray.set(new THREE.Vector3(x, -0.6, z), new THREE.Vector3(0, 1, 0));
      covered = ray.intersectObjects([internal, tip]).length > 0;
    }
    assert.ok(covered, `Gap between muffler and tailpipe at z=${z}`);
  }
  for (const part of car.getObjectByName('underbody-mechanism').children) {
    for (const attribute of Object.values(part.geometry.attributes)) for (const value of attribute.array) assert.ok(Number.isFinite(value));
  }
});

test('Popup beams follow their lenses and manual or automatic lighting controls the car and ghost covers', () => {
  const { scene, vehicle } = fixture(), system = vehicle.headlightSystem;
  const ghost = withCanvas(() => new BestLapGhost(scene, vehicle));
  ghost.capture(2); ghost.step(1 / 60, { lastLap: 2 }, true);
  const glow = new UnderglowSystem(scene, vehicle, { surfaceAt(position, surface) { surface.height = 0.04; surface.normal.set(0, 1, 0); } });
  const environment = { daylight: 1, elapsed: 0, rain: 0.2, windStrength: 0.8 };
  const advance = (frames = 120) => {
    for (let i = 0; i < frames; i++) {
      environment.elapsed += 1 / 60; system.update(environment);
      applyCarLighting(vehicle.mesh.userData, system); ghost.render(1); glow.update();
    }
  };
  const check = enabled => {
    assert.ok(enabled ? system.opening > 0.999 : system.opening < 0.001);
    assert.ok(system.lights.every(light => enabled ? light.intensity > 200 : light.intensity === 0));
    assert.equal(glow.glow.visible, enabled); assert.equal(system.dust.visible, enabled);
    const materials = vehicle.mesh.userData;
    assert.equal(materials.underglowMesh.visible, enabled);
    assert.ok(enabled ? materials.lampMaterial.emissiveIntensity > 0 : materials.lampMaterial.emissiveIntensity === 0);
    assert.ok(enabled ? materials.popupLampMaterial.emissiveIntensity > 0 : materials.popupLampMaterial.emissiveIntensity === 0);
    for (let i = 0; i < 2; i++) assert.equal(ghost.popups[i].rotation.x, system.popups[i].rotation.x);
  };
  advance(); check(false); assert.equal(system.control.mode, 'auto');
  system.control.toggle(); advance(1); assert.ok(system.opening > 0 && system.opening < 1); advance(); check(true);
  environment.daylight = 0; advance(); check(true);
  for (const angles of [[0.1, 1.4, -0.2], [-0.3, -2.1, 0.4], [0, 0.6, Math.PI]]) {
    vehicle.mesh.position.set(17, 2, -29); vehicle.mesh.quaternion.setFromEuler(new THREE.Euler(...angles));
    advance(1); scene.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) assert.ok(system.lights[i].getWorldPosition(new THREE.Vector3()).distanceTo(system.sources[i].getWorldPosition(new THREE.Vector3())) < 1e-8);
  }
  vehicle.mesh.quaternion.identity();
  system.control.toggle(); advance(); check(false);
  environment.daylight = 1; advance(); check(false);
  system.control.mode = 'auto'; advance(); check(false);
  environment.daylight = 0; advance(); check(true);
  assert.equal(ghost.mesh.getObjectByName('underglow-strips'), undefined);
  let lights = 0; scene.traverse(object => { if (object.isLight) lights++; }); assert.equal(lights, 2);
});

test('Exhaust emits at the tailpipe, uses a fixed smoke pool and backfires only occasionally while boosting', () => {
  const { scene, vehicle } = fixture();
  const exhaust = new ExhaustSystem(scene, vehicle, new THREE.PerspectiveCamera(), { domElement: { height: 800 } }, new THREE.Vector2(1, 0));
  const tip = vehicle.mesh.getObjectByName('exhaust-tip'), outlet = exhaust.outlets[0];
  assert.equal(exhaust.outlets.length, 1);
  const bounds = new THREE.Box3().setFromObject(tip);
  assert.ok(Math.abs(outlet.x - tip.position.x) < 1e-8 && Math.abs(outlet.y - tip.position.y) < 1e-8);
  assert.ok(bounds.min.z - outlet.z > 0 && bounds.min.z - outlet.z < 0.012);
  vehicle.mesh.position.set(17, 2, -29); vehicle.mesh.rotation.y = 1.2; vehicle.mesh.updateMatrixWorld(true);
  exhaust.emit(1); assert.ok(exhaust.particles[0].position.distanceTo(vehicle.mesh.localToWorld(outlet.clone())) < 1e-8);
  const pool = exhaust.particles, environment = { elapsed: 0, daylight: 0, windStrength: 0.8 };
  const input = { boost: true, brake: false, backward: false }, dt = 1 / 60, shots = [];
  for (let i = 0; i < 35 / dt; i++) {
    environment.elapsed += dt; const count = exhaust.shots; exhaust.update(dt, environment, input);
    if (exhaust.shots !== count) shots.push(environment.elapsed);
    if (i < 60) assert.equal(exhaust.shots, 0);
  }
  assert.ok(shots.length >= 4 && shots.length <= 13);
  for (let i = 0; i < shots.length; i++) assert.ok(shots[i] - (shots[i - 1] ?? 0) >= 2.5 - dt && shots[i] - (shots[i - 1] ?? 0) <= 6 + dt);
  const count = exhaust.shots, cooldown = exhaust.shotCooldown;
  for (const blocked of [{ boost: false }, { brake: true }, { backward: true }]) for (let i = 0; i < 120; i++) {
    environment.elapsed += dt; exhaust.update(dt, environment, { ...input, ...blocked });
  }
  exhaust.update(0, environment, input); assert.equal(exhaust.shots, count); assert.equal(exhaust.shotCooldown, cooldown);
  assert.equal(exhaust.particles, pool); assert.equal(pool.length, 72); assert.equal(exhaust.flash.castShadow, false);
  assert.equal(exhaust.smoke.visible, true); for (const value of exhaust.smokePositions) assert.ok(Number.isFinite(value));
  exhaust.clear(); assert.ok(pool.every(particle => particle.life === 0));
  assert.equal(exhaust.flash.intensity, 0); assert.ok(exhaust.flames.every(flame => !flame.visible));
});
