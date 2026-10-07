import * as THREE from '../vendor/three.module.js';
import { terrainShader } from './terrain.js';
import { smoothstep, randomGenerator } from './simulation.js';
import { createWindNoise, windShader } from './wind.js';

// Leaf clouds and fixed triangle blades follow Bruno Simon's Foliage / Grass
// Source: https://github.com/brunosimon/folio-2025 (MIT).
// License: vendor/BRUNO-SIMON-LICENSE.txt.
function pineCloud() {
  const random = randomGenerator(731), positions = [], leaves = [], normals = [], colors = [], uv = [], indices = [];
  for (let tier = 0; tier < 9; tier++) {
    const t = tier / 8, count = 48 - tier * 4, tierRadius = 1 - t * 0.94;
    const turn = random() * Math.PI * 2;
    for (let tuft = 0; tuft < count; tuft++) {
      const angle = turn + (tuft + random() * 0.7) / count * Math.PI * 2;
      const radius = tierRadius * (0.18 + Math.pow(random(), 0.55) * 0.82);
      const point = new THREE.Vector3(Math.cos(angle) * radius, 0.2 + t * 0.75 + (random() - 0.5) * 0.045, Math.sin(angle) * radius);
      const facing = new THREE.Vector3(Math.cos(angle), (random() - 0.5) * 1.5, Math.sin(angle)).normalize();
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), facing).normalize();
      const upright = new THREE.Vector3().crossVectors(facing, right);
      const roll = random() * Math.PI * 2, half = (0.23 + random() * 0.12) * (1 - t * 0.55);
      const rank = random(), shade = 0.85 + random() * 0.15, first = positions.length / 3;
      const normal = new THREE.Vector3(point.x, 0.35, point.z).normalize();
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const a = (u * 2 - 1) * half, b = (v * 2 - 1) * half;
        const cx = a * Math.cos(roll) - b * Math.sin(roll), cy = a * Math.sin(roll) + b * Math.cos(roll);
        const corner = right.clone().multiplyScalar(cx).addScaledVector(upright, cy);
        // Instances scale Y by the full tree height. Compensate only needle
        // cards here so a tuft remains small instead of becoming a 5 m sheet.
        corner.y *= 0.18;
        const vertex = point.clone().add(corner), mixedNormal = vertex.clone().lerp(normal, 0.85).normalize();
        positions.push(vertex.x, vertex.y, vertex.z); leaves.push(point.x, point.y, point.z, rank);
        normals.push(mixedNormal.x, mixedNormal.y, mixedNormal.z); colors.push(shade, shade, shade); uv.push(u, v);
      }
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, data, size] of [['position', positions, 3], ['leafData', leaves, 4], ['normal', normals, 3], ['color', colors, 3], ['uv', uv, 2]]) geometry.setAttribute(name, new THREE.Float32BufferAttribute(data, size));
  geometry.setIndex(indices); geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.55, 0), 1.6);
  return geometry;
}

function leafCloud(kind) {
  if (kind === 'pine') return pineCloud();
  const pine = kind === 'pine', birch = kind === 'birch';
  const random = randomGenerator(pine ? 731 : birch ? 921 : 481), count = pine ? 180 : 80;
  const positions = [], leafData = [], normals = [], colors = [], uv = [], indices = [];
  for (let leaf = 0; leaf < count; leaf++) {
    const angle = random() * Math.PI * 2, t = random();
    const radius = pine ? Math.sqrt(random()) * (1 - t * 0.91) : 1 - Math.pow(random(), 3);
    const point = pine ? new THREE.Vector3(Math.cos(angle) * radius, 0.23 + t * 0.77, Math.sin(angle) * radius)
      : new THREE.Vector3().setFromSpherical(new THREE.Spherical(radius, angle, t * Math.PI));
    const { x, y, z } = point;
    const normal = new THREE.Vector3(x, pine ? 0.32 : y * 0.75, z).normalize();
    // Foliage.js uses eighty 0.8 m planes on a spherical shell. Our camera can
    // circle the tree, so plane normals cover the sphere instead of facing one
    // default camera angle. These orientations stay fixed for colour and depth.
    const roll = random() * Math.PI * 2, half = pine ? 0.32 + random() * 0.15 : 0.4;
    const facing = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, Math.acos(2 * random() - 1), random() * Math.PI * 2));
    const referenceUp = Math.abs(facing.y) > 0.98 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(referenceUp, facing).normalize();
    const upright = new THREE.Vector3().crossVectors(facing, right);
    const rank = random(), shade = 0.88 + random() * 0.12, first = positions.length / 3;
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const a = (u * 2 - 1) * half, b = (v * 2 - 1) * half;
      const cx = a * Math.cos(roll) - b * Math.sin(roll), cy = a * Math.sin(roll) + b * Math.cos(roll);
      const corner = right.clone().multiplyScalar(cx).addScaledVector(upright, cy);
      positions.push(x + corner.x, y + corner.y, z + corner.z); leafData.push(x, y, z, rank);
      const mixedNormal = point.clone().add(corner).lerp(normal, 0.85).normalize();
      normals.push(mixedNormal.x, mixedNormal.y, mixedNormal.z); colors.push(shade, shade, shade); uv.push(u, v);
    }
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  const geometry = new THREE.BufferGeometry();
  // Packing avoids exhausting WebGL's sixteen vertex attribute slots when
  // instanceMatrix, instanceColor, lighting normals and tree wind are active.
  for (const [name, data, size] of [['position', positions, 3], ['leafData', leafData, 4], ['normal', normals, 3], ['color', colors, 3], ['uv', uv, 2]]) geometry.setAttribute(name, new THREE.Float32BufferAttribute(data, size));
  geometry.setIndex(indices);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, pine ? 0.5 : 0, 0), 2);
  return geometry;
}
export const createPineGeometry = () => leafCloud('pine');
export const createCanopyGeometry = (kind = 'oak') => leafCloud(kind);

