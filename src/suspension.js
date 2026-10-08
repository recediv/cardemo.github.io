import * as THREE from '../vendor/three.module.js';

const UP = new THREE.Vector3(0, 1, 0), AXLE = new THREE.Vector3(1, 0, 0);
const ARM_HEIGHTS = [false, true], PIVOT_OFFSETS = [-0.14, 0.14];
let assets;

function createAssets() {
  const springPoints = Array.from({ length: 41 }, (_, i) => {
    const t = i / 40, angle = t * Math.PI * 10;
    return new THREE.Vector3(Math.cos(angle) * 0.031, (t - 0.5) * 0.22, Math.sin(angle) * 0.031);
  });
  const hub = new THREE.CylinderGeometry(0.063, 0.063, 0.055, 12).rotateZ(Math.PI / 2).toNonIndexed();
  const upright = new THREE.BoxGeometry(0.047, 0.18, 0.065).toNonIndexed();
  const steeringArm = new THREE.BoxGeometry(0.035, 0.025, 0.16).translate(0, -0.012, -0.07).toNonIndexed();
  const knuckle = new THREE.BufferGeometry();
  for (const attribute of ['position', 'normal']) knuckle.setAttribute(attribute, new THREE.Float32BufferAttribute([
    ...hub.attributes[attribute].array, ...upright.attributes[attribute].array, ...steeringArm.attributes[attribute].array,
  ], 3));
  hub.dispose(); upright.dispose(); steeringArm.dispose();
  return {
    bar: new THREE.CylinderGeometry(1, 1, 1, 8),
    spring: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(springPoints), 40, 0.005, 4, false),
    boot: new THREE.LatheGeometry([[0.018, -0.035], [0.025, -0.03], [0.035, -0.016], [0.03, 0], [0.035, 0.016], [0.025, 0.035]]
      .map(([radius, y]) => new THREE.Vector2(radius, y)), 8),
    knuckle, caliper: new THREE.BoxGeometry(0.045, 0.10, 0.07).translate(0, 0.073, -0.164),
  };
}

export class WheelSuspension {
  constructor(vehicle) {
    this.vehicle = vehicle; assets ??= createAssets();
    this.root = new THREE.Group(); this.root.name = 'wheel-suspension';
    this.root.position.y = vehicle.centerOfMassOffset; vehicle.mesh.add(this.root);
    const frame = vehicle.mesh.getObjectByName('underbody-frame').material;
    const metal = vehicle.mesh.getObjectByName('underbody-drivetrain').material;
    const paint = vehicle.mesh.getObjectByName('tapered-body').material[0];
    const instances = (name, geometry, material, count) => {
      const mesh = new THREE.InstancedMesh(geometry, material, count); mesh.name = name;
      mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(mesh); return mesh;
    };
    this.arms = instances('suspension-wishbones', assets.bar, frame, 18);
    this.drives = instances('suspension-shafts-and-dampers', assets.bar, metal, 12);
    this.springs = instances('suspension-springs', assets.spring, frame, 4);
    this.boots = instances('suspension-cv-boots', assets.boot, frame, 8);
    this.knuckles = instances('suspension-knuckles', assets.knuckle, metal, 4);
    this.calipers = instances('suspension-brake-calipers', assets.caliper, paint, 4);
    this.inverse = new THREE.Matrix4(); this.inverseRotation = new THREE.Quaternion();
    this.matrix = new THREE.Matrix4(); this.rotation = new THREE.Quaternion(); this.scale = new THREE.Vector3();
    this.direction = new THREE.Vector3(); this.middle = new THREE.Vector3(); this.center = new THREE.Vector3();
    this.axis = new THREE.Vector3(); this.hub = new THREE.Vector3(); this.anchor = new THREE.Vector3();
    this.lower = new THREE.Vector3(); this.upper = new THREE.Vector3(); this.top = new THREE.Vector3();
    this.bottom = new THREE.Vector3(); this.split = new THREE.Vector3(); this.coilEnd = new THREE.Vector3();
  }

