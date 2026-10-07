import * as THREE from '../vendor/three.module.js';
import { smoothstep } from './simulation.js';
import { applySceneStyle } from './day-cycle.js';
import { applyLakeSurface, createWaterUniforms } from './water.js';
import { TRACK_SCALE, GROUND_SIZE } from './scene-config.js';

const SEGMENTS = 128, BANK_WIDTH = 2.2;

export class Lake {
  constructor() {
    this.waterLevel = -0.16;
    this.center = new THREE.Vector2(17 * TRACK_SCALE, 45 * TRACK_SCALE); this.radius = new THREE.Vector2(11.8, 6.6);
    this.outline = Array.from({ length: SEGMENTS }, (_, i) => this.point(i / SEGMENTS * Math.PI * 2));
  }
  point(angle, scale = 1, offset = 0) {
    const irregular = 1 + Math.sin(angle * 3 + 0.4) * 0.075 + Math.sin(angle * 5 - 0.7) * 0.035 + Math.cos(angle * 7) * 0.02;
    const dx = Math.cos(angle) * this.radius.x * irregular, dz = Math.sin(angle) * this.radius.y * irregular, length = Math.hypot(dx, dz);
    return { x: this.center.x + dx * scale + dx / length * offset, z: this.center.y + dz * scale + dz / length * offset };
  }
  distance(x, z) {
    const dx = x - this.center.x, dz = z - this.center.y;
    const angle = Math.atan2(dz / this.radius.y, dx / this.radius.x), edge = this.point(angle);
    return Math.hypot(dx, dz) - Math.hypot(edge.x - this.center.x, edge.z - this.center.y);
  }
  isNear(x, z, margin = 0) {
    return this.distance(x, z) < BANK_WIDTH + margin;
  }
  contains(x, z) {
    return this.distance(x, z) < 0;
  }
  landMask(x, z) {
    return smoothstep(BANK_WIDTH + 0.1, BANK_WIDTH + 1.3, this.distance(x, z));
  }
  groundHeight(x, z) {
    const distance = this.distance(x, z);
    if (distance >= BANK_WIDTH) return 0;
    if (distance >= 1.15) return THREE.MathUtils.lerp(0.08, 0, (distance - 1.15) / (BANK_WIDTH - 1.15));
    if (distance >= 0.5) return THREE.MathUtils.lerp(-0.025, 0.08, (distance - 0.5) / 0.65);
    if (distance >= 0) return THREE.MathUtils.lerp(this.waterLevel, -0.025, distance / 0.5);
    return THREE.MathUtils.lerp(this.waterLevel, -1.4, smoothstep(0, 4, -distance));
  }
  createGroundGeometry(width = GROUND_SIZE.width, depth = GROUND_SIZE.depth) {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, -depth / 2); shape.lineTo(width / 2, -depth / 2);
    shape.lineTo(width / 2, depth / 2); shape.lineTo(-width / 2, depth / 2); shape.closePath();
    const hole = new THREE.Path();
    for (let i = 0; i < SEGMENTS; i++) {
      const p = this.point(i / SEGMENTS * Math.PI * 2, 1, BANK_WIDTH);
      if (i) hole.lineTo(p.x, -p.z); else hole.moveTo(p.x, -p.z);
    }
    hole.closePath(); shape.holes.push(hole);
    const plane = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).toNonIndexed();
    const vertices = Array.from(plane.attributes.position.array), uvs = [], indices = [];
    for (let i = 0; i < plane.attributes.position.count; i++) {
      indices.push(i); uvs.push(vertices[i * 3] / GROUND_SIZE.width + 0.5, 0.5 - vertices[i * 3 + 2] / GROUND_SIZE.depth);
    }
    const start = vertices.length / 3;
    vertices.push(this.center.x, -1.4, this.center.y); uvs.push(this.center.x / GROUND_SIZE.width + 0.5, 0.5 - this.center.y / GROUND_SIZE.depth);
    const rings = [[0.45, 0, -1.15], [0.9, 0, -0.55], [1, 0, this.waterLevel], [1, 0.5, -0.025], [1, 1.15, 0.08], [1, BANK_WIDTH, 0]];
    for (let ring = 0; ring < rings.length; ring++) for (let i = 0; i < SEGMENTS; i++) {
      const [scale, offset, y] = rings[ring], p = this.point(i / SEGMENTS * Math.PI * 2, scale, offset);
      vertices.push(p.x, y, p.z); uvs.push(p.x / GROUND_SIZE.width + 0.5, 0.5 - p.z / GROUND_SIZE.depth);
      const a = start + 1 + ring * SEGMENTS + i, next = start + 1 + ring * SEGMENTS + (i + 1) % SEGMENTS;
      if (ring === 0) indices.push(start, next, a);
      if (ring < rings.length - 1) indices.push(a, next, a + SEGMENTS, next, next + SEGMENTS, a + SEGMENTS);
    }
    plane.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices);
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    return geometry;
  }
  addToScene(scene, palette, terrain = null) {
    const vertices = [this.center.x, this.waterLevel, this.center.y], depths = [1], indices = [];
    // Follow the existing lake-bottom rings. Dense rings near the shore make
    // the shallow colour and reference shoreline mask smooth on every bank.
    const scales = [0.12, 0.28, 0.45, 0.65, 0.82, 0.9, 0.94, 0.97, 0.985, 1];
    const bottomAt = scale => scale <= 0.45 ? THREE.MathUtils.lerp(-1.4, -1.15, scale / 0.45)
      : scale <= 0.9 ? THREE.MathUtils.lerp(-1.15, -0.55, (scale - 0.45) / 0.45)
      : THREE.MathUtils.lerp(-0.55, this.waterLevel, (scale - 0.9) / 0.1);
    for (const [ring, scale] of scales.entries()) for (let i = 0; i < SEGMENTS; i++) {
        const p = this.point(i / SEGMENTS * Math.PI * 2, scale);
        vertices.push(p.x, this.waterLevel, p.z);
        depths.push((this.waterLevel - bottomAt(scale)) / (this.waterLevel + 1.4));
        const a = 1 + ring * SEGMENTS + i, next = 1 + ring * SEGMENTS + (i + 1) % SEGMENTS;
        if (ring === 0) indices.push(0, next, a);
        if (ring < scales.length - 1) indices.push(a, next, a + SEGMENTS, next, next + SEGMENTS, a + SEGMENTS);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('lakeDepth', new THREE.Float32BufferAttribute(depths, 1)); geometry.setIndex(indices);
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    this.uniforms = createWaterUniforms(terrain);
    const material = applyLakeSurface(applySceneStyle(new THREE.MeshLambertMaterial({ color: '#ffffff', toneMapped: false }), palette, true), this.uniforms);
    this.mesh = new THREE.Mesh(geometry, material); this.mesh.name = 'forest-lake'; this.mesh.receiveShadow = true;
    this.mesh.position.y = 0.002;
    const detailsMaterial = applyLakeSurface(applySceneStyle(new THREE.MeshLambertMaterial({
      color: '#ffffff', transparent: true, opacity: 0.72, depthWrite: false, toneMapped: false,
    }), palette, true), this.uniforms, true);
    this.details = new THREE.Mesh(geometry, detailsMaterial);
    this.details.name = 'forest-lake-reference-ripples'; this.details.position.y = 0.006;
    this.details.receiveShadow = true; this.details.renderOrder = 1;
    this.lastElapsed = null;
    scene.add(this.mesh, this.details);
  }
  update(environment) {
    const dt = this.lastElapsed === null ? 0 : Math.max(0, Math.min(environment.elapsed - this.lastElapsed, 0.1));
    this.lastElapsed = environment.elapsed;
    this.uniforms.lakeWindTime.value += dt * 0.12 * environment.windStrength;
    this.uniforms.lakeRainTime.value = environment.elapsed * 0.12;
    this.uniforms.lakeRain.value = environment.rain;
  }
}
