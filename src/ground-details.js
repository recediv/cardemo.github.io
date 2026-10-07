import * as THREE from '../vendor/three.module.js';
import { randomGenerator, smoothstep, clamp } from './simulation.js';
import { applySceneStyle } from './day-cycle.js';
import { createGroundLeafMask, createBarkTexture } from './vegetation.js';
import { WORLD_SIZE } from './scene-config.js';

// Leaves.js (folio-2025, MIT): fixed leaf data, sideways/forward vehicle push,
// light gravity, air rotation and damping. CPU simulation suits this WebGL demo.
export class GroundDetails {
  constructor(scene, physics, track, terrain, trees, palette, wind) {
    this.track = track; this.physics = physics; this.wind = wind; this.terrain = terrain;
    this.random = randomGenerator(19241); this.dummy = new THREE.Object3D();
    this.active = new Set(); this.buckets = new Map(); this.cellSize = 4;
    this.previousVehicle = null; this.elapsed = 0; this.scatterCount = 0;
    this.windCursor = 0; this.windScanBudget = 0; this.windActive = new Set();
    this.stoneFootprints = []; this.woodFootprints = [];
    this.makeStones(scene, terrain);
    this.makeWood(scene, terrain, trees, palette);
    this.makeLeaves(scene, trees, palette);
  }
  makeWood(scene, terrain, trees, palette) {
    const bark = applySceneStyle(new THREE.MeshStandardMaterial({ color: '#80664c', map: createBarkTexture('brown'), roughness: 1 }), palette);
    const cutSize = 64, cutData = new Uint8Array(cutSize * cutSize * 4);
    for (let y = 0; y < cutSize; y++) for (let x = 0; x < cutSize; x++) {
      const radius = Math.hypot((x + 0.5) / cutSize * 2 - 1, (y + 0.5) / cutSize * 2 - 1);
      const ring = 0.92 + Math.sin(radius * 45) * 0.08, index = (y * cutSize + x) * 4;
      cutData[index] = 188 * ring; cutData[index + 1] = 154 * ring; cutData[index + 2] = 103 * ring; cutData[index + 3] = 255;
    }
    const cutMap = new THREE.DataTexture(cutData, cutSize, cutSize, THREE.RGBAFormat);
    cutMap.colorSpace = THREE.SRGBColorSpace; cutMap.magFilter = THREE.LinearFilter; cutMap.minFilter = THREE.LinearMipmapLinearFilter; cutMap.generateMipmaps = true; cutMap.needsUpdate = true;
    const cut = applySceneStyle(new THREE.MeshStandardMaterial({ map: cutMap, roughness: 1 }), palette);
    const logCount = 6, branchCount = 24;
    this.logs = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 12), [bark, cut, cut], logCount); this.logs.name = 'fallen-logs';
    this.branches = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.65, 1, 1, 6), bark, branchCount * 3); this.branches.name = 'fallen-branches';
    const up = new THREE.Vector3(0, 1, 0), direction = new THREE.Vector3();
    const placementRandom = randomGenerator(71245);
    const place = (length, radius, angle, branch = false) => {
      const dx = Math.cos(angle), dz = Math.sin(angle);
      const halfLength = length * (branch ? 0.7 : 0.5), halfWidth = branch ? length * 0.3 : radius + 0.15;
      const footprint = Math.hypot(halfLength, halfWidth);
      let best = null, bestScore = -Infinity;
      for (let attempt = 0; attempt < 640; attempt++) {
        const x = (placementRandom() - 0.5) * (WORLD_SIZE.width - 10), z = (placementRandom() - 0.5) * (WORLD_SIZE.depth - 10);
        if (Math.abs(x) + footprint > WORLD_SIZE.width / 2 - 2 || Math.abs(z) + footprint > WORLD_SIZE.depth / 2 - 2) continue;
        if (terrain.isLand && !terrain.isLand(x, z, footprint + 0.3)) continue;
        const density = terrain.sampleDensity(x, z); if (density > 0.48) continue;
        const road = this.track.nearest({ x, z }).distance;
        if (road < this.track.width / 2 + this.track.curbWidth + halfLength + 0.25) continue;
        // The whole log or forked branch must fit a pre-existing bare patch.
        let bare = true;
        for (const along of [-1, -0.5, 0, 0.5, 1]) for (const across of [-1, 0, 1]) {
          if (terrain.sampleDensity(x + dx * halfLength * along - dz * halfWidth * across, z + dz * halfLength * along + dx * halfWidth * across) > 0.48) bare = false;
        }
        if (!bare) continue;
        const distanceToWood = object => {
          const along = clamp((object.x - x) * dx + (object.z - z) * dz, -halfLength, halfLength);
          return Math.hypot(object.x - x - dx * along, object.z - z - dz * along);
        };
        if (trees.some(tree => distanceToWood(tree) < 1.1 + halfWidth)) continue;
        if (this.stoneFootprints.some(stone => distanceToWood(stone) < stone.radius + halfWidth + 0.35)) continue;
        let gap = 14;
        for (const wood of this.woodFootprints) gap = Math.min(gap, Math.hypot(wood.x - x, wood.z - z) - footprint - wood.radius);
        if (gap < 2.2) continue;
        const score = gap + (0.48 - density) * 4 - Math.max(0, road - 14) * 0.2;
        if (score > bestScore) { best = { x, z, radius: footprint }; bestScore = score; }
      }
      if (best) this.woodFootprints.push(best);
      return best;
    };
    const write = (mesh, index, x, y, z, length, radius, angle) => {
      direction.set(Math.cos(angle), 0, Math.sin(angle));
      this.dummy.position.set(x, y, z); this.dummy.scale.set(radius, length, radius);
      this.dummy.quaternion.setFromUnitVectors(up, direction); this.dummy.updateMatrix(); mesh.setMatrixAt(index, this.dummy.matrix);
    };
    let logsPlaced = 0, branchesPlaced = 0;
    for (let i = 0; i < logCount; i++) {
      const length = 2 + this.random() * 2.1, radius = 0.18 + this.random() * 0.15, angle = this.random() * Math.PI * 2;
      const p = place(length, radius, angle); if (!p) continue;
      write(this.logs, logsPlaced++, p.x, radius * 0.85, p.z, length, radius, angle);
      const A = this.physics.A;
      if (A) {
        const half = new A.btVector3(radius, length / 2, radius), shape = new A.btCylinderShape(half); A.destroy(half); shape.setMargin(0.004);
        this.physics.body(null, shape, this.dummy.position.clone(), 0, 0.85, this.dummy.quaternion.clone());
      }
    }
    for (let i = 0; i < branchCount; i++) {
      const length = 0.65 + this.random() * 1.1, radius = 0.02 + this.random() * 0.025, angle = this.random() * Math.PI * 2;
      const p = place(length, radius, angle, true); if (!p) continue;
      const slot = branchesPlaced++ * 3;
      write(this.branches, slot, p.x, radius * 0.85, p.z, length, radius, angle);
      const rootX = p.x + Math.cos(angle) * length * 0.3, rootZ = p.z + Math.sin(angle) * length * 0.3;
      for (let fork = 0; fork < 2; fork++) {
        const forkLength = length * (0.22 + this.random() * 0.15), forkAngle = angle + (fork ? -1 : 1) * (0.55 + this.random() * 0.35);
        write(this.branches, slot + fork + 1, rootX + Math.cos(forkAngle) * forkLength / 2, radius * 0.7, rootZ + Math.sin(forkAngle) * forkLength / 2, forkLength, radius * 0.5, forkAngle);
      }
    }
    this.logs.count = logsPlaced; this.branches.count = branchesPlaced * 3;
    for (const mesh of [this.logs, this.branches]) { mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh); }
  }
  groundHeight(x, z) {
    const distance = this.track.nearest({ x, z }).distance, offset = distance - this.track.width / 2;
    if (offset < 0) return this.track.height;
    const curbHeight = this.track.curbHeight ?? 0.06, curbRamp = this.track.curbRampWidth ?? 0.24;
    if (offset < curbRamp) return THREE.MathUtils.lerp(this.track.height, curbHeight, offset / curbRamp);
    if (offset < 0.65) return curbHeight;
    if (offset < this.track.curbWidth) return THREE.MathUtils.lerp(curbHeight, 0.012, (offset - 0.65) / (this.track.curbWidth - 0.65));
    return this.terrain.surfaceHeight?.(x, z) ?? 0;
  }
  makeStones(scene, terrain) {
    const count = 80, geometry = new THREE.IcosahedronGeometry(1, 0);
    const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true });
    this.stones = new THREE.InstancedMesh(geometry, material, count); this.stones.name = 'scattered-stones';
    const colors = ['#8c9288', '#aaa998', '#7d877b', '#b9b2a0'].map(c => new THREE.Color(c));
    let placed = 0;
    for (let i = 0; i < count; i++) {
      const radius = i % 7 === 0 ? 0.28 + this.random() * 0.25 : 0.06 + this.random() * 0.14;
      let x, z;
      let valid = false;
      for (let attempt = 0; attempt < 96; attempt++) {
        x = (this.random() - 0.5) * (WORLD_SIZE.width - 9); z = (this.random() - 0.5) * (WORLD_SIZE.depth - 9);
        const clearance = this.track.width / 2 + this.track.curbWidth + 3 + radius * 1.4;
        if (this.track.nearest({ x, z }).distance < clearance || (terrain.isLand && !terrain.isLand(x, z, radius * 1.4))) continue;
        valid = true; break;
      }
      if (!valid) continue;
      const scale = new THREE.Vector3(radius * (0.9 + this.random() * 0.5), radius * (0.42 + this.random() * 0.4), radius * (0.8 + this.random() * 0.6));
      this.dummy.position.set(x, scale.y * 0.78, z); this.dummy.scale.copy(scale); this.dummy.rotation.set(0, this.random() * Math.PI * 2, 0); this.dummy.updateMatrix();
      this.stones.setMatrixAt(placed, this.dummy.matrix); this.stones.setColorAt(placed++, colors[i % colors.length]);
      this.stoneFootprints.push({ x, z, radius: Math.max(scale.x, scale.z) });
      if (radius > 0.22) {
        terrain.clearGrass(x, z, Math.max(0.85, radius * 2.3), 0.94);
        // Collider is the same convex polyhedron as the visible stone.
        const A = this.physics.A;
        if (A) {
          const shape = new A.btConvexHullShape(), point = new A.btVector3(), vertices = geometry.attributes.position;
          for (let v = 0; v < vertices.count; v++) { point.setValue(vertices.getX(v) * scale.x, vertices.getY(v) * scale.y, vertices.getZ(v) * scale.z); shape.addPoint(point, true); }
          A.destroy(point); shape.setMargin(0.003);
          this.physics.body(null, shape, this.dummy.position.clone(), 0, 0.8, this.dummy.quaternion.clone());
        }
      }
    }
    this.stones.count = placed; this.stones.castShadow = this.stones.receiveShadow = true; scene.add(this.stones);
  }
  cell(x, z) { return `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`; }
  putToRest(index) {
    const leaf = this.leaves[index], key = this.cell(leaf.position.x, leaf.position.z);
    if (leaf.cell) {
      const old = this.buckets.get(leaf.cell); old?.delete(index);
      if (old?.size === 0) this.buckets.delete(leaf.cell);
    }
    if (!this.buckets.has(key)) this.buckets.set(key, new Set());
    this.buckets.get(key).add(index); leaf.cell = key;
  }
  makeLeaves(scene, trees, palette) {
    const count = 2100, geometry = new THREE.PlaneGeometry(1, 1);
    const positions = geometry.attributes.position.array;
    positions[0] += 0.15; positions[3] += 0.15; positions[6] -= 0.15; positions[9] -= 0.15;
    geometry.rotateX(-Math.PI / 2);
    const material = applySceneStyle(new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide, alphaMap: createGroundLeafMask('oak'), alphaTest: 0.45, alphaToCoverage: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), palette, false, { directLight: 0 });
    this.mesh = new THREE.InstancedMesh(geometry, material, count); this.mesh.name = 'loose-ground-leaves';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    const colors = ['#95513a', '#cc663b', '#f56a3a', '#caa535', '#e6c33d', '#f0d66a'].map(value => new THREE.Color(value));
    const color = new THREE.Color();
    const broadTrees = trees.filter(t => t.kind !== 'pine');
    const roadPatches = Array.from({ length: 20 }, () => ({
      center: this.track.point(this.random(), (this.random() - 0.5) * this.track.width * 0.8).position,
      radius: 1.1 + this.random() * 2.2,
    }));
    this.leaves = [];
    for (let i = 0; i < count; i++) {
      let x, z;
      if (i < 1240) {
        // Loose scatter with small rounded patches, without a start-line band.
        if (this.random() < 0.25) {
          const patch = roadPatches[Math.floor(this.random() * roadPatches.length)];
          const angle = this.random() * Math.PI * 2, radius = this.random() ** 0.7 * patch.radius;
          x = patch.center.x + Math.cos(angle) * radius; z = patch.center.z + Math.sin(angle) * radius;
        } else {
          const p = this.track.point(this.random(), (this.random() - 0.5) * (this.track.width + this.track.curbWidth)).position;
          x = p.x; z = p.z;
        }
      } else if (i < 1940 && broadTrees.length) {
        const tree = broadTrees[i % broadTrees.length], angle = this.random() * Math.PI * 2, radius = this.random() * tree.radius * 1.8;
        x = tree.x + Math.cos(angle) * radius; z = tree.z + Math.sin(angle) * radius;
      } else { x = (this.random() - 0.5) * (WORLD_SIZE.width - 6); z = (this.random() - 0.5) * (WORLD_SIZE.depth - 6); }
      while (this.terrain.isLand && !this.terrain.isLand(x, z, 0.2)) {
        x = (this.random() - 0.5) * (WORLD_SIZE.width - 6); z = (this.random() - 0.5) * (WORLD_SIZE.depth - 6);
      }
      const floor = this.groundHeight(x, z) + 0.018;
      this.leaves.push({ position: new THREE.Vector3(x, floor, z), floor, velocity: new THREE.Vector3(), scale: 0.28 + this.random() * 0.24, yaw: this.random() * Math.PI * 2, phase: this.random() * Math.PI * 2, weight: 0.1 + this.random() * 0.1, tilt: (this.random() - 0.5) * 0.035, lastPush: -2, windAfter: this.random() * 3, cell: null });
      const shade = this.random() * colors.length;
      this.mesh.setColorAt(i, color.copy(colors[Math.floor(shade)]).multiplyScalar(0.92 + (shade % 1) * 0.16));
      this.writeMatrix(i); this.putToRest(i);
    }
    scene.add(this.mesh);
  }
  writeMatrix(index) {
    const leaf = this.leaves[index];
    const height = Math.max(0, leaf.position.y - leaf.floor);
    const air = this.active.has(index) ? smoothstep(0, 0.75, height) * 0.7 : 0;
    this.dummy.position.copy(leaf.position); this.dummy.scale.set(leaf.scale * 0.75, leaf.scale, leaf.scale);
    this.dummy.rotation.set(leaf.tilt + Math.sin(this.elapsed * 5 + leaf.phase) * air, leaf.yaw, Math.cos(this.elapsed * 4.3 + leaf.phase) * air);
    this.dummy.updateMatrix(); this.mesh.setMatrixAt(index, this.dummy.matrix);
  }
  pushFromVehicle(position, velocity) {
    const speed = Math.hypot(velocity.x, velocity.z);
    const previous = this.previousVehicle && this.previousVehicle.distanceToSquared(position) < 144 ? this.previousVehicle : position;
    if (speed > 0.35 && position.y < 2) {
      const radius = 3.2, seen = new Set();
      const minX = Math.floor((Math.min(previous.x, position.x) - radius) / this.cellSize), maxX = Math.floor((Math.max(previous.x, position.x) + radius) / this.cellSize);
      const minZ = Math.floor((Math.min(previous.z, position.z) - radius) / this.cellSize), maxZ = Math.floor((Math.max(previous.z, position.z) + radius) / this.cellSize);
      const dx = position.x - previous.x, dz = position.z - previous.z, lengthSq = dx * dx + dz * dz;
      for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) for (const index of this.buckets.get(`${x},${z}`) ?? []) {
        if (seen.has(index)) continue; seen.add(index);
        const leaf = this.leaves[index]; if (this.elapsed - leaf.lastPush < 0.45 || leaf.position.y - this.groundHeight(leaf.position.x, leaf.position.z) > 1.4) continue;
        const t = lengthSq > 1e-6 ? clamp(((leaf.position.x - previous.x) * dx + (leaf.position.z - previous.z) * dz) / lengthSq) : 1;
        const sideX = leaf.position.x - previous.x - dx * t, sideZ = leaf.position.z - previous.z - dz * t, distance = Math.hypot(sideX, sideZ);
        const influence = 1 - smoothstep(0.4, radius, distance); if (influence <= 0) continue;
        const push = (2.0 + Math.min(speed, 28) * 0.48) * influence;
        // Leaves directly under the car's centre still receive a sideways kick,
        // so they emerge beside the wheels instead of hiding under the chassis.
        const sideLength = Math.max(0.001, distance), sign = index % 2 ? 1 : -1;
        const outwardX = distance > 0.15 ? sideX / sideLength : -velocity.z / speed * sign;
        const outwardZ = distance > 0.15 ? sideZ / sideLength : velocity.x / speed * sign;
        leaf.velocity.set(outwardX * push + velocity.x * 0.18 * influence, (1.2 + Math.min(speed * 0.12, 2.4)) * influence, outwardZ * push + velocity.z * 0.18 * influence);
        leaf.lastPush = this.elapsed; this.active.add(index); this.windActive.delete(index); this.scatterCount++;
      }
    }
    if (!this.previousVehicle) this.previousVehicle = position.clone(); else this.previousVehicle.copy(position);
  }
  wakeFromWind(dt, environment) {
    const strength = environment.windStrength;
    if (strength < 0.2) { this.windScanBudget = 0; return; }
    this.windScanBudget += dt * 720;
    const checks = Math.min(this.leaves.length, Math.floor(this.windScanBudget)); this.windScanBudget -= checks;
    const direction = this.wind.windDirection.value;
    for (let i = 0; i < checks; i++) {
      const index = this.windCursor; this.windCursor = (this.windCursor + 1) % this.leaves.length;
      const leaf = this.leaves[index];
      if (this.active.has(index) || this.elapsed < leaf.windAfter || this.windActive.size >= 96) continue;
      const gust = strength * (0.7 + Math.sin(this.elapsed * 1.1 + leaf.phase + leaf.position.x * 0.06) * 0.3);
      if (gust < 0.38) continue;
      const sideways = Math.sin(leaf.phase) * 0.55;
      leaf.velocity.set(direction.x * (0.7 + gust * 1.4) - direction.y * sideways, 0.55 + gust * 0.5, direction.y * (0.7 + gust * 1.4) + direction.x * sideways);
      leaf.windAfter = this.elapsed + 4.5 + leaf.phase * 0.6;
      this.active.add(index); this.windActive.add(index);
    }
  }
  update(dt, environment, vehicle = null) {
    if (dt <= 0) return; this.elapsed += dt;
    if (vehicle) {
      const v = vehicle.body.getLinearVelocity();
      this.pushFromVehicle(vehicle.mesh.position, { x: v.x(), z: v.z() });
    }
    this.wakeFromWind(dt, environment);
    if (!this.active.size) return;
    // Substeps keep gravity and landing stable even when a frame takes 100 ms.
    const steps = Math.ceil(dt * 60), step = dt / steps, changed = new Set(this.active);
    for (let i = 0; i < steps; i++) this.stepLeaves(step, environment);
    for (const index of changed) {
      const leaf = this.leaves[index];
      if (leaf.cell !== this.cell(leaf.position.x, leaf.position.z)) this.putToRest(index);
      this.writeMatrix(index);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  stepLeaves(dt, environment) {
    const airDamping = Math.exp(-1.2 * dt), wind = this.wind.windDirection.value;
    for (const index of this.active) {
      const leaf = this.leaves[index], velocity = leaf.velocity, position = leaf.position;
      const gust = environment.windStrength * (0.45 + Math.sin(this.elapsed * 0.8 + leaf.phase) * 0.2);
      velocity.x = velocity.x * airDamping + wind.x * gust * dt; velocity.z = velocity.z * airDamping + wind.y * gust * dt;
      velocity.y -= 9.807 * leaf.weight * dt; position.addScaledVector(velocity, dt);
      // Keep each leaf's actual position; clamping to a shared edge creates rows.
      const floor = this.groundHeight(position.x, position.z) + 0.018;
      leaf.floor = floor;
      if (position.y <= floor) {
        position.y = floor; velocity.y = 0; velocity.x *= Math.exp(-7 * dt); velocity.z *= Math.exp(-7 * dt);
        if (Math.hypot(velocity.x, velocity.z) < 0.08) { velocity.set(0, 0, 0); this.active.delete(index); this.windActive.delete(index); this.putToRest(index); }
      }
      leaf.yaw += (velocity.x + velocity.z) * dt * 0.7;
    }
  }
}
