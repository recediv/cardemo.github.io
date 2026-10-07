import * as THREE from '../vendor/three.module.js';
import { randomGenerator } from './simulation.js';

const FORWARD = new THREE.Vector3(0, 0, 1);
const LENGTH = 24;
const HALF_WIDTH = 11.2;
const HALF_HEIGHT = 3.8;
const DUST_PERIOD = 64;

// Local, homogeneous scattering approximation. Twelve fixed samples integrate
// the light along the viewing ray; the box itself never provides a visible skin.
// There is no screen-space jitter, depth buffer pass or extra shadow map.
const lightFieldShader = `
  float headlightField(vec3 p) {
    float radius = 0.10 + max(p.z, 0.0) * 0.45;
    float radial = length(vec2(p.x, p.y / 0.28)) / radius;
    float edge = 1.0 - smoothstep(0.68, 1.0, radial);
    float profile = exp(-radial * radial * 3.2) * edge;
    float nearFade = smoothstep(0.08, 0.7, p.z);
    float farFade = 1.0 - smoothstep(14.0, 24.0, p.z);
    return profile * nearFade * farFade / (1.0 + max(p.z, 0.0) * max(p.z, 0.0) * 0.065);
  }
`;

const volumeVertexShader = `
  varying vec3 vVolumePosition;
  void main() {
    vVolumePosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const volumeFragmentShader = `
  uniform mat4 worldToVolume;
  uniform mat4 volumeToWorld;
  uniform vec3 volumeMin;
  uniform vec3 volumeMax;
  uniform vec3 beamColor;
  uniform float density;
  uniform float time;
  varying vec3 vVolumePosition;
  ${lightFieldShader}
  void main() {
    vec3 origin = (worldToVolume * vec4(cameraPosition, 1.0)).xyz;
    vec3 direction = normalize(vVolumePosition - origin);
    vec3 safeDirection = mix(vec3(0.00001), direction, step(vec3(0.00001), abs(direction)));
    vec3 first = (volumeMin - origin) / safeDirection;
    vec3 last = (volumeMax - origin) / safeDirection;
    vec3 entry = min(first, last);
    vec3 exit = max(first, last);
    float start = max(0.0, max(entry.x, max(entry.y, entry.z)));
    float end = min(exit.x, min(exit.y, exit.z));
    if (end <= start) discard;
    float stepLength = (end - start) / 12.0;
    float scattered = 0.0;
    for (int i = 0; i < 12; i++) {
      vec3 p = origin + direction * (start + (float(i) + 0.5) * stepLength);
      vec3 world = (volumeToWorld * vec4(p, 1.0)).xyz;
      float aboveGround = smoothstep(0.055, 0.24, world.y);
      float medium = 0.94 + sin(world.x * 0.17 + world.z * 0.11 + time * 0.23) * 0.06;
      float angle = dot(-direction, normalize(p + vec3(0.0, 0.0, 0.001)));
      // A broad forward scattering lobe, softened to keep head-on glare modest.
      float g = 0.32;
      float phase = (1.0 - g * g) / pow(max(0.01, 1.0 + g * g - 2.0 * g * angle), 1.5);
      scattered += headlightField(p) * aboveGround * medium * phase;
    }
    float alpha = min(0.14, 1.0 - exp(-scattered * stepLength * density));
    if (alpha < 0.0001) discard;
    gl_FragColor = vec4(beamColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const dustVertexShader = `
  attribute vec2 dustData;
  uniform mat4 beamWorldToLocal[2];
  uniform vec3 carPosition;
  uniform vec2 windTravel;
  uniform float time;
  uniform float dustAmount;
  uniform float pixelScale;
  varying float vVisibility;
  ${lightFieldShader}
  void main() {
    vec3 world = position;
    // Wrap only beyond the 24 m light range. Inside the beam each mote keeps
    // its world position when either the car or camera moves.
    world.xz = mod(world.xz + windTravel - carPosition.xz + 32.0, 64.0) - 32.0 + carPosition.xz;
    world.y += sin(time * (0.28 + dustData.y * 0.19) + dustData.y * 41.0) * 0.13;
    world.x += sin(time * 0.43 + dustData.y * 29.0) * 0.10;
    world.z += cos(time * 0.31 + dustData.y * 37.0) * 0.12;
    float illumination = 0.0;
    for (int i = 0; i < 2; i++) {
      vec3 local = (beamWorldToLocal[i] * vec4(world, 1.0)).xyz;
      illumination = max(illumination, headlightField(local));
    }
    float life = 0.65 + sin(time * 0.36 + dustData.y * 19.0) * 0.35;
    vVisibility = sqrt(max(illumination, 0.0)) * dustAmount * life * smoothstep(0.06, 0.20, world.y);
    vec4 viewPoint = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * viewPoint;
    gl_PointSize = clamp(dustData.x * pixelScale * projectionMatrix[1][1] / max(0.4, -viewPoint.z), 0.8, 3.2);
  }
`;

const dustFragmentShader = `
  uniform vec3 beamColor;
  varying float vVisibility;
  void main() {
    vec2 point = gl_PointCoord * 2.0 - 1.0;
    float radiusSquared = dot(point, point);
    float softDisc = exp(-radiusSquared * 4.0) * (1.0 - smoothstep(0.6, 1.0, radiusSquared));
    float alpha = vVisibility * softDisc;
    if (alpha < 0.0001) discard;
    gl_FragColor = vec4(beamColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class HeadlightSystem {
  constructor(scene, carRoot) {
    this.carRoot = carRoot;
    this.lights = [];
    this.volumes = [];
    this.elapsed = null;
    this.activation = 0;
    this.carPosition = new THREE.Vector3();
    this.windTravel = new THREE.Vector2();
    const beamColor = new THREE.Color('#fff1da');
    const geometry = new THREE.BoxGeometry(HALF_WIDTH * 2, HALF_HEIGHT * 2, LENGTH).translate(0, 0, LENGTH / 2);
    for (const side of [-1, 1]) {
      const source = new THREE.Vector3(side * 0.6, 0.29, 1.69);
      const target = new THREE.Vector3(side * 0.6, -0.4, 20);
      const light = new THREE.SpotLight(beamColor, 0, 28, 0.42, 1, 2);
      light.name = 'soft-headlight';
      light.position.copy(source);
      light.target.position.copy(target);
      carRoot.add(light, light.target);
      this.lights.push(light);

      const frame = new THREE.Group();
      frame.position.copy(source);
      frame.quaternion.setFromUnitVectors(FORWARD, target.clone().sub(source).normalize());
      const material = new THREE.ShaderMaterial({
        uniforms: {
          worldToVolume: { value: new THREE.Matrix4() },
          volumeToWorld: { value: new THREE.Matrix4() },
          volumeMin: { value: new THREE.Vector3(-HALF_WIDTH, -HALF_HEIGHT, 0) },
          volumeMax: { value: new THREE.Vector3(HALF_WIDTH, HALF_HEIGHT, LENGTH) },
          beamColor: { value: beamColor },
          density: { value: 0 },
          time: { value: 0 },
        },
        vertexShader: volumeVertexShader,
        fragmentShader: volumeFragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        side: THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'headlight-scattering';
      frame.add(mesh);
      carRoot.add(frame);
      this.volumes.push({ frame, mesh, uniforms: material.uniforms });
    }
    this.createDust(scene, beamColor);
  }

  createDust(scene, beamColor) {
    const count = 896, random = randomGenerator(92731);
    const positions = new Float32Array(count * 3), data = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = random() * DUST_PERIOD;
      positions[i * 3 + 1] = 0.16 + random() * 2.8;
      positions[i * 3 + 2] = random() * DUST_PERIOD;
      data[i * 2] = 0.025 + random() * 0.025;
      data[i * 2 + 1] = random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('dustData', new THREE.BufferAttribute(data, 2));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        beamWorldToLocal: { value: this.volumes.map(volume => volume.uniforms.worldToVolume.value) },
        carPosition: { value: this.carPosition },
        windTravel: { value: this.windTravel },
        time: { value: 0 },
        dustAmount: { value: 0 },
        pixelScale: { value: 500 },
        beamColor: { value: beamColor },
      },
      vertexShader: dustVertexShader,
      fragmentShader: dustFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
    });
    this.dust = new THREE.Points(geometry, material);
    this.dust.name = 'headlight-dust';
    this.dust.frustumCulled = false;
    scene.add(this.dust);
  }

  update(environment) {
    const darkness = THREE.MathUtils.smoothstep(1 - environment.daylight, 0.04, 0.85);
    this.activation = darkness;
    const rain = THREE.MathUtils.clamp(environment.rain, 0, 1);
    const time = environment.elapsed;
    const dt = this.elapsed === null ? 0 : THREE.MathUtils.clamp(time - this.elapsed, 0, 0.1);
    this.elapsed = time;
    const wind = environment.windStrength;
    this.windTravel.x = (this.windTravel.x + dt * wind * 0.38) % DUST_PERIOD;
    this.windTravel.y = (this.windTravel.y + dt * wind * 0.19) % DUST_PERIOD;
    this.carRoot.updateWorldMatrix(true, true);
    this.carRoot.getWorldPosition(this.carPosition);
    for (let i = 0; i < this.lights.length; i++) {
      this.lights[i].intensity = darkness * 220;
      const volume = this.volumes[i];
      volume.mesh.visible = darkness > 0.005;
      volume.uniforms.worldToVolume.value.copy(volume.frame.matrixWorld).invert();
      volume.uniforms.volumeToWorld.value.copy(volume.frame.matrixWorld);
      volume.uniforms.density.value = darkness * (0.023 + rain * 0.010);
      volume.uniforms.time.value = time;
    }
    this.dust.visible = darkness > 0.005 && rain < 0.995;
    this.dust.material.uniforms.time.value = time;
    this.dust.material.uniforms.dustAmount.value = darkness * (1 - rain * 0.94) * 0.30;
    if (typeof window !== 'undefined') this.dust.material.uniforms.pixelScale.value = window.innerHeight * Math.min(window.devicePixelRatio || 1, 1.5) * 0.5;
  }
}
