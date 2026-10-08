import * as THREE from '../vendor/three.module.js';

const EPSILON = 1e-8;
const WELLS = [
  { z: 1, inner: 0.435, slope: 0.78, slopeZ: 0.075, radiusY: 0.53 },
  { z: -1.04, inner: 0.515, slope: 0.54, slopeZ: 0, radiusY: 0.54 },
];
const CENTRE_Y = -0.30, RADIUS = 0.46;
// Reserve 13 mm above a 40 cm tire at the deepest visible compression.
export const WHEEL_WELL_MAX_HUB_Y = CENTRE_Y + RADIUS - 0.413;
const backX = (well, y, z) => well.inner + well.slope * y + well.slopeZ * (z - well.z);

// Keep interpolated surface normals when cutting the painted shell.
function split(polygon, plane) {
  const inside = [], outside = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = a[0] * plane[0] + a[1] * plane[1] + a[2] * plane[2] - plane[3];
    const db = b[0] * plane[0] + b[1] * plane[1] + b[2] * plane[2] - plane[3];
    if (da <= EPSILON) inside.push(a);
    if (da >= -EPSILON) outside.push(a);
    if (da < -EPSILON && db > EPSILON || da > EPSILON && db < -EPSILON) {
      const t = da / (da - db), point = a.map((value, j) => THREE.MathUtils.lerp(value, b[j], t));
      inside.push(point); outside.push(point);
    }
  }
  return [inside, outside];
}

function clip(polygon, planes) {
  for (const plane of planes) {
    polygon = split(polygon, plane)[0];
    if (polygon.length < 3) return [];
  }
  return polygon;
}

function subtract(polygon, planes) {
  const parts = [];
  for (const plane of planes) {
    const [inside, outside] = split(polygon, plane);
    if (outside.length >= 3) parts.push(outside);
    if (inside.length < 3) return parts;
    polygon = inside;
  }
  return parts;
}

function append(batch, polygon, normal) {
  for (let i = 1; i < polygon.length - 1; i++) {
    const vertices = [polygon[0], polygon[i], polygon[i + 1]];
    const a = new THREE.Vector3(...vertices[0].slice(0, 3)), b = new THREE.Vector3(...vertices[1].slice(0, 3)), c = new THREE.Vector3(...vertices[2].slice(0, 3));
    const cross = b.sub(a).cross(c.sub(a));
    if (cross.lengthSq() < 1e-16) continue;
    if (normal && cross.dot(normal) < 0) [vertices[1], vertices[2]] = [vertices[2], vertices[1]];
    for (const vertex of vertices) {
      batch.positions.push(...vertex.slice(0, 3));
      batch.normals.push(...(normal ? normal.toArray() : vertex.slice(3, 6)));
    }
  }
}

function sectionPlanes(a, b) {
  const planes = [[0, 0, -1, -a[0][2]], [0, 0, 1, b[0][2]]], centre = new THREE.Vector3();
  for (const point of [...a, ...b]) centre.add(new THREE.Vector3(...point));
  centre.multiplyScalar(1 / (a.length + b.length));
  for (let i = 0; i < a.length; i++) {
    const first = new THREE.Vector3(...a[i]), along = new THREE.Vector3(...b[i]).sub(first);
    const edge = new THREE.Vector3(...a[(i + 1) % a.length]).sub(first);
    const normal = edge.cross(along).normalize();
    if (normal.dot(centre.clone().sub(first)) > 0) normal.negate();
    planes.push([...normal.toArray(), normal.dot(first)]);
  }
  // Leave the existing recessed floor and the suspension beneath the well open.
  const floor = ring => Math.min(ring[0][1] + 0.16, ring[4][1] - 0.08);
  const slope = (floor(b) - floor(a)) / (b[0][2] - a[0][2]);
  planes.push([0, -1, slope, slope * a[0][2] - floor(a)]);
  return planes;
}

export function createWheelWellGeometry(shell, bodyRings, simplified = false) {
  const segments = simplified ? 20 : 48, cutters = [], interiors = [];
  for (const side of [-1, 1]) for (const well of WELLS) {
    const points = Array.from({ length: segments }, (_, i) => {
      const angle = i * Math.PI * 2 / segments;
      return [CENTRE_Y + Math.cos(angle) * RADIUS, well.z + Math.sin(angle) * RADIUS];
    });
    const planes = [[-side, well.slope, well.slopeZ, -well.inner + well.slopeZ * well.z]], normals = [];
    for (let i = 0; i < segments; i++) {
      const a = points[i], b = points[(i + 1) % segments], normal = new THREE.Vector3(0, b[1] - a[1], a[0] - b[0]).normalize();
      planes.push([...normal.toArray(), normal.y * a[0] + normal.z * a[1]]);
      normals.push(normal.negate());
    }
    cutters.push(planes);
    if (!simplified) interiors.push({ side, well, points, normals });
  }

  const paint = { positions: [], normals: [] }, trim = { positions: [], normals: [] };
  const p = shell.attributes.position, n = shell.attributes.normal, index = shell.index;
  for (let i = 0; i < (index?.count ?? p.count); i += 3) {
    let polygons = [[0, 1, 2].map(j => {
      const k = index ? index.getX(i + j) : i + j;
      return [p.getX(k), p.getY(k), p.getZ(k), n.getX(k), n.getY(k), n.getZ(k)];
    })];
    for (const cutter of cutters) polygons = polygons.flatMap(polygon => subtract(polygon, cutter));
    const material = shell.groups.find(group => i >= group.start && i < group.start + group.count)?.materialIndex ?? 0;
    for (const polygon of polygons) append(material === 1 ? trim : paint, polygon);
  }

  if (!simplified) {
    const sections = bodyRings.slice(1).map((ring, i) => sectionPlanes(bodyRings[i], ring));
    for (const { side, well, points, normals } of interiors) {
      // The back wall and roof sit inside the body; nothing projects past the paint.
      const back = Array.from({ length: segments }, (_, i) => {
        const angle = i * Math.PI * 2 / segments;
        const y = -0.20 + Math.cos(angle) * well.radiusY, z = well.z + Math.sin(angle) * 0.50;
        return [side * backX(well, y, z), y, z];
      });
      for (const section of sections) append(trim, clip(back, section), new THREE.Vector3(side, -well.slope, -well.slopeZ).normalize());
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        const roof = [[side * backX(well, ...a), ...a], [side * 1.05, ...a],
          [side * 1.05, ...b], [side * backX(well, ...b), ...b]];
        for (const section of sections) append(trim, clip(roof, section), normals[i]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([...paint.positions, ...trim.positions], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([...paint.normals, ...trim.normals], 3));
  geometry.addGroup(0, paint.positions.length / 3, 0);
  if (trim.positions.length) geometry.addGroup(paint.positions.length / 3, trim.positions.length / 3, 1);
  geometry.computeBoundingSphere(); shell.dispose();
  return geometry;
}
