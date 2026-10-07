import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from '../vendor/three.module.js';
import { Track } from '../src/track.js';
import { World } from '../src/world.js';
import { EnvironmentState } from '../src/simulation.js';
import { SunShadows } from '../src/lighting.js';
import { DayPalette } from '../src/day-cycle.js';
import { createGrassGeometry, createPineGeometry, createCanopyGeometry, applyWind } from '../src/vegetation.js';
import { createTerrainField } from '../src/terrain.js';
import { withCanvas } from './canvas.mjs';

const makeWorld = (...args) => withCanvas(() => new World(...args));

function intersects(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  return cross(a, b, c) * cross(a, b, d) < -1e-9 && cross(c, d, a) * cross(c, d, b) < -1e-9;
}

test('Road and curb rings have no folded corners, self intersections or gaps', () => {
  const track = new Track(new THREE.Scene());
  let minRadius = Infinity;
  for (let i = 0; i < 2400; i++) {
    const a = track.point((i - 1) / 2400).position, b = track.point(i / 2400).position, c = track.point((i + 1) / 2400).position;
    const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x));
    minRadius = Math.min(minRadius, a.distanceTo(b) * b.distanceTo(c) * a.distanceTo(c) / (2 * area2));
  }
  assert.ok(minRadius > track.width / 2 + track.curbWidth + 2);
  for (const offset of [-track.width / 2 - track.curbWidth, -track.width / 2, track.width / 2, track.width / 2 + track.curbWidth]) {
    const ring = Array.from({ length: 400 }, (_, i) => track.point(i / 400, offset).position);
    for (let i = 0; i < ring.length; i++) for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue;
      assert.ok(!intersects(ring[i], ring[(i + 1) % ring.length], ring[j], ring[(j + 1) % ring.length]), `Crossing at offset ${offset}, segments ${i}, ${j}`);
    }
  }
  track.curbs.forEach((curb, sideIndex) => {
    const p = curb.geometry.attributes.position, n = curb.geometry.attributes.normal;
    const same = (a, b) => { for (let axis = 0; axis < 3; axis++) assert.equal(p.array[a * 3 + axis], p.array[b * 3 + axis]); };
    const endInner = sideIndex === 0 ? 2 : 1, endOuter = sideIndex === 0 ? 4 : 5, startOuter = sideIndex === 0 ? 1 : 2;
    for (let section = 0; section < track.segments; section++) for (let strip = 0; strip < 3; strip++) {
      const start = section * 18 + strip * 6, next = ((section + 1) % track.segments) * 18 + strip * 6;
      same(start + endInner, next); same(start + endOuter, next + startOuter);
    }
    for (let i = 0; i < n.count; i++) assert.ok(n.getY(i) > 0.8, 'Curb triangle folded below the road');
  });
  assert.ok(track.markings.material.polygonOffset, 'Road paint must have depth separation');
});

test('Triangle grass and leaf-cloud crowns have usable geometry, colors and wind weights', () => {
  const grass = createGrassGeometry(); grass.computeBoundingBox();
  assert.equal(grass.attributes.position.count, 3);
  assert.equal(grass.attributes.plantWeight.getX(0), 0);
  assert.equal(grass.attributes.plantWeight.getX(1), 0);
  assert.equal(grass.attributes.position.getY(0), 0);
  assert.equal(grass.attributes.position.getY(1), 0);
  for (const geometry of [grass, createPineGeometry(), createCanopyGeometry()]) {
    const count = geometry.attributes.position.count;
    for (const name of ['normal', 'plantWeight', 'plantDerivative', ...(geometry === grass ? [] : ['color'])]) {
      assert.equal(geometry.attributes[name].count, count);
      for (const value of geometry.attributes[name].array) assert.ok(Number.isFinite(value));
    }
    for (const weight of geometry.attributes.plantWeight.array) assert.ok(weight >= 0 && weight <= 1);
  }
});

