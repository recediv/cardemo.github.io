import * as THREE from '../vendor/three.module.js';
import { randomGenerator, smoothstep, clamp, DEFAULT_WIND } from './simulation.js';
import { createPineGeometry, createCanopyGeometry, createGrassGeometry, createGrassNoise, createBarkTexture, createLeafMask, applyLeafCloud, applyMeadow, applyWind } from './vegetation.js';
import { SunShadows } from './lighting.js';
import { DayPalette, applySceneStyle } from './day-cycle.js';
import { createWindNoise } from './wind.js';
import { createMountainGeometry } from './mountains.js';
import { createTerrainField, applyTerrain } from './terrain.js';
import { GroundDetails } from './ground-details.js';
import { ClothFlag } from './flags.js';
import { createSoilTextures } from './soil.js';
import { Lake } from './lake.js';
import { addTrackRamps } from './ramps.js';
import { TRACK_SCALE, WORLD_SIZE, GROUND_SIZE } from './scene-config.js';

const DAY_SKY = new THREE.Color('#96bfc4');
const OVERCAST_SKY = new THREE.Color('#8d9ba5');
const RAIN_CLOUDS = new THREE.Color('#7c8d91');
const WET_ROAD = new THREE.Color('#283e41');
const NIGHT_WATER = new THREE.Color('#263e69');

