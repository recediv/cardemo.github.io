import * as THREE from '../vendor/three.module.js';
import { clamp, randomGenerator, smoothstep } from './simulation.js';

const PARTICLES = 72;
const smokeVertexShader = `
  attribute vec3 smokeData;
  uniform float pixelScale;
  varying float vOpacity;
  varying float vPhase;
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = clamp(smokeData.x * pixelScale / max(0.1, -mvPosition.z), 0.0, 96.0);
    vOpacity = smokeData.y; vPhase = smokeData.z;
    #include <fog_vertex>
  }
`;
const smokeFragmentShader = `
  uniform vec3 smokeColor;
  varying float vOpacity;
  varying float vPhase;
  #include <fog_pars_fragment>
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    p += vec2(sin(vPhase), cos(vPhase * 1.3)) * 0.12;
    float radius = dot(p, p);
    float alpha = vOpacity * exp(-radius * 3.0) * (1.0 - smoothstep(0.6, 1.0, radius));
    if (alpha < 0.001) discard;
    gl_FragColor = vec4(smokeColor, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;
const flameVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const flameFragmentShader = `
  uniform float strength;
  uniform float phase;
  varying vec2 vUv;
  void main() {
    float ripple = 0.85 + sin(vUv.x * 25.1327 + vUv.y * 17.0 + phase) * 0.15;
    float alpha = strength * pow(1.0 - vUv.y, 1.4) * ripple;
    if (alpha < 0.002) discard;
    vec3 hot = mix(vec3(0.28, 0.6, 1.0), vec3(1.0, 0.85, 0.45), smoothstep(0.03, 0.22, vUv.y));
    vec3 color = mix(hot, vec3(1.0, 0.22, 0.015), smoothstep(0.25, 0.85, vUv.y));
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

export class ExhaustSystem {
  constructor(scene, vehicle, camera, renderer, windDirection) {
    this.vehicle = vehicle; this.camera = camera; this.renderer = renderer; this.windDirection = windDirection;
    this.random = randomGenerator(73149); this.cursor = 0; this.smokeBudget = 0;
    this.shots = 0; this.lastShotPower = 0; this.burstRemaining = 0; this.burstDuration = 0; this.shotCooldown = this.nextShotDelay();
    this.outlets = vehicle.mesh.userData.exhaustOutlets.map(position => position.clone().add(new THREE.Vector3(0, vehicle.centerOfMassOffset, 0)));
    this.backward = new THREE.Vector3(); this.velocity = new THREE.Vector3();
    this.previousCarPosition = vehicle.mesh.position.clone();
    this.smokePositions = new Float32Array(PARTICLES * 3); this.smokeData = new Float32Array(PARTICLES * 3);
    this.particles = Array.from({ length: PARTICLES }, () => ({ position: new THREE.Vector3(), velocity: new THREE.Vector3(), age: 0, life: 0, size: 0, opacity: 0, phase: 0 }));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.smokePositions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('smokeData', new THREE.BufferAttribute(this.smokeData, 3).setUsage(THREE.DynamicDrawUsage));
    this.smokeMaterial = new THREE.ShaderMaterial({
      uniforms: { pixelScale: { value: 600 }, smokeColor: { value: new THREE.Color('#c6c4bf') }, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
      vertexShader: smokeVertexShader, fragmentShader: smokeFragmentShader, transparent: true, depthWrite: false, fog: true,
    });
    this.smoke = new THREE.Points(geometry, this.smokeMaterial); this.smoke.name = 'exhaust-smoke'; this.smoke.frustumCulled = false; scene.add(this.smoke);
    this.daySmoke = new THREE.Color('#c6c4bf'); this.nightSmoke = new THREE.Color('#718297');

    this.flameMaterial = new THREE.ShaderMaterial({
      uniforms: { strength: { value: 0 }, phase: { value: 0 } }, vertexShader: flameVertexShader, fragmentShader: flameFragmentShader,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const flameGeometry = new THREE.ConeGeometry(0.09, 1, 16, 1, true).translate(0, 0.5, 0).rotateX(-Math.PI / 2);
    this.flames = this.outlets.map(position => {
      const flame = new THREE.Mesh(flameGeometry, this.flameMaterial); flame.name = 'exhaust-backfire'; flame.position.copy(position);
      flame.visible = false; vehicle.mesh.add(flame); return flame;
    });
    this.flash = new THREE.PointLight('#ff8b42', 0, 3.2, 2); this.flash.name = 'exhaust-flash';
    this.flash.position.copy(this.outlets[0]); this.flash.position.z -= 0.16;
    vehicle.mesh.add(this.flash);
  }

  clear() {
    for (const particle of this.particles) particle.life = 0;
    this.smokeData.fill(0); this.smoke.geometry.attributes.smokeData.needsUpdate = true;
    this.burstRemaining = 0; this.shotCooldown = this.nextShotDelay(); this.smokeBudget = 0;
    this.flash.intensity = 0; this.flameMaterial.uniforms.strength.value = 0;
    for (const flame of this.flames) flame.visible = false;
    this.previousCarPosition.copy(this.vehicle.mesh.position);
  }

  emit(power, burst = false) {
    this.vehicle.mesh.updateWorldMatrix(true, false);
    this.backward.set(0, 0, -1).applyQuaternion(this.vehicle.mesh.quaternion);
    const bodyVelocity = this.vehicle.body.getLinearVelocity();
    this.velocity.set(bodyVelocity.x(), bodyVelocity.y(), bodyVelocity.z());
    for (const outlet of this.outlets) {
      const particle = this.particles[this.cursor]; this.cursor = (this.cursor + 1) % PARTICLES;
      particle.position.copy(outlet).applyMatrix4(this.vehicle.mesh.matrixWorld);
      particle.velocity.copy(this.velocity).multiplyScalar(0.16).addScaledVector(this.backward, burst ? 2.2 : 0.6 + power * 0.8);
      particle.velocity.y += 0.35 + this.random() * 0.2;
      particle.velocity.x += (this.random() - 0.5) * 0.18; particle.velocity.z += (this.random() - 0.5) * 0.18;
      particle.age = 0; particle.life = 0.8 + this.random() * 0.55; particle.size = 0.12 + this.random() * 0.065;
      particle.opacity = burst ? 0.22 : 0.14 + power * 0.055; particle.phase = this.random() * Math.PI * 2;
    }
  }

  nextShotDelay() { return 2.5 + this.random() * 3.5; }

  fire(power) {
    this.shots++; this.lastShotPower = power;
    this.burstDuration = 0.11 + this.random() * 0.05; this.burstRemaining = this.burstDuration;
    this.shotCooldown = this.nextShotDelay();
    this.emit(power, true);
  }

  update(dt, environment, input) {
    if (dt <= 0) return;
    if (this.previousCarPosition.distanceToSquared(this.vehicle.mesh.position) > 144) this.clear();
    this.previousCarPosition.copy(this.vehicle.mesh.position);
    const boostHeld = input.boost;
    const power = clamp(Math.max(Math.abs(this.vehicle.throttle), boostHeld ? 0.8 : 0));
    const boost = boostHeld && !input.brake && !input.backward;
    if (boost) this.shotCooldown = Math.max(0, this.shotCooldown - dt);
    this.burstRemaining = Math.max(0, this.burstRemaining - dt);
    if (boost && this.shotCooldown === 0) this.fire(0.65 + power * 0.35);

    const burstAge = this.burstDuration - this.burstRemaining;
    const strength = this.burstRemaining > 0 ? smoothstep(0, 0.015, burstAge) * smoothstep(0, 0.085, this.burstRemaining) : 0;
    this.flameMaterial.uniforms.strength.value = strength * 0.75;
    this.flameMaterial.uniforms.phase.value = environment.elapsed * 42;
    for (let i = 0; i < this.flames.length; i++) {
      this.flames[i].visible = strength > 0.005;
      this.flames[i].scale.set(1, 1, (0.38 + this.lastShotPower * 0.3) * (0.8 + Math.sin(environment.elapsed * 35 + i) * 0.12));
    }
    this.flash.intensity = strength * 8;
    this.smokeBudget += dt * (5 + power * 7);
    while (this.smokeBudget >= 1) { this.emit(power); this.smokeBudget--; }

    const windStep = environment.windStrength * dt * 0.25;
    let active = false;
    for (let i = 0; i < PARTICLES; i++) {
      const particle = this.particles[i], index = i * 3;
      particle.age += dt;
      if (particle.age >= particle.life) { this.smokeData[index + 1] = 0; continue; }
      active = true;
      particle.velocity.x += this.windDirection.x * windStep;
      particle.velocity.z += this.windDirection.y * windStep;
      particle.position.addScaledVector(particle.velocity, dt);
      particle.position.y = Math.max(0.055, particle.position.y);
      this.smokePositions[index] = particle.position.x; this.smokePositions[index + 1] = particle.position.y; this.smokePositions[index + 2] = particle.position.z;
      const life = particle.age / particle.life;
      this.smokeData[index] = particle.size + particle.age * 0.28;
      this.smokeData[index + 1] = particle.opacity * smoothstep(0, 0.09, particle.age) * (1 - life) ** 1.5;
      this.smokeData[index + 2] = particle.phase + particle.age * 0.3;
    }
    this.smoke.visible = active;
    this.smokeMaterial.uniforms.smokeColor.value.copy(this.nightSmoke).lerp(this.daySmoke, environment.daylight);
    this.smokeMaterial.uniforms.pixelScale.value = this.renderer.domElement.height * this.camera.projectionMatrix.elements[5] * 0.5;
    this.smoke.geometry.attributes.position.needsUpdate = true; this.smoke.geometry.attributes.smokeData.needsUpdate = true;
  }
}
