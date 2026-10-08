import * as THREE from '../vendor/three.module.js';
import { damp, RecoveryTimer } from './simulation.js';
import { createRacingCar, RACING_COLLIDERS } from './car-model.js';
import { HeadlightSystem } from './headlights.js';
import { applyCarLighting } from './car-lighting.js';
import { createRacingWheel } from './wheels.js';
import { WheelSuspension } from './suspension.js';
import { CarBodyPose } from './body-pose.js';
import { WORLD_SIZE } from './scene-config.js';

const UP = new THREE.Vector3(0, 1, 0);
const CENTER_OF_MASS_OFFSET = 0.18;
export const VEHICLE_COLLIDERS = RACING_COLLIDERS;

export class Vehicle {
  constructor(scene, physics, track, notify) {
    this.physics = physics;
    this.track = track;
    this.notify = notify;
    this.recovery = new RecoveryTimer(3);
    this.recoveries = 0;
    this.steer = 0;
    this.speed = 0;
    this.throttle = 0;
    this.brakeForce = 0;
    this.braking = false;
    this.inContactCount = 0;
    this.centerOfMassOffset = CENTER_OF_MASS_OFFSET;
    this.colliderParts = VEHICLE_COLLIDERS.map(part => ({ ...part, position: new THREE.Vector3(...part.position).addScaledVector(UP, CENTER_OF_MASS_OFFSET) }));
    this.surface = track.nearest(track.spawn.position);
    this.forward = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.airVelocity = new THREE.Vector3();
    this.airInverseRotation = new THREE.Quaternion();
    this.airTime = 0;
    this.lastSafe = { position: track.spawn.position.clone().setY(1.1), quaternion: new THREE.Quaternion().setFromAxisAngle(UP, track.spawn.yaw) };
    this.mesh = this.createMesh();
    scene.add(this.mesh);
    this.headlightSystem = new HeadlightSystem(scene, this.mesh);
    this.headlights = this.headlightSystem.lights;
    const A = physics.A;
    const compound = new A.btCompoundShape();
    const localTransform = new A.btTransform();
    const localOrigin = new A.btVector3();
    for (const { size, position, points } of this.colliderParts) {
      let shape;
      if (points) {
        shape = new A.btConvexHullShape();
        for (const point of points) { localOrigin.setValue(...point); shape.addPoint(localOrigin, true); }
      } else {
        localOrigin.setValue(size[0] / 2, size[1] / 2, size[2] / 2);
        shape = new A.btBoxShape(localOrigin);
      }
      localTransform.setIdentity();
      shape.setMargin(0.01);
      localOrigin.setValue(position.x, position.y, position.z);
      localTransform.setOrigin(localOrigin);
      compound.addChildShape(localTransform, shape);
      physics.shapes.push(shape);
    }
    A.destroy(localOrigin);
    A.destroy(localTransform);
    this.item = physics.body(this.mesh, compound, this.lastSafe.position, 180, 0.35, this.lastSafe.quaternion);
    this.body = this.item.body;
    this.body.setActivationState(4);
    this.body.setCcdMotionThreshold(0.05);
    this.body.setCcdSweptSphereRadius(0.22);
    const tuning = new A.btVehicleTuning();
    const raycaster = new A.btDefaultVehicleRaycaster(physics.world);
    this.controller = new A.btRaycastVehicle(tuning, this.body, raycaster);
    this.controller.setCoordinateSystem(0, 1, 2);
    physics.world.addAction(this.controller);
    const direction = new A.btVector3(0, -1, 0), axle = new A.btVector3(-1, 0, 0);
    this.wheels = [];
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const connection = new A.btVector3(i % 2 === 0 ? -0.86 : 0.86, 0.18 + CENTER_OF_MASS_OFFSET, front ? 1 : -1.04);
      const wheel = this.controller.addWheel(connection, direction, axle, 0.48, 0.4, tuning, front);
      wheel.set_m_suspensionStiffness(30);
      wheel.set_m_wheelsDampingRelaxation(4.2);
      wheel.set_m_wheelsDampingCompression(5.6);
      wheel.set_m_maxSuspensionForce(3600);
      wheel.set_m_maxSuspensionTravelCm(22);
      wheel.set_m_frictionSlip(3.8);
      wheel.set_m_rollInfluence(0.12);
      const mesh = this.createWheel();
      scene.add(mesh);
      this.wheels.push({ mesh, position: this.lastSafe.position.clone(), previousPosition: this.lastSafe.position.clone(), quaternion: this.lastSafe.quaternion.clone(), previousQuaternion: this.lastSafe.quaternion.clone() });
      A.destroy(connection);
    }
    A.destroy(direction);
    A.destroy(axle);
    this.updateWheels();
    for (const wheel of this.wheels) {
      wheel.previousPosition.copy(wheel.position); wheel.previousQuaternion.copy(wheel.quaternion);
      wheel.mesh.position.copy(wheel.position); wheel.mesh.quaternion.copy(wheel.quaternion);
    }
    this.suspension = new WheelSuspension(this); this.suspension.update();
    this.bodyPose = new CarBodyPose(this);
  }
  createMesh() {
    const root = createRacingCar(CENTER_OF_MASS_OFFSET);
    this.lampMaterial = root.userData.lampMaterial;
    this.popupLampMaterial = root.userData.popupLampMaterial;
    this.tailMaterial = root.userData.tailMaterial;
    this.reverseLampMaterial = root.userData.reverseLampMaterial;
    return root;
  }
  createWheel() {
    return createRacingWheel();
  }
  preStep(dt, input, environment) {
    for (const wheel of this.wheels) { wheel.previousPosition.copy(wheel.position); wheel.previousQuaternion.copy(wheel.quaternion); }
    this.surface = this.track.nearest(this.item.position);
    const v = this.body.getLinearVelocity();
    this.speed = Math.hypot(v.x(), v.z());
    this.forward.set(0, 0, 1).applyQuaternion(this.item.quaternion);
    const forwardSpeed = v.x() * this.forward.x + v.z() * this.forward.z;
    const steering = (Number(input.left) - Number(input.right)) * 0.46 / (1 + this.speed * 0.024);
    this.steer = damp(this.steer, steering, 8, dt);
    const requestedThrottle = Number(input.forward) - Number(input.backward);
    this.throttle = damp(this.throttle, requestedThrottle, 7, dt);
    const throttle = Math.abs(this.throttle) < 0.01 ? 0 : this.throttle;
    const limit = input.boost ? 44 : 34;
    const force = throttle * (input.boost ? 2700 : 1950) * Math.max(0, 1 - Math.abs(forwardSpeed) / (throttle < 0 ? 12 : limit));
    const reversing = requestedThrottle && forwardSpeed * requestedThrottle < -0.7;
    // Bullet's wheel brake is an impulse per physics step, so the old value 95
    // stopped the car almost immediately. Ramp up a moderate braking impulse.
    const brakeTarget = input.brake ? 5.5 : reversing ? 7.5 : requestedThrottle ? 0 : 0.32;
    this.brakeForce = damp(this.brakeForce, brakeTarget, 7, dt);
    const grip = this.surface.onRoad ? 3.8 - environment.wetness * 1.65 : 2.8 - environment.wetness * 0.5;
    for (let i = 0; i < 4; i++) {
      this.controller.applyEngineForce(reversing || input.brake ? 0 : force / 4, i);
      this.controller.setBrake(this.brakeForce * dt * 60, i);
      this.controller.getWheelInfo(i).set_m_frictionSlip(input.brake && i >= 2 ? grip * 0.5 : grip);
      if (i < 2) this.controller.setSteeringValue(this.steer, i);
    }
    const grounded = this.inContactCount > 0;
    this.body.setDamping(grounded ? this.surface.onRoad ? 0.045 : 0.12 : 0.015, 0.18);
    this.stabilizeJump(dt);
    this.braking = Boolean(input.brake || requestedThrottle * forwardSpeed < -0.15);
  }
  postStep(dt) {
    this.updateWheels();
    this.up.copy(UP).applyQuaternion(this.item.quaternion);
    const v = this.body.getLinearVelocity();
    this.speed = Math.hypot(v.x(), v.z());
    this.bodyPose.update();
    const stable = this.up.y > 0.85 && this.item.position.y < 1.8 && this.surface.onRoad;
    if (stable) {
      this.lastSafe.position.copy(this.item.position).setY(1.1);
      this.lastSafe.quaternion.setFromAxisAngle(UP, this.track.point(this.surface.progress).yaw);
    }
    if (this.recovery.step(this.up.y, Math.hypot(v.x(), v.y(), v.z()), dt)) this.recover();
    if (this.item.position.y < -3 || Math.abs(this.item.position.x) > WORLD_SIZE.width / 2 - 2 || Math.abs(this.item.position.z) > WORLD_SIZE.depth / 2 - 2) this.recover(true);
  }
  stabilizeJump(dt) {
    if (this.inContactCount > 0) { this.airTime = 0; return; }
    this.airTime += dt;
    this.up.copy(UP).applyQuaternion(this.item.quaternion);
    if (this.airTime < 0.05 || this.speed < 4 || this.up.y < 0.55) return;
    // Soften pitch and roll after the rear suspension leaves the lip. Linear
    // momentum and yaw remain physical; deliberate flips still work.
    this.right.set(1, 0, 0).applyQuaternion(this.item.quaternion);
    const angular = this.body.getAngularVelocity();
    this.airInverseRotation.copy(this.item.quaternion).invert();
    this.airVelocity.set(angular.x(), angular.y(), angular.z()).applyQuaternion(this.airInverseRotation);
    const pitch = Math.asin(THREE.MathUtils.clamp(this.forward.y, -1, 1));
    const roll = Math.asin(THREE.MathUtils.clamp(this.right.y, -1, 1));
    const amount = 1 - Math.exp(-9 * dt);
    this.airVelocity.x = THREE.MathUtils.lerp(this.airVelocity.x, THREE.MathUtils.clamp((pitch - 0.045) * 4, -1.4, 1.4), amount);
    this.airVelocity.z = THREE.MathUtils.lerp(this.airVelocity.z, THREE.MathUtils.clamp(-roll * 4, -1.4, 1.4), amount);
    this.airVelocity.applyQuaternion(this.item.quaternion);
    this.physics.vector.setValue(this.airVelocity.x, this.airVelocity.y, this.airVelocity.z);
    this.body.setAngularVelocity(this.physics.vector);
  }
  updateWheels() {
    this.inContactCount = 0;
    for (let i = 0; i < 4; i++) {
      const info = this.controller.getWheelInfo(i).get_m_raycastInfo();
      this.wheels[i].inContact = info.get_m_isInContact();
      this.wheels[i].suspensionLength = info.get_m_suspensionLength();
      if (this.wheels[i].inContact) this.inContactCount++;
      this.controller.updateWheelTransform(i, false);
      const transform = this.controller.getWheelTransformWS(i);
      const p = transform.getOrigin(), q = transform.getRotation();
      this.wheels[i].position.set(p.x(), p.y(), p.z());
      this.wheels[i].quaternion.set(q.x(), q.y(), q.z(), q.w());
    }
  }
  render(alpha, environment) {
    this.bodyPose.render(alpha);
    for (const wheel of this.wheels) {
      wheel.mesh.position.lerpVectors(wheel.previousPosition, wheel.position, alpha);
      wheel.mesh.quaternion.slerpQuaternions(wheel.previousQuaternion, wheel.quaternion, alpha);
    }
    this.suspension.update();
    this.headlightSystem.update(environment);
    this.mesh.userData.glassMaterial.userData.daylight.value = environment.daylight;
    const velocity = this.body.getLinearVelocity();
    this.forward.set(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    const forwardSpeed = velocity.x() * this.forward.x + velocity.y() * this.forward.y + velocity.z() * this.forward.z;
    applyCarLighting(this.mesh.userData, this.headlightSystem, this.braking, forwardSpeed);
  }
  recover(offTrack = false) {
    let position, quaternion;
    if (offTrack) { position = this.lastSafe.position; quaternion = this.lastSafe.quaternion; }
    else {
      const nearest = this.track.nearest(this.item.position);
      const anchor = this.track.point(nearest.progress);
      position = anchor.position.setY(1.3);
      quaternion = new THREE.Quaternion().setFromAxisAngle(UP, anchor.yaw);
    }
    this.physics.teleport(this.item, position, quaternion);
    this.controller.resetSuspension();
    this.bodyPose.update();
    this.recovery.reset();
    this.airTime = 0;
    this.recoveries++;
    this.notify('Back on your wheels!');
  }
  reset() {
    const position = this.track.spawn.position.clone().setY(1.1);
    const quaternion = new THREE.Quaternion().setFromAxisAngle(UP, this.track.spawn.yaw);
    this.physics.teleport(this.item, position, quaternion);
    this.controller.resetSuspension();
    this.bodyPose.update();
    this.recovery.reset();
    this.airTime = 0;
    this.steer = 0;
    this.throttle = 0;
    this.brakeForce = 0;
    this.braking = false;
    this.notify('Back at the start');
  }
  flip() {
    const position = this.item.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    const quaternion = this.item.quaternion.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
    this.physics.teleport(this.item, position, quaternion);
    this.controller.resetSuspension();
    this.bodyPose.update();
    this.recovery.reset();
    this.airTime = 0;
    this.notify('Flipped over. Recovery in 3 seconds');
  }
}