export class World {
  constructor(scene, physics, track) {
    this.scene = scene;
    this.physics = physics;
    this.track = track;
    this.dayPalette = new DayPalette();
    this.viewUniforms = { foliageCameraRight: { value: new THREE.Vector3(1, 0, 0) }, foliageCameraUp: { value: new THREE.Vector3(0, 1, 0) } };
    this.shadowFoliageView = { foliageCameraRight: { value: new THREE.Vector3(0.8, 0, -0.6) }, foliageCameraUp: { value: new THREE.Vector3(-0.3, Math.sqrt(0.75), -0.4) } };
    const trackMaterials = new Set();
    scene.traverse(object => { if (object.material) for (const material of [].concat(object.material)) trackMaterials.add(material); });
    for (const material of trackMaterials) applySceneStyle(material, this.dayPalette);
    this.random = randomGenerator(352);
    this.timeUniform = { value: 0 };
    this.windUniform = { value: DEFAULT_WIND };
    this.windField = { windNoise: { value: createWindNoise() }, windOffset: { value: new THREE.Vector2() }, windDirection: { value: new THREE.Vector2(Math.sin(Math.PI * 0.6), Math.cos(Math.PI * 0.6)) } };
    this.rainUniform = { value: 0 };
    this.foliage = [];
    this.flags = [];
    this.obstacles = [];
    this.puddles = [];
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
    this.lake = new Lake();
    this.makeTerrain();
    this.makeLighting();
    this.makeTrees();
    this.groundDetails = new GroundDetails(scene, physics, track, this.terrain, this.trees, this.dayPalette, this.windField);
    this.makeGrass();
    this.makeObstacles();
    this.makePuddles();
    this.makeRain();
  }
  material(color, extra = {}) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
    if (!extra.metalness) applySceneStyle(material, this.dayPalette);
    return material;
  }
  makeTerrain() {
    this.terrain = createTerrainField(this.track, this.lake);
    const soil = createSoilTextures();
    soil.map.repeat.set(GROUND_SIZE.width / 8, GROUND_SIZE.depth / 8);
    soil.bump.repeat.copy(soil.map.repeat);
    this.groundMaterial = applySceneStyle(new THREE.MeshLambertMaterial({ color: '#ffffff', map: soil.map, bumpMap: soil.bump, bumpScale: 0.055, toneMapped: false }), this.dayPalette, false, { directLight: 0 });
    applyTerrain(this.groundMaterial, this.terrain.uniforms);
    const floor = new THREE.Mesh(this.lake.createGroundGeometry(GROUND_SIZE.width, GROUND_SIZE.depth), this.groundMaterial);
    floor.name = 'ground-with-lakebed';
    floor.receiveShadow = true;
    this.scene.add(floor);
    const collisionGround = this.lake.createGroundGeometry(WORLD_SIZE.width, WORLD_SIZE.depth);
    this.physics.setGroundGeometry(collisionGround); collisionGround.dispose();
    this.lake.addToScene(this.scene, this.dayPalette, this.terrain);

    this.mountains = new THREE.Mesh(createMountainGeometry(), this.material('#ffffff', { vertexColors: true, flatShading: true, roughness: 1 }));
    this.mountains.name = 'distant-mountain-ridges'; this.scene.add(this.mountains);
    this.scene.fog = new THREE.FogExp2('#96bfc4', 0.0035);

    const skyMaterial = new THREE.ShaderMaterial({
      uniforms: { top: { value: DAY_SKY.clone() }, bottom: { value: new THREE.Color('#d7e1c5') } },
      vertexShader: 'varying vec3 direction; void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 top;uniform vec3 bottom;varying vec3 direction;void main(){float t=smoothstep(-0.1,0.7,normalize(direction).y);gl_FragColor=vec4(mix(bottom,top,t),1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(430, 24, 12), skyMaterial);
    this.scene.add(this.sky);

    const stars = [];
    for (let i = 0; i < 350; i++) {
      const angle = this.random() * Math.PI * 2;
      const y = 0.12 + this.random() * 0.88;
      const r = Math.sqrt(1 - y * y) * 360;
      stars.push(Math.cos(angle) * r, y * 360, Math.sin(angle) * r);
    }
    this.stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(stars, 3)), new THREE.PointsMaterial({ color: '#d5dcff', size: 1.1, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.scene.add(this.stars);

    this.clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.material('#ecede0', { transparent: true, opacity: 0.8, depthWrite: false }), 28);
    for (let i = 0; i < 28; i++) {
      this.dummy.position.set((this.random() - 0.5) * WORLD_SIZE.width, 30 + this.random() * 12, (this.random() - 0.5) * WORLD_SIZE.depth);
      this.dummy.scale.set(5 + this.random() * 7, 1.1 + this.random() * 1.5, 3 + this.random() * 6);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.clouds.setMatrixAt(i, this.dummy.matrix);
    }
    this.scene.add(this.clouds);
  }
  makeLighting() {
    this.ambient = new THREE.HemisphereLight('#d3ebff', '#536e38', 1.9);
    this.sun = new THREE.DirectionalLight('#fff0cc', 3.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sunShadows = new SunShadows(this.sun);
    this.sunShadows.update(14);
    this.scene.add(this.ambient, this.sun, this.sun.target);
    this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(3.4, 40), new THREE.MeshBasicMaterial({ color: '#fff1bd', transparent: true, fog: false, toneMapped: false, depthWrite: false }));
    this.sunDisc.name = 'sun-disc'; this.scene.add(this.sunDisc);
    this.sunHalo = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.ShaderMaterial({
      uniforms: { glowColor: { value: new THREE.Color('#ffca7b') }, glowStrength: { value: 1 } },
      vertexShader: 'varying vec2 glowUV; void main(){glowUV=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 glowColor;uniform float glowStrength;varying vec2 glowUV;void main(){float radius=length(glowUV-0.5)*2.0;float glow=pow(max(0.0,1.0-radius),3.0)*0.24*glowStrength;gl_FragColor=vec4(glowColor,glow);\n#include <colorspace_fragment>\n}',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
    }));
    this.sunHalo.name = 'sun-halo'; this.scene.add(this.sunHalo);
    this.lamps = [];
    const poleMaterial = this.material('#46594d');
    this.lampMaterial = this.material('#e7eacb', { emissive: '#ffdc82', emissiveIntensity: 0 });
    for (const t of [0.045, 0.18, 0.35, 0.53, 0.7, 0.86]) {
      const p = this.track.point(t, this.track.width / 2 + 2.4).position;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.8, 6), poleMaterial);
      pole.position.set(p.x, 2.4, p.z);
      pole.castShadow = true;
      this.scene.add(pole);
      this.physics.box(null, [0.25, 4.8, 0.25], pole.position);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 16), this.lampMaterial);
      lantern.position.set(p.x, 5.05, p.z);
      this.scene.add(lantern);
      const light = new THREE.PointLight('#ffd49a', 0, 14, 2);
      light.position.set(p.x, 4.4, p.z);
      this.lamps.push(light);
      this.scene.add(light);
    }
  }
  makeTrees() {
    const positions = [], halfWidth = WORLD_SIZE.width / 2, halfDepth = WORLD_SIZE.depth / 2;
    for (let attempt = 0; positions.length < 120 && attempt < 8000; attempt++) {
      const x = (this.random() - 0.5) * 119 * TRACK_SCALE, z = (this.random() - 0.5) * 99 * TRACK_SCALE;
      if (this.track.nearest({ x, z }).distance < 7.8 || Math.hypot(x + TRACK_SCALE, z + 3 * TRACK_SCALE) < 9 * TRACK_SCALE) continue;
      if (this.lake.isNear(x, z, 3.6)) continue;
      if (positions.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < 20)) continue;
      const choice = this.random(), kind = choice < 0.42 ? 'pine' : choice < 0.7 ? 'birch' : 'oak';
      positions.push({ x, z, kind, height: (kind === 'pine' ? 5.8 : kind === 'birch' ? 6.8 : 5.2) + this.random() * 2.1, radius: (kind === 'pine' ? 1.3 : kind === 'birch' ? 1.35 : 1.9) + this.random() * 0.65 });
    }
    const insideCourse = (x, z) => {
      let inside = false;
      const route = this.track.samples;
      for (let i = 0, j = route.length - 1; i < route.length; j = i++) {
        const a = route[i], b = route[j];
        if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
      }
      return inside;
    };
    const clearance = p => this.track.width / 2 + this.track.curbWidth + 3.1 + p.radius * (p.kind === 'oak' ? 1.9 : 1.45);
    const forest = [];
    for (const p of positions) {
      if (!insideCourse(p.x, p.z)) {
        const nearest = this.track.nearest(p), anchor = this.track.point(nearest.progress).position;
        const outward = new THREE.Vector2(p.x - anchor.x, p.z - anchor.z).normalize();
        const move = Math.max(0, clearance(p) - nearest.distance);
        p.x += outward.x * move; p.z += outward.y * move;
      }
      if (Math.abs(p.x) < halfWidth - 2 && Math.abs(p.z) < halfDepth - 2 && !this.lake.isNear(p.x, p.z, 3.6)) forest.push(p);
    }
    const scatter = randomGenerator(73622);
    let exteriorCount = forest.filter(p => !insideCourse(p.x, p.z)).length;
    for (let attempt = 0; exteriorCount < 540 && attempt < 18000; attempt++) {
      const x = (scatter() - 0.5) * (WORLD_SIZE.width - 4), z = (scatter() - 0.5) * (WORLD_SIZE.depth - 4);
      if (insideCourse(x, z) || this.lake.isNear(x, z, 4)) continue;
      const choice = scatter(), kind = choice < 0.42 ? 'pine' : choice < 0.7 ? 'birch' : 'oak';
      const p = { x, z, kind, height: (kind === 'pine' ? 5.8 : kind === 'birch' ? 6.8 : 5.2) + scatter() * 2.1,
        radius: (kind === 'pine' ? 1.3 : kind === 'birch' ? 1.35 : 1.9) + scatter() * 0.65 };
      if (this.track.nearest(p).distance < clearance(p)) continue;
      if (forest.some(tree => (tree.x - x) ** 2 + (tree.z - z) ** 2 < 10.9)) continue;
      forest.push(p); exteriorCount++;
    }
    positions.splice(0, positions.length, ...forest);
    this.trees = positions;
    const broadTrees = positions.filter(p => p.kind !== 'pine');
    const bark = this.material('#ffffff', { map: createBarkTexture('brown'), roughness: 1 });
    const birchBark = this.material('#ffffff', { map: createBarkTexture('birch'), roughness: 1 });
    const birchCount = positions.filter(p => p.kind === 'birch').length;
    const trunkGeometry = new THREE.CylinderGeometry(0.08, 0.17, 1, 8), branchGeometry = new THREE.CylinderGeometry(0.045, 0.075, 1, 6);
    const trunks = new THREE.InstancedMesh(trunkGeometry.clone(), bark, positions.length - birchCount), birchTrunks = new THREE.InstancedMesh(trunkGeometry.clone(), birchBark, birchCount);
    const branches = new THREE.InstancedMesh(branchGeometry.clone(), bark, (broadTrees.length - birchCount) * 3), birchBranches = new THREE.InstancedMesh(branchGeometry.clone(), birchBark, birchCount * 3);
    const prepareTreeData = mesh => {
      mesh.geometry.setAttribute('treeData', new THREE.InstancedBufferAttribute(new Float32Array(mesh.count * 4), 4));
    };
    const setTreeData = (mesh, index, tree) => {
      mesh.geometry.attributes.treeData.setXYZW(index, tree.x, tree.z, tree.height, tree.kind === 'pine' ? 0.65 : tree.kind === 'birch' ? 1.3 : 1.05);
    };
    const brownDepth = applyWind(bark, 'wood', this.timeUniform, this.windUniform, this.windField);
    const birchDepth = applyWind(birchBark, 'wood', this.timeUniform, this.windUniform, this.windField);
    for (const mesh of [trunks, branches, birchTrunks, birchBranches]) {
      prepareTreeData(mesh); mesh.customDepthMaterial = mesh.material === bark ? brownDepth : birchDepth;
    }
    const makeFoliage = (geometry, count, kind) => {
      const material = applySceneStyle(new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true, side: THREE.DoubleSide, alphaMap: createLeafMask(kind), alphaTest: kind === 'pine' ? 0.45 : 0.3, alphaToCoverage: true, toneMapped: false }), this.dayPalette);
      applyLeafCloud(material, this.viewUniforms, kind);
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      prepareTreeData(mesh);
      mesh.name = `${kind}-crowns`; mesh.customDepthMaterial = applyWind(material, kind, this.timeUniform, this.windUniform, this.windField);
      const depthCompile = mesh.customDepthMaterial.onBeforeCompile;
      mesh.customDepthMaterial.onBeforeCompile = shader => { depthCompile(shader); Object.assign(shader.uniforms, this.shadowFoliageView); };
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.foliage.push(mesh); this.scene.add(mesh); return mesh;
    };
    const crowns = Object.fromEntries(['pine', 'birch', 'oak'].map(kind => [kind, makeFoliage(kind === 'pine' ? createPineGeometry() : createCanopyGeometry(kind), positions.filter(p => p.kind === kind).length * (kind === 'pine' ? 1 : 4), kind)]));
    const palette = { pine: ['#3f6650', '#4f7756', '#5c7c58'], birch: ['#e0ba3a', '#efcd60', '#d4a538'], oak: ['#d8a44a', '#cc8f39', '#e3b84f', '#82994b'] };
    const clustersByKind = { birch: [[0, 0.82, 0, 0.64], [-0.32, 0.64, 0.05, 0.60], [0.3, 0.7, -0.24, 0.58], [0.06, 0.59, 0.32, 0.55]], oak: [[0, 0.75, 0, 0.95], [-0.45, 0.68, 0.05, 0.82], [0.42, 0.69, -0.35, 0.8], [0.08, 0.59, 0.48, 0.78]] };
    const root = new THREE.Vector3(), tip = new THREE.Vector3(), direction = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const crownIndices = { pine: 0, birch: 0, oak: 0 }; let branchIndex = 0, birchBranchIndex = 0, trunkIndex = 0, birchTrunkIndex = 0;
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const pine = p.kind === 'pine', birch = p.kind === 'birch';
      const trunkHeight = p.height * (pine ? 0.68 : birch ? 0.71 : 0.6), thickness = birch ? 0.75 + p.height * 0.025 : pine ? 0.85 + p.height * 0.055 : 1.1 + p.height * 0.07;
      const barkColor = new THREE.Color(birch ? '#d8d9c9' : pine ? '#76634d' : '#6f5e49');
      const crown = crowns[p.kind], leafColor = new THREE.Color(palette[p.kind][i % palette[p.kind].length]);
      this.dummy.position.set(p.x, trunkHeight / 2, p.z);
      this.dummy.scale.set(thickness, trunkHeight, thickness);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      const trunkMesh = birch ? birchTrunks : trunks, trunkSlot = birch ? birchTrunkIndex++ : trunkIndex++;
      trunkMesh.setMatrixAt(trunkSlot, this.dummy.matrix); trunkMesh.setColorAt(trunkSlot, barkColor);
      setTreeData(trunkMesh, trunkSlot, p);
      if (pine) {
        this.dummy.position.set(p.x, 0, p.z); this.dummy.scale.set(p.radius, p.height, p.radius);
        this.dummy.rotation.set(0, this.random() * Math.PI * 2, 0); this.dummy.updateMatrix();
        const index = crownIndices.pine++;
        crown.setMatrixAt(index, this.dummy.matrix); crown.setColorAt(index, leafColor);
        setTreeData(crown, index, p);
      } else {
        const clusters = clustersByKind[p.kind];
        for (const [x, y, z, scale] of clusters) {
          this.dummy.position.set(p.x + x * p.radius, p.height * y, p.z + z * p.radius);
          this.dummy.scale.setScalar(p.radius * scale);
          this.dummy.rotation.set(0, i * 1.78, 0); this.dummy.updateMatrix();
          const index = crownIndices[p.kind]++;
          crown.setMatrixAt(index, this.dummy.matrix); crown.setColorAt(index, leafColor);
          setTreeData(crown, index, p);
        }
        for (let branch = 1; branch < clusters.length; branch++) {
          const [x, y, z] = clusters[branch]; root.set(p.x, p.height * 0.42, p.z); tip.set(p.x + x * p.radius, p.height * y, p.z + z * p.radius);
          direction.subVectors(tip, root); this.dummy.position.copy(root).add(tip).multiplyScalar(0.5);
          this.dummy.scale.set(thickness, direction.length(), thickness); this.dummy.quaternion.setFromUnitVectors(up, direction.normalize()); this.dummy.updateMatrix();
          const branchMesh = birch ? birchBranches : branches, branchSlot = birch ? birchBranchIndex++ : branchIndex++;
          branchMesh.setMatrixAt(branchSlot, this.dummy.matrix); branchMesh.setColorAt(branchSlot, barkColor);
          setTreeData(branchMesh, branchSlot, p);
        }
      }
      this.physics.box(null, [0.34 * thickness, trunkHeight, 0.34 * thickness], new THREE.Vector3(p.x, trunkHeight / 2, p.z));
    }
    for (const mesh of [trunks, branches, birchTrunks, birchBranches]) mesh.castShadow = true;
    trunks.name = 'tree-trunks'; branches.name = 'tree-branches'; birchTrunks.name = 'birch-trunks'; birchBranches.name = 'birch-branches';
    this.scene.add(trunks, branches, birchTrunks, birchBranches);
  }
  makeGrass() {
    const geometry = createGrassGeometry();
    const material = applySceneStyle(new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide, toneMapped: false }), this.dayPalette, true, { baseShadow: 'meadowRootShadow', directLight: 0 });
    this.meadowUniforms = { ...this.terrain.uniforms, meadowNoise: { value: createGrassNoise() } };
    applyMeadow(material, this.meadowUniforms);
    applyWind(material, 'grass', this.timeUniform, this.windUniform, this.windField);
    // Grass.js: one blade per fragment, random over the fragment's FULL size.
    // Use the reference's ideal density throughout our fixed world; the small
    // random fragments prevent rows, and terrain.g alone controls clearings.
    const tileSize = 20, scatter = randomGenerator(974531), spacing = Math.sqrt(2000 / (280 * 280));
    const fieldWidth = WORLD_SIZE.width, fieldDepth = WORLD_SIZE.depth, halfWidth = fieldWidth / 2, halfDepth = fieldDepth / 2;
    const columns = Math.ceil(fieldWidth / spacing), rows = Math.ceil(fieldDepth / spacing);
    const fragmentWidth = fieldWidth / columns, fragmentDepth = fieldDepth / rows;
    const tileCapacity = (Math.ceil(tileSize / fragmentWidth) + 2) * (Math.ceil(tileSize / fragmentDepth) + 2);
    const tiles = new Map();
    const addBlade = (x, z, kind, variation) => {
      if (x < -halfWidth || x >= halfWidth || z < -halfDepth || z >= halfDepth || this.terrain.sampleDensity(x, z) < 0.51) return;
      const tileX = -halfWidth + Math.floor((x + halfWidth) / tileSize) * tileSize;
      const tileZ = -halfDepth + Math.floor((z + halfDepth) / tileSize) * tileSize;
      const key = `${tileX},${tileZ}`;
      // Keep temporary roots packed, avoiding an object for every blade.
      // Float64 preserves the original positions until matrices are written.
      if (!tiles.has(key)) tiles.set(key, { x: tileX, z: tileZ, blades: new Float64Array(tileCapacity * 4), count: 0 });
      const tile = tiles.get(key), index = tile.count++ * 4;
      tile.blades[index] = x; tile.blades[index + 1] = z;
      tile.blades[index + 2] = kind; tile.blades[index + 3] = variation;
    };
    for (let column = 0; column < columns; column++) for (let row = 0; row < rows; row++) {
      const x = -halfWidth + (column + scatter()) * fragmentWidth;
      const z = -halfDepth + (row + scatter()) * fragmentDepth;
      addBlade(x, z, 1, scatter());
    }
    this.grass = new THREE.Group(); this.grassMeshes = []; this.grassCount = 0;
    this.grass.name = 'fixed-world-meadow';
    for (const { x, z, blades: roots, count } of tiles.values()) {
      const width = Math.min(tileSize, halfWidth - x), depth = Math.min(tileSize, halfDepth - z);
      // Low quality reduces mesh.count, so randomise instance order to thin
      // the entire tile instead of exposing a rectangular planted corner.
      for (let i = count - 1; i > 0; i--) {
        const j = Math.floor(scatter() * (i + 1)), a = i * 4, b = j * 4;
        for (let component = 0; component < 4; component++) {
          const value = roots[a + component]; roots[a + component] = roots[b + component]; roots[b + component] = value;
        }
      }
      const tileGeometry = geometry.clone(), kinds = new Float32Array(count), variations = new Float32Array(count);
      tileGeometry.setAttribute('grassKind', new THREE.InstancedBufferAttribute(kinds, 1));
      tileGeometry.setAttribute('grassVariation', new THREE.InstancedBufferAttribute(variations, 1));
      const mesh = new THREE.InstancedMesh(tileGeometry, material, count);
      mesh.name = `meadow-tile-${x}-${z}`; mesh.position.set(x + width / 2, 0, z + depth / 2);
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), Math.hypot(width / 2, depth / 2) + 2.5);
      mesh.receiveShadow = true; mesh.userData.totalCount = count;
      for (let i = 0; i < count; i++) {
        const index = i * 4;
        kinds[i] = roots[index + 2]; variations[i] = roots[index + 3];
        this.dummy.position.set(roots[index] - x - width / 2, 0.005, roots[index + 1] - z - depth / 2); this.dummy.scale.set(1, 1, 1); this.dummy.rotation.set(0, 0, 0); this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.grass.add(mesh); this.grassMeshes.push(mesh); this.grassCount += count;
    }
    geometry.dispose();
    this.scene.add(this.grass);
  }
  makeObstacles() {
    const wood = this.material('#b89962');
    const strap = this.material('#685b43');
    this.ramps = addTrackRamps(this.scene, this.physics, this.track, this.dayPalette, []);
    const length = this.track.curve.getLength();
    const separation = (a, b) => { const gap = Math.abs(a - b) % 1; return Math.min(gap, 1 - gap) * length; };
    let slalomProgress = 0.13, slalomScore = Infinity;
    for (let i = 0; i < 160; i++) {
      const t = i / 160;
      if (separation(t, 0) < 38 || this.ramps.some(ramp => separation(t, ramp.progress) < 52)) continue;
      const p = this.track.point(t); let score = 0;
      for (const distance of [-25, -18, -10, 10, 18, 25]) {
        const sample = this.track.point(t + distance / length), delta = sample.position.clone().sub(p.position);
        score += Math.abs(delta.x * p.tangent.z - delta.z * p.tangent.x)
          + 4 * Math.acos(THREE.MathUtils.clamp(sample.tangent.dot(p.tangent), -1, 1));
      }
      if (score < slalomScore) { slalomScore = score; slalomProgress = t; }
    }
    this.slalomProgress = slalomProgress;
    const rows = [];
    for (const desired of [0.25, 0.59, 0.82]) {
      const candidates = Array.from({ length: 160 }, (_, i) => i / 160)
        .filter(t => separation(t, 0) > 18 && separation(t, slalomProgress) > 28
          && this.ramps.every(ramp => separation(t, ramp.progress) > 42) && rows.every(row => separation(t, row) > 22))
        .sort((a, b) => separation(a, desired) - separation(b, desired));
      if (candidates.length) rows.push(candidates[0]);
    }
    const crateLayouts = [
      Array.from({ length: 6 }, (_, i) => [-this.track.width / 2 + 0.7 + i * 1.13, (i - 2.5) * 0.62]),
      [[-4.45, -0.6], [-3.32, -0.9], [-2.19, -1.2], [2.19, 1.1], [3.32, 1.4], [4.45, 1.7]],
      [[0.95, -1.2], [2.1, -1.4], [3.25, -1.6], [4.4, -1.8], [3.8, -0.25], [4.4, 1.2], [-4.4, 3.6]],
    ];
    for (const [row, t] of rows.entries()) {
      for (const [column, [offset, along]] of crateLayouts[row].entries()) {
        const p = this.track.point(t + along / length, offset);
        const group = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.05, 1.05), wood);
        box.castShadow = true;
        box.receiveShadow = true;
        group.add(box);
        for (const side of [-1, 1]) {
          const band = new THREE.Mesh(new THREE.BoxGeometry(1.07, 0.1, 1.07), strap);
          band.position.y = side * 0.32;
          group.add(band);
        }
        this.scene.add(group);
        const angle = p.yaw + Math.sin(column * 3.7 + row * 1.4) * 0.12;
        const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        const item = this.physics.box(group, [1.08, 1.08, 1.08], new THREE.Vector3(p.position.x, this.track.height + 0.55, p.position.z), 2.2, 0.38, rotation);
        item.body.setRestitution(0.04); item.body.setDamping(0.12, 0.3);
        this.obstacles.push(item);
      }
    }
    const coneMaterial = this.material('#ed9154');
    const baseMaterial = this.material('#3a463c');
    const white = this.material('#efe8ca');
    for (let i = 0; i < 7; i++) {
      const p = this.track.point(slalomProgress + (i - 3) * 7 / length, (i % 2 ? -1 : 1) * 0.35).position;
      const cone = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 8), coneMaterial);
      body.position.y = 0.01;
      body.castShadow = true;
      cone.add(body);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.08, 0.65), baseMaterial);
      base.position.y = -0.37;
      cone.add(base);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.13, 8), white);
      band.position.y = 0.07;
      cone.add(band);
      this.scene.add(cone);
      this.obstacles.push(this.physics.box(cone, [0.67, 0.84, 0.67], new THREE.Vector3(p.x, this.track.height + 0.43, p.z), 3, 0.65));
    }
    const tireMaterial = this.material('#283731');
    const tireGeometry = new THREE.TorusGeometry(0.5, 0.19, 8, 16);
    let tireProgress = 0.29, previousTire = null;
    for (let i = 0; i < 35; i++) {
      let p;
      do { p = this.track.point(tireProgress, this.track.width / 2 + 2.5); tireProgress += 0.0005; }
      while ((previousTire && p.position.distanceTo(previousTire) < 1.43) || this.lamps.some(lamp => Math.hypot(lamp.position.x - p.position.x, lamp.position.z - p.position.z) < 0.9));
      previousTire = p.position;
      const tire = new THREE.Mesh(tireGeometry, tireMaterial);
      tire.rotation.x = Math.PI / 2;
      tire.position.set(p.position.x, 0.2, p.position.z);
      tire.castShadow = true;
      this.scene.add(tire);
      this.physics.box(null, [1.4, 0.4, 1.4], tire.position);
    }
    // The cloth is attached along its mast edge; only the poles have rigid bodies.
    for (const offset of [-1, 1].map(side => side * (this.track.width / 2 + 1.8))) {
      const p = this.track.point(0, offset).position;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), strap);
      pole.position.set(p.x, 2, p.z);
      this.scene.add(pole);
      this.physics.box(null, [0.13, 4, 0.13], pole.position);
      const flag = new ClothFlag(p.clone().setY(3.55), this.material('#e4e3c5', { side: THREE.DoubleSide }), offset < 0 ? 0 : 2.4);
      this.flags.push(flag); this.scene.add(flag.mesh);
    }
  }
  makePuddles() {
    const shape = new THREE.Shape();
    for (let i = 0; i <= 36; i++) {
      const angle = i / 36 * Math.PI * 2;
      const radius = 1 + Math.sin(angle * 3) * 0.12 + Math.cos(angle * 5) * 0.09;
      const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    const geometry = new THREE.ShapeGeometry(shape);
    this.waterMaterial = this.material('#749caa', { roughness: 0.08, metalness: 0.65, transparent: true, opacity: 0, depthWrite: false });
    const puddleCount = 8;
    for (let i = 0; i < puddleCount; i++) {
      const progress = (0.05 + i / puddleCount + this.random() * 0.025) % 1, lane = (this.random() - 0.5) * 4;
      const size = { x: 1.2 + this.random() * 1.8, z: 0.6 + this.random() };
      let p = this.track.point(progress, lane);
      if (this.ramps.some(ramp => ramp.coversPoint(p.position, Math.hypot(size.x, size.z) * 1.21))) p = this.track.point(progress + 24 / this.track.curve.getLength(), lane);
      const mesh = new THREE.Mesh(geometry, this.waterMaterial);
      mesh.rotation.set(-Math.PI / 2, 0, p.yaw);
      mesh.position.set(p.position.x, this.track.height + 0.014, p.position.z);
      this.puddles.push({ mesh, size, yaw: p.yaw });
      this.scene.add(mesh);
    }
    this.ripples = new THREE.InstancedMesh(new THREE.RingGeometry(0.92, 1, 20), new THREE.MeshBasicMaterial({ color: '#b1d4d5', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }), 32);
    this.scene.add(this.ripples);
  }
  makeRain() {
    this.rainCount = 950;
    this.rainPositions = new Float32Array(this.rainCount * 6);
    this.drops = new Float32Array(this.rainCount * 3);
    for (let i = 0; i < this.rainCount; i++) {
      this.drops[i * 3] = (this.random() - 0.5) * 65;
      this.drops[i * 3 + 1] = this.random() * 30;
      this.drops[i * 3 + 2] = (this.random() - 0.5) * 65;
    }
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainLines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#b6d5db', transparent: true, opacity: 0, depthWrite: false }));
    this.rainLines.frustumCulled = false;
    this.scene.add(this.rainLines);
  }
  surfaceAt(position, result) {
    result.height = this.groundDetails.groundHeight(position.x, position.z); result.normal.set(0, 1, 0);
    for (const ramp of this.ramps) if (ramp.surfaceAt(position, result)) break;
    return result;
  }
  inPuddle(position, wetness) {
    const scale = smoothstep(0.12, 0.85, wetness);
    if (scale < 0.15) return false;
    for (const p of this.puddles) {
      const dx = position.x - p.mesh.position.x, dz = position.z - p.mesh.position.z;
      const x = Math.cos(p.yaw) * dx - Math.sin(p.yaw) * dz;
      const z = Math.sin(p.yaw) * dx + Math.cos(p.yaw) * dz;
      if ((x / (p.size.x * scale)) ** 2 + (z / (p.size.z * scale)) ** 2 < 1) return true;
    }
    return false;
  }
  setQuality(low) { for (const mesh of this.grassMeshes) mesh.count = low ? Math.max(1, Math.floor(mesh.userData.totalCount * Math.min(1, 16000 / this.grassCount))) : mesh.userData.totalCount; this.rainCount = low ? 350 : 950; }
  update(dt, environment, camera, overview, vehicle = null) {
    const daylight = environment.daylight, rain = environment.rain, wet = environment.wetness;
    const visualHour = environment.visualHour ?? environment.hour;
    this.timeUniform.value = environment.elapsed;
    this.windUniform.value = environment.windStrength;
    const windAngle = Math.PI * 0.6 + Math.sin(environment.elapsed * 0.033) * 0.25 + Math.sin(environment.elapsed * 0.077) * 0.09;
    this.windField.windDirection.value.set(Math.sin(windAngle), Math.cos(windAngle));
    const windOffset = this.windField.windOffset.value;
    windOffset.addScaledVector(this.windField.windDirection.value, dt * 0.12 * environment.windStrength);
    // All four noise layers repeat after an offset of 100.
    windOffset.x %= 100; windOffset.y %= 100;
    for (const flag of this.flags) flag.update(dt, environment.windStrength, this.windField.windDirection.value);
    this.groundDetails.update(dt, environment, vehicle);
    this.rainUniform.value = rain;
    camera.updateMatrixWorld();
    this.viewUniforms.foliageCameraRight.value.setFromMatrixColumn(camera.matrixWorld, 0);
    this.viewUniforms.foliageCameraUp.value.setFromMatrixColumn(camera.matrixWorld, 1);
    this.terrain.uniforms.terrainWetness.value = wet;
    this.dayPalette.update(visualHour);
    this.dayPalette.uniforms.sceneLightIntensity.value *= 1 - rain * 0.35;
    this.sky.material.uniforms.top.value.copy(this.dayPalette.top).lerp(OVERCAST_SKY, rain * 0.35);
    this.sky.material.uniforms.bottom.value.copy(this.dayPalette.horizon).lerp(OVERCAST_SKY, rain * 0.3);
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.stars.material.opacity = (1 - daylight) * (1 - rain) * 0.8;
    this.scene.fog.color.copy(this.sky.material.uniforms.bottom.value);
    this.scene.fog.density = (0.0032 + rain * 0.0023) * (overview ? 0.65 : 1);
    this.ambient.color.copy(this.dayPalette.ambient);
    this.ambient.intensity = this.dayPalette.hemi * (1 - rain * 0.25);
    this.sun.intensity = this.dayPalette.sun * (1 - rain * 0.65);
    this.sun.color.copy(this.dayPalette.light);
    this.sunShadows.update(visualHour);
    const sunVisibility = smoothstep(-0.04, 0.08, this.sunShadows.solarDirection.y) * (1 - smoothstep(0.4, 0.95, rain));
    this.sunDisc.material.opacity = sunVisibility;
    this.sunHalo.material.uniforms.glowStrength.value = sunVisibility;
    this.sunDisc.visible = this.sunHalo.visible = sunVisibility > 0.001;
    this.sunDisc.position.copy(camera.position).addScaledVector(this.sunShadows.solarDirection, 340);
    this.sunDisc.quaternion.copy(camera.quaternion);
    this.sunDisc.material.color.copy(this.dayPalette.light).lerp(this.color.set('#fff4d1'), 0.65);
    this.sunHalo.position.copy(this.sunDisc.position); this.sunHalo.quaternion.copy(camera.quaternion);
    this.dayPalette.uniforms.sceneLightDirection.value.copy(this.sunShadows.direction);
    this.lake.update(environment, this.dayPalette);
    this.lampMaterial.emissiveIntensity = (1 - daylight) * 2.5;
    for (const lamp of this.lamps) lamp.intensity = (1 - daylight) * 28;
    this.clouds.material.color.set('#ecede0').lerp(RAIN_CLOUDS, rain).multiplyScalar(0.25 + daylight * 0.75);
    this.clouds.position.x = Math.sin(environment.elapsed * 0.008) * 12 * environment.wind;
    this.clouds.material.opacity = 0.3 + rain * 0.55;
    this.track.roadMaterial.roughness = 0.95 - wet * 0.78;
    this.track.roadMaterial.color.set('#454d4c').lerp(WET_ROAD, wet * 0.8);
    const puddleScale = smoothstep(0.12, 0.85, wet);
    this.waterMaterial.opacity = puddleScale * 0.78;
    this.waterMaterial.color.set('#749caa').lerp(NIGHT_WATER, 1 - daylight);
    for (const puddle of this.puddles) { puddle.mesh.scale.set(puddle.size.x * puddleScale, puddle.size.z * puddleScale, 1); puddle.mesh.visible = puddleScale > 0.01; }
    this.ripples.material.opacity = rain * puddleScale * 0.28;
    for (let i = 0; i < 32; i++) {
      const puddle = this.puddles[i % this.puddles.length];
      const age = (environment.elapsed * 0.6 + i * 0.131) % 1;
      const radius = age * 0.65 * puddleScale;
      this.dummy.position.set(puddle.mesh.position.x + Math.sin(i * 2.4) * 0.2, this.track.height + 0.017, puddle.mesh.position.z + Math.cos(i * 1.3) * 0.2);
      this.dummy.rotation.set(-Math.PI / 2, 0, 0);
      this.dummy.scale.set(radius, radius, radius);
      this.dummy.updateMatrix();
      this.ripples.setMatrixAt(i, this.dummy.matrix);
    }
    this.ripples.instanceMatrix.needsUpdate = true;
    this.ripples.visible = rain * puddleScale > 0.02;
    this.rainLines.material.opacity = rain * 0.48;
    this.rainLines.visible = rain > 0.015;
    if (this.rainLines.visible) {
      const centerX = overview ? 0 : camera.position.x, centerZ = overview ? 0 : camera.position.z;
      for (let i = 0; i < this.rainCount; i++) {
        const index = i * 3;
        this.drops[index] += dt * environment.windStrength * 3;
        this.drops[index + 1] -= dt * 21;
        if (this.drops[index + 1] < 0) { this.drops[index + 1] = 30; this.drops[index] = (this.random() - 0.5) * 65; this.drops[index + 2] = (this.random() - 0.5) * 65; }
        const x = this.drops[index] + centerX, y = this.drops[index + 1], z = this.drops[index + 2] + centerZ;
        const vertex = i * 6;
        this.rainPositions[vertex] = x; this.rainPositions[vertex + 1] = y; this.rainPositions[vertex + 2] = z;
        this.rainPositions[vertex + 3] = x - environment.windStrength * 0.25; this.rainPositions[vertex + 4] = y + 1.2; this.rainPositions[vertex + 5] = z;
      }
      this.rainLines.geometry.setDrawRange(0, this.rainCount * 2);
      this.rainLines.geometry.attributes.position.needsUpdate = true;
    }
  }
}
