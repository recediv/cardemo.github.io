import * as THREE from '../vendor/three.module.js';

// Small cloth grid: Verlet integration, fixed mast edge and distance constraints.
// The render geometry itself moves, so its lighting and shadows follow the cloth.
export class ClothFlag {
  constructor(position, material, phase = 0) {
    const columns = 14, rows = 8, width = 1.15, height = 0.7, stride = columns + 1;
    this.geometry = new THREE.PlaneGeometry(width, height, columns, rows);
    this.geometry.translate(width / 2, 0, 0);
    this.mesh = new THREE.Mesh(this.geometry, material); this.mesh.position.copy(position);
    this.mesh.name = 'finish-cloth-flag'; this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.points = this.geometry.attributes.position.array;
    this.previous = this.points.slice(); this.rest = this.points.slice();
    this.pinned = new Uint8Array(this.points.length / 3);
    this.links = []; this.accumulator = 0; this.elapsed = phase; this.phase = phase;
    this.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
    const link = (a, b, stiffness) => {
      const ax = a * 3, bx = b * 3;
      const distance = Math.hypot(this.rest[bx] - this.rest[ax], this.rest[bx + 1] - this.rest[ax + 1], this.rest[bx + 2] - this.rest[ax + 2]);
      this.links.push({ a, b, distance, stiffness });
    };
    for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
      const index = row * stride + column; this.pinned[index] = Number(column === 0);
      if (column < columns) link(index, index + 1, 1);
      if (row < rows) link(index, index + stride, 1);
      if (column < columns && row < rows) { link(index, index + stride + 1, 0.7); link(index + 1, index + stride, 0.7); }
      if (column < columns - 1) link(index, index + 2, 0.08);
    }
  }
  step(dt, strength, direction) {
    this.elapsed += dt;
    const points = this.points, previous = this.previous, damping = Math.exp(-3 * dt), dtSq = dt * dt;
    const gust = 0.8 + Math.sin(this.elapsed * 1.7 + this.mesh.position.x * 0.1) * 0.2;
    for (let index = 0; index < this.pinned.length; index++) {
      const offset = index * 3;
      if (this.pinned[index]) {
        for (let axis = 0; axis < 3; axis++) points[offset + axis] = previous[offset + axis] = this.rest[offset + axis];
        continue;
      }
      const free = this.rest[offset] / 1.15;
      const flutter = Math.sin(this.elapsed * (6 + strength * 5) - free * 7 + this.phase);
      const forceX = direction.x * strength * 20 * gust, forceY = -9.81 + flutter * strength * free * 2, forceZ = (direction.y * 20 * gust + flutter * free * 14) * strength;
      for (let axis = 0; axis < 3; axis++) {
        const current = points[offset + axis];
        const force = axis === 0 ? forceX : axis === 1 ? forceY : forceZ;
        points[offset + axis] += (current - previous[offset + axis]) * damping + force * dtSq;
        previous[offset + axis] = current;
      }
    }
    for (let iteration = 0; iteration < 5; iteration++) for (const link of this.links) {
      const a = link.a * 3, b = link.b * 3;
      const dx = points[b] - points[a], dy = points[b + 1] - points[a + 1], dz = points[b + 2] - points[a + 2];
      const length = Math.hypot(dx, dy, dz); if (length < 1e-6) continue;
      const aFree = !this.pinned[link.a], bFree = !this.pinned[link.b];
      const weight = Number(aFree) + Number(bFree); if (!weight) continue;
      const correction = (length - link.distance) / length * link.stiffness / weight;
      if (aFree) { points[a] += dx * correction; points[a + 1] += dy * correction; points[a + 2] += dz * correction; }
      if (bFree) { points[b] -= dx * correction; points[b + 1] -= dy * correction; points[b + 2] -= dz * correction; }
    }
  }
  update(dt, strength, direction) {
    this.accumulator += Math.min(dt, 0.1);
    let moved = false;
    while (this.accumulator >= 1 / 60) { this.step(1 / 60, strength, direction); this.accumulator -= 1 / 60; moved = true; }
    if (moved) { this.geometry.attributes.position.needsUpdate = true; this.geometry.computeVertexNormals(); }
  }
}
