import * as THREE from '../vendor/three.module.js';
import { WHEEL_WELL_MAX_HUB_Y } from './wheel-wells.js';

// Fit the raised body to its wheel openings without changing Bullet's springs,
// forces or handling. There is no additional landing or driving animation.
export class CarBodyPose {
  constructor(vehicle) {
    this.vehicle = vehicle;
    this.rideHeight = 0.06;
    this.restHubY = 0.18 - 0.48 + 9.81 / (4 * 30) - this.rideHeight;
    this.up = new THREE.Vector3(); this.point = new THREE.Vector3();
    this.inverse = new THREE.Quaternion();
    this.pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
    this.update();
  }

  apply(target, physical, alpha) {
    this.up.set(0, 1, 0).applyQuaternion(physical.quaternion);
    target.position.copy(physical.position).addScaledVector(this.up, this.rideHeight);
    target.quaternion.copy(physical.quaternion);
    if (this.up.y < 0.55) return;
    this.inverse.copy(target.quaternion).invert();
    const rest = this.vehicle.centerOfMassOffset + this.restHubY;
    const travel = WHEEL_WELL_MAX_HUB_Y - this.restHubY;
    let lift = 0;
    for (let i = 0; i < this.vehicle.wheels.length; i++) {
      const wheel = this.vehicle.wheels[i];
      this.point.lerpVectors(wheel.previousPosition, wheel.position, alpha)
        .sub(target.position).applyQuaternion(this.inverse);
      // Wheel transforms can still describe the old location after a teleport.
      if (Math.abs(this.point.x - (i % 2 ? 0.86 : -0.86)) > 0.08 ||
          Math.abs(this.point.z - (i < 2 ? 1 : -1.04)) > 0.08) continue;
      const compression = Math.max(0, this.point.y - rest);
      const visible = travel * -Math.expm1(-compression / travel);
      lift = Math.max(lift, compression - visible);
    }
    target.position.addScaledVector(this.up, lift);
  }

  update() { this.apply(this.pose, this.vehicle.item, 1); }

  render(alpha) {
    const { item, mesh } = this.vehicle;
    mesh.position.lerpVectors(item.previousPosition, item.position, alpha);
    mesh.quaternion.slerpQuaternions(item.previousQuaternion, item.quaternion, alpha);
    this.apply(mesh, mesh, alpha);
  }
}