let referenceFoliageMask, referenceFoliageReady;
export function createLeafMask(kind = 'oak') {
  if (kind === 'birch' || kind === 'oak') {
    if (!referenceFoliageMask) {
      referenceFoliageReady = new Promise((resolve, reject) => {
        referenceFoliageMask = new THREE.TextureLoader().load(new URL('./textures/foliage-sdf.png', import.meta.url).href, resolve, undefined, reject);
      });
      referenceFoliageMask.minFilter = THREE.LinearMipmapLinearFilter;
      referenceFoliageMask.magFilter = THREE.LinearFilter;
    }
    return referenceFoliageMask;
  }
  return createGroundLeafMask(kind);
}

export async function prepareVegetationAssets() {
  createLeafMask('oak');
  await referenceFoliageReady;
  await referenceFoliageMask.image.decode?.();
}

// Fallen leaves keep their original individual silhouette; the reference SDF
// above describes a whole foliage cloud and must not be used on the road.
export function createGroundLeafMask(kind = 'oak') {
  const pine = kind === 'pine' || kind === true;
  const size = 64, data = new Uint8Array(size * size * 4);
  const lobes = pine ? [[0, 0, 0.78, 0.24, 0], [-0.12, 0.2, 0.6, 0.2, 0.45], [0.08, -0.23, 0.65, 0.2, -0.4]] : kind === 'birch' ? [[0, 0.1, 0.32, 0.65, 0.3], [-0.3, -0.14, 0.24, 0.46, -0.35], [0.31, -0.16, 0.25, 0.47, 0.55]] : [[0, 0, 0.6, 0.52, 0], [-0.38, 0.15, 0.4, 0.32, 0.5], [0.29, 0.33, 0.42, 0.3, -0.3], [0.28, -0.28, 0.43, 0.32, 0.4], [-0.25, -0.3, 0.37, 0.3, -0.4]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + 0.5) / size * 2 - 1, py = (y + 0.5) / size * 2 - 1;
    let alpha = 0;
    for (const [cx, cy, rx, ry, angle] of lobes) {
      const dx = px - cx, dy = py - cy, a = (dx * Math.cos(angle) + dy * Math.sin(angle)) / rx, b = (-dx * Math.sin(angle) + dy * Math.cos(angle)) / ry;
      alpha = Math.max(alpha, 1 - smoothstep(0.82, 1.03, a * a + b * b));
    }
    const i = (y * size + x) * 4, value = Math.round(alpha * 255);
    data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
  texture.needsUpdate = true; return texture;
}