test('Wind bends plant normals and the depth pass uses the same displacement', () => {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const time = { value: 0 }, wind = { value: 1 }, depth = applyWind(material, 'oak', time, wind);
  const colorShader = { vertexShader: THREE.ShaderLib.lambert.vertexShader, uniforms: {} };
  const depthShader = { vertexShader: THREE.ShaderLib.depth.vertexShader, uniforms: {} };
  material.onBeforeCompile(colorShader); depth.onBeforeCompile(depthShader);
  for (const shader of [colorShader, depthShader]) {
    assert.match(shader.vertexShader, /transformed\.xz \+= forestBend\(\) \* plantWeight/);
    assert.match(shader.vertexShader, /objectNormal\.y -= dot\(normalBend, objectNormal\.xz\) \* plantDerivative/);
    assert.equal(shader.uniforms.worldTime, time); assert.equal(shader.uniforms.worldWind, wind);
  }
  // At the tip of a bent vertical leaf, the corrected normal stays perpendicular
  // to its deformed tangent. The previous shader left the normal unchanged.
  const bend = new THREE.Vector2(0.12, 0.04), derivative = 4;
  const tangent = new THREE.Vector3(bend.x * derivative, 1, bend.y * derivative);
  const normal = new THREE.Vector3(1, -bend.x * derivative, 0).normalize();
  assert.ok(Math.abs(tangent.dot(normal)) < 1e-8);
});

test('Directional shadows keep their world volume and follow the time of day', () => {
  const light = new THREE.DirectionalLight(), rig = new SunShadows(light); light.shadow.mapSize.set(2048, 2048);
  rig.update(14, new THREE.Vector3(), false); const center = rig.center.clone();
  rig.update(14, new THREE.Vector3(40, 12, -25), true);
  assert.ok(center.distanceTo(rig.center) < 1e-8);
  rig.update(14, new THREE.Vector3(), true); light.shadow.updateMatrices(light);
  assert.ok(Number.isFinite(light.shadow.normalBias)); assert.ok(light.shadow.bias < 0);
  for (const [x, z] of [[-60, -50], [60, -50], [60, 50], [-60, 50]]) {
    const projected = new THREE.Vector3(x, 0, z).project(light.shadow.camera);
    assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && Math.abs(projected.z) < 1);
  }
});

test('Puddle collision area matches its rotated visible ellipse', () => {
  const scene = new THREE.Scene(), track = new Track(scene);
  const world = makeWorld(scene, { setGroundGeometry() {}, staticGeometry() {}, box(mesh, size, position, mass, friction, quaternion = new THREE.Quaternion()) { if (mesh) { mesh.position.copy(position); mesh.quaternion.copy(quaternion); } return { position: position.clone(), mesh }; } }, track);
  const environment = new EnvironmentState(); environment.wetness = 1; environment.setWeather('clear');
  world.update(0, environment, new THREE.PerspectiveCamera(), false); scene.updateMatrixWorld(true);
  const puddles = world.puddles; world.puddles = [puddles[0]];
  const mesh = puddles[0].mesh;
  assert.ok(world.inPuddle(mesh.localToWorld(new THREE.Vector3(0.8, 0, 0)), 1));
  assert.ok(!world.inPuddle(mesh.localToWorld(new THREE.Vector3(0, 1.2, 0)), 1));
  assert.ok(!world.inPuddle(mesh.position, 0));
});

test('Automatic rain is short, infrequent and waits for a fully dry road plus a dry break', () => {
  const env = new EnvironmentState(); env.setTime(0); env.wind = 0;
  assert.equal(env.dayDuration, 90); assert.ok(env.clearDuration >= 120); assert.ok(env.rainDuration <= 20);
  const dt = 1 / 60; let rainStarted = null, clearStarted = 0, episodes = 0;
  for (let i = 0; i < 60 * 900; i++) {
    const phase = env.weatherPhase, wetness = env.wetness, dryClock = env.dryClock; env.step(dt);
    if (phase === env.weatherPhase) continue;
    if (env.weatherPhase === 'rain') {
      assert.equal(wetness, 0); assert.ok(dryClock >= env.dryBreak); assert.ok(i * dt - clearStarted >= env.clearDuration - dt * 2);
      rainStarted = i * dt; episodes++;
    } else { assert.ok(i * dt - rainStarted <= env.rainDuration + dt * 2); clearStarted = i * dt; }
  }
  assert.ok(episodes >= 3 && episodes <= 6);
  env.weatherPhase = 'clear'; env.weatherClock = 1000; env.wetness = 0.8; env.dryClock = 100;
  env.step(dt); assert.equal(env.weatherPhase, 'clear');
  env.setWeather('rain'); for (let i = 0; i < 60 * 30; i++) env.step(dt); assert.ok(env.rain > 0.99);
});

