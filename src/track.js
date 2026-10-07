import * as THREE from '../vendor/three.module.js';
import { createAsphaltTextures } from './asphalt.js';
import { TRACK_SCALE } from './scene-config.js';

export class Track {
  constructor(scene) {
    this.width = 10.5;
    this.curve = new THREE.CatmullRomCurve3([
      [-38, 22], [-8, 30], [27, 24], [43, 5], [28, -24], [2, -29], [-24, -22], [-43, -16], [-49, 2],
    ].map(([x, z]) => new THREE.Vector3(x * TRACK_SCALE, 0, z * TRACK_SCALE)), true, 'centripetal');
    this.samples = Array.from({ length: 600 }, (_, i) => this.curve.getPointAt(i / 600));
    this.height = 0.04;
    this.curbWidth = 0.85;
    this.curbHeight = this.height + 0.02;
    this.curbRampWidth = 0.24;
    this.curbTiles = Math.ceil(this.curve.getLength() / 0.95 / 2) * 2;
    this.segments = this.curbTiles * 4;
    this.roadMaterial = new THREE.MeshStandardMaterial({ color: '#454d4c', ...createAsphaltTextures(), bumpScale: 0.015, roughness: 0.96, metalness: 0.08 });
    this.buildRoad(scene);
    this.spawn = this.point(0);
  }
  point(t, offset = 0) {
    const position = this.curve.getPointAt(((t % 1) + 1) % 1);
    const tangent = this.curve.getTangentAt(((t % 1) + 1) % 1).normalize();
    position.x += tangent.z * offset;
    position.z -= tangent.x * offset;
    return { position, tangent, yaw: Math.atan2(tangent.x, tangent.z) };
  }
  nearest(position) {
    let distanceSq = Infinity;
    let index = 0;
    // Project onto segments instead of snapping to samples, including the seam.
    for (let i = 0; i < this.samples.length; i++) {
      const a = this.samples[i], b = this.samples[(i + 1) % this.samples.length];
      const dx = b.x - a.x, dz = b.z - a.z;
      const fraction = Math.max(0, Math.min(1, ((position.x - a.x) * dx + (position.z - a.z) * dz) / (dx * dx + dz * dz)));
      const d = (position.x - a.x - dx * fraction) ** 2 + (position.z - a.z - dz * fraction) ** 2;
      if (d < distanceSq) { distanceSq = d; index = i + fraction; }
    }
    return { distance: Math.sqrt(distanceSq), progress: (index / this.samples.length) % 1, onRoad: distanceSq < (this.width / 2) ** 2 };
  }
  attachPhysics(physics) {
    this.physicalSurface ??= physics.staticGeometry([this.road.geometry, ...this.curbs.map(mesh => mesh.geometry)]);
  }
  buildRoad(scene) {
    const vertices = [], indices = [], uvs = [], textureRepeats = Math.round(this.curve.getLength() / 3);
    for (let i = 0; i <= this.segments; i++) {
      const a = this.point(i / this.segments, -this.width / 2).position;
      const b = this.point(i / this.segments, this.width / 2).position;
      vertices.push(a.x, this.height, a.z, b.x, this.height, b.z);
      uvs.push(0, i / this.segments * textureRepeats, 1, i / this.segments * textureRepeats);
      if (i < this.segments) { const v = i * 2; indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const road = new THREE.Mesh(geometry, this.roadMaterial);
    this.road = road;
    road.receiveShadow = true;
    scene.add(road);

    const dummy = new THREE.Object3D();
    const white = new THREE.MeshStandardMaterial({ color: '#e9e8d8', roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const curbMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    this.curbs = [-1, 1].map(side => {
      const mesh = new THREE.Mesh(this.createCurbGeometry(side), curbMaterial);
      mesh.name = side < 0 ? 'curb-left' : 'curb-right';
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    });

    const stripes = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.14, 1.25), white, 90);
    for (let i = 0; i < 90; i++) {
      const { position, yaw } = this.point((i + 0.5) / 90);
      dummy.position.set(position.x, this.height + 0.002, position.z);
      dummy.rotation.set(-Math.PI / 2, 0, yaw);
      dummy.updateMatrix();
      stripes.setMatrixAt(i, dummy.matrix);
    }
    scene.add(stripes);
    this.markings = stripes;

    const start = this.point(0);
    const finishPositions = [], finishColors = [], light = new THREE.Color('#e9e8d8'), dark = new THREE.Color('#1b2422');
    const finishColumns = Math.round(this.width / 0.75);
    for (let x = 0; x < finishColumns; x++) for (let z = 0; z < 2; z++) {
      const left = (x - finishColumns / 2) * 0.75, front = (z - 1) * 0.65, color = (x + z) % 2 ? light : dark;
      for (const [dx, dz] of [[0, 0], [0, 0.65], [0.75, 0], [0.75, 0], [0, 0.65], [0.75, 0.65]]) {
        finishPositions.push(left + dx, 0, front + dz); finishColors.push(color.r, color.g, color.b);
      }
    }
    const finishGeometry = new THREE.BufferGeometry();
    finishGeometry.setAttribute('position', new THREE.Float32BufferAttribute(finishPositions, 3));
    finishGeometry.setAttribute('color', new THREE.Float32BufferAttribute(finishColors, 3)); finishGeometry.computeVertexNormals();
    const finishMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const line = new THREE.Mesh(finishGeometry, finishMaterial);
    line.name = 'finish-checker'; line.receiveShadow = true;
    line.position.copy(start.position).setY(this.height + 0.006);
    line.rotation.y = start.yaw;
    this.finish = line;
    scene.add(line);
  }
  createCurbGeometry(side) {
    // Every cross section is shared by its neighbours. No separate blocks,
    // coincident top faces or gaps on the outside of a corner.
    const profile = [[0, this.height], [this.curbRampWidth, this.curbHeight], [0.65, this.curbHeight], [this.curbWidth, 0.012]];
    const sections = Array.from({ length: this.segments + 1 }, (_, i) => profile.map(([offset, height]) => {
      const point = this.point(i / this.segments, side * (this.width / 2 + offset)).position;
      point.y = height; return point;
    }));
    const positions = [], colors = [], red = new THREE.Color('#c55f4f'), cream = new THREE.Color('#e3dfc9');
    const triangles = side > 0 ? [0, 2, 1, 1, 2, 3] : [0, 1, 2, 1, 3, 2];
    for (let i = 0; i < this.segments; i++) {
      const color = Math.floor(i / 4) % 2 ? cream : red;
      for (let strip = 0; strip < profile.length - 1; strip++) {
        const corners = [sections[i][strip], sections[i][strip + 1], sections[i + 1][strip], sections[i + 1][strip + 1]];
        for (const index of triangles) { const p = corners[index]; positions.push(p.x, p.y, p.z); colors.push(color.r, color.g, color.b); }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    return geometry;
  }
}