  span(mesh, index, start, end, radius, baseLength = 1) {
    this.direction.subVectors(end, start);
    const length = Math.max(this.direction.length(), 1e-6);
    this.rotation.setFromUnitVectors(UP, this.direction.multiplyScalar(1 / length));
    this.middle.copy(start).add(end).multiplyScalar(0.5);
    this.scale.set(radius, length / baseLength, radius);
    mesh.setMatrixAt(index, this.matrix.compose(this.middle, this.rotation, this.scale));
  }

  update() {
    const car = this.vehicle.mesh;
    car.updateWorldMatrix(true, false); this.inverse.copy(car.matrixWorld).invert();
    this.inverseRotation.copy(car.quaternion).invert();
    let armIndex = 0;
    for (let i = 0; i < 4; i++) {
      const wheel = this.vehicle.wheels[i].mesh, side = i % 2 === 0 ? -1 : 1, z = i < 2 ? 1 : -1.04;
      this.center.copy(wheel.position).applyMatrix4(this.inverse); this.center.y -= this.vehicle.centerOfMassOffset;
      // Wheel spin leaves its axle unchanged, so hubs and calipers only steer.
      this.axis.copy(AXLE).applyQuaternion(wheel.quaternion).applyQuaternion(this.inverseRotation).normalize();
      if (this.axis.x < 0) this.axis.negate();
      this.hub.copy(this.center).addScaledVector(this.axis, -side * 0.113);
      this.lower.copy(this.hub); this.lower.y -= 0.066;
      this.upper.copy(this.hub); this.upper.y += 0.066;
      for (const upper of ARM_HEIGHTS) for (const offset of PIVOT_OFFSETS) {
        this.anchor.set(side * 0.425, (z > 0 ? -0.105 : -0.135) + (upper ? 0.082 : -0.006), z + offset);
        this.span(this.arms, armIndex++, this.anchor, upper ? this.upper : this.lower, upper ? 0.013 : 0.016);
      }
      if (i < 2) {
        this.anchor.set(side * 0.30, -0.12, z - 0.125);
        this.rotation.setFromUnitVectors(AXLE, this.axis);
        this.split.set(0, -0.012, -0.115).applyQuaternion(this.rotation).add(this.hub);
        this.span(this.arms, armIndex++, this.anchor, this.split, 0.011);
      }
      this.anchor.set(side * 0.13, z > 0 ? -0.12 : -0.132, z);
      this.span(this.drives, i * 3, this.anchor, this.hub, 0.022);
      this.rotation.setFromUnitVectors(UP, this.direction); this.scale.setScalar(1);
      for (let end = 0; end < 2; end++) {
        this.middle.lerpVectors(this.anchor, this.hub, end ? 0.95 : 0.07);
        this.boots.setMatrixAt(i * 2 + end, this.matrix.compose(this.middle, this.rotation, this.scale));
      }
      this.top.set(side * 0.56, z > 0 ? 0.075 : 0.105, z);
      this.bottom.copy(this.hub); this.bottom.y += 0.064;
      this.split.lerpVectors(this.bottom, this.top, 0.55);
      this.span(this.drives, i * 3 + 1, this.bottom, this.split, 0.015);
      this.span(this.drives, i * 3 + 2, this.split, this.top, 0.009);
      this.coilEnd.lerpVectors(this.bottom, this.top, 0.17);
      this.span(this.springs, i, this.coilEnd, this.top, 1, 0.22);
      this.rotation.setFromUnitVectors(AXLE, this.axis); this.scale.setScalar(1);
      this.matrix.compose(this.hub, this.rotation, this.scale);
      this.knuckles.setMatrixAt(i, this.matrix); this.calipers.setMatrixAt(i, this.matrix);
    }
    for (const part of this.root.children) part.instanceMatrix.needsUpdate = true;
  }
}
