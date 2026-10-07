import * as THREE from '../vendor/three.module.js';

export class Physics {
  constructor(Ammo) {
    this.A = Ammo;
    this.configuration = new Ammo.btDefaultCollisionConfiguration();
    this.dispatcher = new Ammo.btCollisionDispatcher(this.configuration);
    this.broadphase = new Ammo.btDbvtBroadphase();
    this.solver = new Ammo.btSequentialImpulseConstraintSolver();
    this.world = new Ammo.btDiscreteDynamicsWorld(this.dispatcher, this.broadphase, this.solver, this.configuration);
    const gravity = new Ammo.btVector3(0, -9.81, 0);
    this.world.setGravity(gravity);
    Ammo.destroy(gravity);
    this.transform = new Ammo.btTransform();
    this.vector = new Ammo.btVector3();
    this.dynamic = [];
    this.shapes = [];
    this.impactCooldown = 0;
    this.onImpact = null;
    this.ground = this.box(null, [130, 0.6, 110], new THREE.Vector3(0, -0.3, 0), 0, 0.85);
  }
  box(mesh, size, position, mass = 0, friction = 0.6, quaternion = new THREE.Quaternion()) {
    const A = this.A;
    const half = new A.btVector3(size[0] / 2, size[1] / 2, size[2] / 2);
    const shape = new A.btBoxShape(half);
    A.destroy(half);
    shape.setMargin(0.01);
    const item = this.body(mesh, shape, position, mass, friction, quaternion);
    if (mass) { item.body.setCcdMotionThreshold(0.04); item.body.setCcdSweptSphereRadius(Math.min(...size) * 0.2); }
    return item;
  }
  staticGeometry(geometries, friction = 0.85) {
    const A = this.A, triangles = new A.btTriangleMesh(true, true);
    const points = [new A.btVector3(), new A.btVector3(), new A.btVector3()];
    for (const geometry of geometries) {
      const vertices = geometry.attributes.position, indices = geometry.index?.array;
      for (let i = 0; i < (indices?.length ?? vertices.count); i += 3) {
        for (let j = 0; j < 3; j++) {
          const index = indices ? indices[i + j] : i + j;
          points[j].setValue(vertices.getX(index), vertices.getY(index), vertices.getZ(index));
        }
        triangles.addTriangle(...points, true);
      }
    }
    for (const point of points) A.destroy(point);
    const shape = new A.btBvhTriangleMeshShape(triangles, true, true);
    shape.setMargin(0.001);
    this.shapes.push(triangles);
    return this.body(null, shape, new THREE.Vector3(), 0, friction);
  }
  setGroundGeometry(geometry) {
    this.world.removeRigidBody(this.ground.body);
    this.ground = this.staticGeometry([geometry]);
  }
  body(mesh, shape, position, mass, friction, quaternion = new THREE.Quaternion()) {
    const A = this.A;
    const transform = new A.btTransform();
    transform.setIdentity();
    const origin = new A.btVector3(position.x, position.y, position.z);
    const rotation = new A.btQuaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    transform.setOrigin(origin);
    transform.setRotation(rotation);
    const motion = new A.btDefaultMotionState(transform);
    const inertia = new A.btVector3(0, 0, 0);
    if (mass) shape.calculateLocalInertia(mass, inertia);
    const info = new A.btRigidBodyConstructionInfo(mass, motion, shape, inertia);
    const body = new A.btRigidBody(info);
    body.setFriction(friction);
    body.setRestitution(0.13);
    body.setDamping(0.04, 0.12);
    this.world.addRigidBody(body);
    this.shapes.push(shape);
    const item = { body, mesh, previousPosition: position.clone(), position: position.clone(), previousQuaternion: quaternion.clone(), quaternion: quaternion.clone(), startPosition: position.clone(), startQuaternion: quaternion.clone() };
    if (mass) this.dynamic.push(item);
    if (mesh) { mesh.position.copy(position); mesh.quaternion.copy(quaternion); }
    for (const temporary of [origin, rotation, inertia, info, transform]) A.destroy(temporary);
    return item;
  }
  beforeStep() {
    for (const item of this.dynamic) {
      item.previousPosition.copy(item.position);
      item.previousQuaternion.copy(item.quaternion);
    }
  }
  step(dt) {
    // The outer loop owns fixed stepping, so Bullet must not add its own accumulator.
    this.world.stepSimulation(dt, 0);
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
    if (this.onImpact && this.impactCooldown === 0) {
      let strongest = 35, hit = null;
      for (let i = 0; i < this.dispatcher.getNumManifolds(); i++) {
        const manifold = this.dispatcher.getManifoldByIndexInternal(i);
        for (let j = 0; j < manifold.getNumContacts(); j++) {
          const contact = manifold.getContactPoint(j);
          if (contact.getAppliedImpulse() > strongest) { strongest = contact.getAppliedImpulse(); hit = contact; }
        }
      }
      if (hit) {
        const p = hit.getPositionWorldOnB();
        this.onImpact(Math.min(1, strongest / 280), { x: p.x(), y: p.y(), z: p.z() });
        this.impactCooldown = 0.16;
      }
    }
    for (const item of this.dynamic) {
      item.body.getMotionState().getWorldTransform(this.transform);
      const p = this.transform.getOrigin(), q = this.transform.getRotation();
      item.position.set(p.x(), p.y(), p.z());
      item.quaternion.set(q.x(), q.y(), q.z(), q.w());
      if (item.position.y < -8 || Math.abs(item.position.x) > 130 || Math.abs(item.position.z) > 110) this.teleport(item, item.startPosition, item.startQuaternion);
    }
  }
  render(alpha) {
    for (const item of this.dynamic) {
      if (!item.mesh) continue;
      item.mesh.position.lerpVectors(item.previousPosition, item.position, alpha);
      item.mesh.quaternion.slerpQuaternions(item.previousQuaternion, item.quaternion, alpha);
    }
  }
  teleport(item, position, quaternion) {
    const A = this.A;
    this.transform.setIdentity();
    this.vector.setValue(position.x, position.y, position.z);
    this.transform.setOrigin(this.vector);
    const rotation = new A.btQuaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    this.transform.setRotation(rotation);
    item.body.setWorldTransform(this.transform);
    item.body.getMotionState().setWorldTransform(this.transform);
    this.world.updateSingleAabb(item.body);
    this.vector.setValue(0, 0, 0);
    item.body.setLinearVelocity(this.vector);
    item.body.setAngularVelocity(this.vector);
    item.body.clearForces();
    item.body.activate();
    item.position.copy(position);
    item.previousPosition.copy(position);
    item.quaternion.copy(quaternion);
    item.previousQuaternion.copy(quaternion);
    A.destroy(rotation);
  }
}