test('Morning, day, evening and night change light hue, shadow hue and sky without jumps', () => {
  const palette = new DayPalette(), samples = [7, 14, 18.5, 0].map(hour => {
    palette.update(hour);
    return { light: new THREE.Vector3(palette.light.r, palette.light.g, palette.light.b).normalize(), shadow: palette.shadow.clone(), sky: palette.horizon.clone() };
  });
  for (let i = 0; i < samples.length; i++) for (let j = i + 1; j < samples.length; j++) {
    assert.ok(samples[i].light.distanceTo(samples[j].light) > 0.12, `Light hue, not just brightness, must change between presets ${i} and ${j}`);
    assert.ok(Math.abs(samples[i].shadow.r - samples[j].shadow.r) + Math.abs(samples[i].shadow.b - samples[j].shadow.b) > 0.08);
    assert.ok(Math.abs(samples[i].sky.r - samples[j].sky.r) + Math.abs(samples[i].sky.b - samples[j].sky.b) > 0.1);
  }
  for (const hour of [0, 4.5, 7, 10, 16, 18.5, 21.5, 24]) {
    palette.update(hour - 0.001); const before = palette.light.clone(); palette.update(hour + 0.001);
    assert.ok((before.r - palette.light.r) ** 2 + (before.g - palette.light.g) ** 2 + (before.b - palette.light.b) ** 2 < 1e-8);
  }
});

test('Terrain density clears the entire road and its curbs, including their closing seam', () => {
  const track = new Track(new THREE.Scene()), terrain = withCanvas(() => createTerrainField(track));
  for (let i = 0; i < 240; i++) for (const offset of [-5.35, -4.5, 0, 4.5, 5.35]) {
    const p = track.point(i / 240, offset).position;
    assert.ok(terrain.sampleDensity(p.x, p.z) < 0.5, `Grass inside curb at ${i}, ${offset}`);
  }
});

test('Leaf shaders share wind while shadow billboards keep a fixed world orientation', () => {
  const scene = new THREE.Scene(), track = new Track(scene);
  const world = makeWorld(scene, { setGroundGeometry() {}, staticGeometry() {}, box(mesh, size, position) { return { mesh, position: position.clone() }; } }, track);
  for (const mesh of world.foliage) {
    const color = { vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader, uniforms: {} };
    const depth = { vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader, uniforms: {} };
    mesh.material.onBeforeCompile(color); mesh.customDepthMaterial.onBeforeCompile(depth);
    for (const shader of [color, depth]) {
      assert.match(shader.vertexShader, /transformed = leafCenter \+ cloudLocalDirection/);
      assert.match(shader.vertexShader, /transformed\.xz \+= forestBend\(\) \* plantWeight/);
      assert.equal(shader.uniforms.foliageCameraRight, shader === depth ? world.shadowFoliageView.foliageCameraRight : world.viewUniforms.foliageCameraRight);
    }
    assert.equal(mesh.customDepthMaterial.alphaMap, mesh.material.alphaMap);
    assert.equal(mesh.customDepthMaterial.alphaTest, mesh.material.alphaTest);
    assert.doesNotMatch(depth.fragmentShader, /sceneLightColor|litColor|shadeColor/);
    assert.match(color.fragmentShader, /diffuseColor.rgb \* sceneShadowColor/);
  }
});

test('Crates, cones, barrier tyres and track poles fit their physical boxes', () => {
  const scene = new THREE.Scene(), track = new Track(scene), boxes = [];
  const world = makeWorld(scene, { setGroundGeometry() {}, staticGeometry() {}, box(mesh, size, position, mass, friction, quaternion = new THREE.Quaternion()) {
    if (mesh) { mesh.position.copy(position); mesh.quaternion.copy(quaternion); }
    const item = { mesh, size, position: position.clone(), quaternion: quaternion.clone() }; boxes.push(item); return item;
  } }, track);
  scene.updateMatrixWorld(true);
  const check = (mesh, collider) => {
    const inverse = new THREE.Matrix4().compose(collider.position, collider.quaternion, new THREE.Vector3(1, 1, 1)).invert();
    mesh.traverse(part => {
      if (!part.isMesh) return;
      const vertices = part.geometry.attributes.position;
      for (let i = 0; i < vertices.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(vertices, i).applyMatrix4(part.matrixWorld).applyMatrix4(inverse);
        for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(p.getComponent(axis)) <= collider.size[axis] / 2 + 1e-5, `${part.geometry.type} protrudes from physical box`);
      }
    });
  };
  for (const item of world.obstacles) check(item.mesh, item);
  let staticChecked = 0;
  for (const mesh of scene.children.filter(mesh => mesh.isMesh && !mesh.isInstancedMesh && ['TorusGeometry', 'CylinderGeometry'].includes(mesh.geometry.type))) {
    const collider = boxes.find(item => item.position.distanceTo(mesh.position) < 1e-8);
    assert.ok(collider, `${mesh.geometry.type} missing collision`); check(mesh, collider); staticChecked++;
  }
  assert.equal(staticChecked, 43);
});