export function applyLeafCloud(material, view, kind = 'oak') {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  const frequency = kind === 'pine' ? 1.3 : kind === 'birch' ? 2.7 : 2.0;
  const flutter = kind === 'pine' ? 0.14 : kind === 'birch' ? 0.32 : 0.25;
  material.onBeforeCompile = shader => {
    previous(shader);
    shader.vertexShader = `attribute vec4 leafData;
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      float leafPhase = leafData.w * 38.0 + dot(instanceMatrix[3].xz, vec2(0.21, 0.13));
      float leafMotion = sin(worldTime * ${frequency.toFixed(2)} + leafPhase) * worldWind * ${flutter.toFixed(2)};
      #ifdef USE_ALPHAMAP
        float leafTwist = leafMotion + length(forestWindOffset(treeData.xy + leafData.xz, 1.0)) * 2.2;
        float twistCos = cos(leafTwist), twistSin = sin(leafTwist);
        vAlphaMapUv = mat2(twistCos, -twistSin, twistSin, twistCos) * (vAlphaMapUv - 0.5) + 0.5;
      #endif`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 movingCorner = position - leafData.xyz;
      movingCorner.xz = mat2(cos(leafMotion), -sin(leafMotion), sin(leafMotion), cos(leafMotion)) * movingCorner.xz;
      transformed = leafData.xyz + movingCorner;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>', `#ifdef USE_ALPHAMAP
      diffuseColor.a *= texture2D(alphaMap, vAlphaMapUv).r;
    #endif`);
  };
  material.userData.plantDepthFragment = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>', `#ifdef USE_ALPHAMAP
      diffuseColor.a *= texture2D(alphaMap, vAlphaMapUv).r;
    #endif`);
  };
  material.customProgramCacheKey = () => `${key}-reference-leaf-cloud-v5-${kind}`;
  return material;
}

export function createGrassGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geometry.setAttribute('plantWeight', new THREE.Float32BufferAttribute([0, 0, 1], 1));
  geometry.setAttribute('plantDerivative', new THREE.Float32BufferAttribute([0, 0, 2], 1));
  return geometry;
}

// CPU equivalent of Noises.perlinNode(uv, 6, 6).remap(0.1, 0.9, 0, 1).
// Grass height must use gradient Perlin noise, not the wind's value noise.
export function createGrassNoise() {
  const size = 128, cells = 6, data = new Uint8Array(size * size);
  const fract = x => x - Math.floor(x);
  const direction = (x, y) => {
    x = ((x % cells) + cells) % cells; y = ((y % cells) + cells) % cells;
    return [2 * fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123) - 1, 2 * fract(Math.sin(x * 269.5 + y * 183.3) * 43758.5453123) - 1];
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + 0.5) / size * cells, py = (y + 0.5) / size * cells;
    const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
    const u = smoothstep(0, 1, fx), v = smoothstep(0, 1, fy);
    const corner = (a, b) => { const d = direction(ix + a, iy + b); return d[0] * (fx - a) + d[1] * (fy - b); };
    const value = THREE.MathUtils.lerp(THREE.MathUtils.lerp(corner(0, 0), corner(1, 0), u), THREE.MathUtils.lerp(corner(0, 1), corner(1, 1), u), v) + 0.5;
    data[y * size + x] = Math.round(THREE.MathUtils.clamp(value, 0, 1) * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

export function applyMeadow(material, uniforms) {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = shader => {
    previous(shader); Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = terrainShader + `uniform sampler2D meadowNoise; attribute float grassVariation;
      varying float meadowAllowed; varying float meadowRootShadow; varying vec3 meadowColor;
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      // Roots stay at their initial world coordinates; no camera-centred pool.
      vec2 root = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xz;
      vec4 terrainData = texture2D(terrainDataMap, root / terrainSize + 0.5);
      meadowAllowed = terrainData.g;
      meadowColor = terrainColor(terrainData);
      meadowRootShadow = (1.0 - plantWeight) * terrainData.g;
      float heightVariation = texture2D(meadowNoise, root * 0.0321).r + 0.5;
      float bladeHeight = 0.6 * (0.4 + 0.6 * grassVariation) * heightVariation * terrainData.g;
      float bladeWidth = 0.1 * terrainData.g;
      // Bruno's per-blade facing uses camera position, never camera rotation.
      vec2 toCamera = cameraPosition.xz - root;
      vec2 right = vec2(toCamera.y, -toCamera.x) / max(length(toCamera), 0.0001);
      transformed.xz = right * position.x * bladeWidth;
      transformed.y = position.y * bladeHeight;
    `);
    shader.fragmentShader = 'varying float meadowAllowed; varying float meadowRootShadow; varying vec3 meadowColor;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= meadowColor;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\nif (meadowAllowed < 0.5) discard;');
  };
  material.customProgramCacheKey = () => `${key}-bruno-fixed-meadow-v3`;
  return material;
}

