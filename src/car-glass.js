import * as THREE from '../vendor/three.module.js';
import { cabinSidePoint } from './car-body.js';

export function createCabinGlassGeometry(rings) {
  // Use mirrored diagonals on both sides so the glass and its frame share a surface.
  const positions = rings.flatMap(ring => [
    ring[0], [0, ring[0][1], ring[0][2]], ring[1], ring[2], [0, ring[2][1], ring[2][2]], ring[3],
  ]).flat(), indices = [], sides = 6;
  for (let ring = 0; ring < rings.length - 1; ring++) for (let side = 0; side < sides; side++) {
    const a = ring * sides + side, b = ring * sides + (side + 1) % sides, c = a + sides, d = b + sides;
    if (side === 0 || side === 4 || side === 5) indices.push(a, b, d, a, d, c);
    else indices.push(a, b, c, b, d, c);
  }
  for (const end of [0, (rings.length - 1) * sides]) {
    for (const [a, b, c] of [[1, 2, 3], [1, 3, 4], [1, 5, 0], [1, 4, 5]]) {
      indices.push(end + a, end + (end === 0 ? c : b), end + (end === 0 ? b : c));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices);
  geometry.computeVertexNormals(); geometry.computeBoundingSphere(); return geometry;
}

export function createCarGlass(simplified = false) {
  const material = new THREE.MeshStandardMaterial({ color: '#244657', roughness: 0.085, metalness: 0.14 });
  if (simplified) return material;
  const daylight = { value: 1 }; material.userData.daylight = daylight;
  material.onBeforeCompile = shader => {
    shader.uniforms.carGlassDaylight = daylight;
    shader.vertexShader = `varying vec3 vCarGlassNormal; varying vec3 vCarGlassPosition;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <defaultnormal_vertex>', `
      #include <defaultnormal_vertex>
      vCarGlassNormal = normalize(mat3(modelMatrix) * objectNormal);
    `).replace('#include <worldpos_vertex>', `
      #include <worldpos_vertex>
      vCarGlassPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
    `);
    shader.fragmentShader = `uniform float carGlassDaylight; varying vec3 vCarGlassNormal; varying vec3 vCarGlassPosition;\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      vec3 carGlassNormal = normalize(vCarGlassNormal);
      vec3 carGlassView = normalize(cameraPosition - vCarGlassPosition);
      vec3 carGlassReflection = reflect(-carGlassView, carGlassNormal);
      float carGlassSky = smoothstep(-0.2, 0.7, carGlassReflection.y);
      float carGlassFresnel = pow(1.0 - abs(dot(carGlassView, carGlassNormal)), 3.0);
      vec3 carGlassColour = mix(vec3(0.028, 0.05, 0.062), vec3(0.22, 0.36, 0.46), carGlassSky);
      float carGlassBand = dot(carGlassReflection, normalize(vec3(-0.38, 0.72, 0.48)));
      float carGlassHighlight = smoothstep(0.55, 0.65, carGlassBand) * (1.0 - smoothstep(0.74, 0.86, carGlassBand));
      carGlassColour += vec3(0.07, 0.10, 0.13) * carGlassHighlight;
      outgoingLight = mix(outgoingLight, carGlassColour * (0.04 + 0.96 * carGlassDaylight), 0.12 + carGlassFresnel * 0.28);
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => 'car-tinted-glass-v1';
  return material;
}

let windowAssets;

function createWindowAssets(rings) {
  const positions = [], painted = [], panes = [
    { points: [rings[2][3], rings[2][2], rings[3][2], rings[3][3]], normal: new THREE.Vector3(0, 1, 1) },
    { points: [rings[0][3], rings[0][2], rings[1][2], rings[1][3]], normal: new THREE.Vector3(0, 1, -1) },
  ];
  // RX-7-style door window and a separate fixed rear quarter window.
  const sidePanes = [
    [[0.586, 0.305], [0.106, 0.688], [-0.486, 0.708], [-0.610, 0.321], [0.12, 0.312]],
    [[-0.678, 0.322], [-0.556, 0.708], [-0.640, 0.699], [-0.98, 0.324]],
  ].map(points => points.map(p => new THREE.Vector2(...p)));
  const clip = (polygon, a, b, orientation) => {
    const distance = point => ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) * orientation;
    const output = [];
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i], q = polygon[(i + 1) % polygon.length], dp = distance(p), dq = distance(q);
      if (dp >= -1e-9) output.push(p);
      if ((dp < 0) !== (dq < 0)) output.push(p.clone().lerp(q, dp / (dp - dq)));
    }
    return output;
  };
  const add = (target, a, b, c, expected) => {
    const normal = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3());
    if (normal.dot(expected) < 0) [b, c] = [c, b];
    target.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  };
  for (const side of [-1, 1]) {
    const bottom = side > 0 ? 1 : 0, top = side > 0 ? 2 : 3, facets = [], normal = new THREE.Vector3(side, 0, 0);
    for (let i = 1; i < rings.length; i++) {
      const a = rings[i - 1][bottom], b = rings[i][bottom], c = rings[i - 1][top], d = rings[i][top];
      facets.push(...[[a, b, c], [b, d, c]].map(points => points.map(p => new THREE.Vector2(p[2], p[1]))));
    }
    const contour = [...rings.map(ring => ring[bottom]), ...[...rings].reverse().map(ring => ring[top])].map(p => new THREE.Vector2(p[2], p[1]));
    const vertices = [...contour, ...sidePanes.flat()];
    for (const face of THREE.ShapeUtils.triangulateShape(contour, sidePanes)) for (const facet of facets) {
      const orientation = Math.sign(facet[1].clone().sub(facet[0]).cross(facet[2].clone().sub(facet[0])));
      let polygon = face.map(index => vertices[index]);
      for (let i = 0; i < 3; i++) polygon = clip(polygon, facet[i], facet[(i + 1) % 3], orientation);
      for (let i = 1; i < polygon.length - 1; i++) {
        add(painted, ...[polygon[0], polygon[i], polygon[i + 1]].map(p => new THREE.Vector3(...cabinSidePoint(rings, side, p.y, p.x, 0.002))), normal);
      }
    }
    for (const pane of sidePanes) panes.push({ points: pane.map(p => cabinSidePoint(rings, side, p.y, p.x)), normal, side });
  }
  for (const pane of panes) {
    const points = pane.points.map(p => new THREE.Vector3(...p));
    const center = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / points.length);
    const inner = points.map(p => {
      const point = p.clone().lerp(center, 0.024);
      return pane.side ? new THREE.Vector3(...cabinSidePoint(rings, pane.side, point.y, point.z)) : point;
    });
    const offset = pane.normal.clone().normalize().multiplyScalar(0.0015);
    for (let i = 0; i < points.length; i++) {
      const next = (i + 1) % points.length;
      const a = points[i].clone().add(offset), b = points[next].clone().add(offset), c = inner[i].clone().add(offset), d = inner[next].clone().add(offset);
      add(positions, a, b, c, pane.normal); add(positions, b, d, c, pane.normal);
    }
  }
  const geometry = data => {
    const result = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(data, 3));
    result.computeVertexNormals(); result.computeBoundingSphere(); return result;
  };
  return { frames: geometry(painted), gaskets: geometry(positions) };
}

export function createWindowFrames(rings) {
  windowAssets ??= createWindowAssets(rings); return windowAssets.gaskets;
}

export function createCabinFrameGeometry(rings) {
  windowAssets ??= createWindowAssets(rings); return windowAssets.frames;
}