export function applyWind(material, kind, timeUniform, windUniform, field = null) {
  const previous = material.onBeforeCompile, previousKey = material.customProgramCacheKey();
  const grass = kind === 'grass';
  field ??= { windNoise: { value: createWindNoise() }, windTime: timeUniform, windDirection: { value: new THREE.Vector2(0.951, -0.309) } };
  const modify = shader => {
    previous(shader);
    Object.assign(shader.uniforms, field);
    shader.uniforms.worldTime = timeUniform; shader.uniforms.worldWind = windUniform;
    shader.vertexShader = windShader + (grass ? `attribute float grassKind; attribute float plantWeight;
      vec2 forestBend() {
        vec2 root = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xz;
        vec2 scale = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
        float response = grassKind < 0.5 ? 0.55 : grassKind < 1.5 ? 1.0 : 1.3;
        vec2 worldBend = forestWindOffset(root, response);
        float localPhase = worldTime * (1.8 + grassKind * 0.8) + dot(root, vec2(0.31, 0.23));
        worldBend += vec2(-windDirection.y, windDirection.x) * sin(localPhase) * worldWind * response * 0.14;
        vec2 localBend = vec2(dot(normalize(instanceMatrix[0].xyz).xz, worldBend), dot(normalize(instanceMatrix[2].xyz).xz, worldBend));
        return localBend / max(scale, vec2(0.001));
      }
    ` : 'attribute vec4 treeData;\n') + shader.vertexShader;
    const displacement = grass ? 'transformed.xz += forestBend() * plantWeight * transformed.y * 0.9;' : `
      vec3 treeWorldPosition = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      float treeBendWeight = pow(clamp(treeWorldPosition.y / max(treeData.z, 0.01), 0.0, 1.2), 2.0);
      vec2 treeWorldBend = forestTreeOffset(treeData.xy, treeData.w) * treeBendWeight;
      vec3 treeWorldOffset = vec3(treeWorldBend.x, 0.0, treeWorldBend.y);
      transformed += vec3(dot(instanceMatrix[0].xyz, treeWorldOffset) / dot(instanceMatrix[0].xyz, instanceMatrix[0].xyz),
                          dot(instanceMatrix[1].xyz, treeWorldOffset) / dot(instanceMatrix[1].xyz, instanceMatrix[1].xyz),
                          dot(instanceMatrix[2].xyz, treeWorldOffset) / dot(instanceMatrix[2].xyz, instanceMatrix[2].xyz));`;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `${displacement}\n#include <project_vertex>`);
  };
  material.onBeforeCompile = modify; material.customProgramCacheKey = () => `${previousKey}-forest-wind-v8-${kind}`;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: material.side, alphaMap: material.alphaMap, alphaTest: material.alphaTest });
  depth.onBeforeCompile = shader => {
    const fragment = shader.fragmentShader;
    modify(shader); shader.fragmentShader = fragment;
    material.userData.plantDepthFragment?.(shader);
  };
  depth.customProgramCacheKey = () => `${previousKey}-forest-depth-v8-${kind}`;
  return depth;
}

export function createBarkTexture(kind = 'birch') {
  const width = 32, height = 128, data = new Uint8Array(width * height * 4), random = randomGenerator(721);
  for (let i = 0; i < width * height; i++) {
    const value = 224 + random() * 31;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = value; data[i * 4 + 3] = 255;
  }
  for (let stroke = 0; stroke < (kind === 'birch' ? 24 : 11); stroke++) {
    const x = Math.floor(random() * width), y = Math.floor(random() * height), length = 3 + Math.floor(random() * 12);
    if (kind === 'birch') {
      for (let row = 0; row < 1 + (stroke % 3); row++) for (let column = 0; column < length; column++) {
        const i = (((y + row) % height) * width + (x + column) % width) * 4;
        data[i] = data[i + 1] = data[i + 2] = 55 + column * 4;
      }
    } else {
      // Brown bark has fine vertical furrows, never birch's black cross marks.
      const furrowLength = 36 + Math.floor(random() * 80);
      for (let row = 0; row < furrowLength; row++) {
        const column = (x + Math.round(Math.sin(row * 0.07 + stroke) * 0.6) + width) % width;
        const i = (((y + row) % height) * width + column) * 4;
        data[i] = data[i + 1] = data[i + 2] = 175 + Math.sin(row / furrowLength * Math.PI) * 24;
      }
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
  texture.needsUpdate = true; return texture;
}
