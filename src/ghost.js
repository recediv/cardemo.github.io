import * as THREE from '../vendor/three.module.js';
import { createRacingCar } from './car-model.js';
import { updateUnderglowStrips } from './underglow.js';

const SAMPLE_INTERVAL = 1 / 30;
const MAX_LAP_SECONDS = 10 * 60;
const MAX_SAMPLES = Math.ceil(MAX_LAP_SECONDS / SAMPLE_INTERVAL) + 2;
const GHOST_OPACITY = 0.3;
const POSE_SIZE = 7;

function invertColor(color) {
  color.convertLinearToSRGB();
  color.setRGB(1 - THREE.MathUtils.clamp(color.r, 0, 1), 1 - THREE.MathUtils.clamp(color.g, 0, 1), 1 - THREE.MathUtils.clamp(color.b, 0, 1));
  color.convertSRGBToLinear();
}

function ghostMaterial(original) {
  const material = original.clone();
  if (material.color) invertColor(material.color);
  // Keep unlit surfaces unlit. Only the existing lamp colours are inverted.
  if (material.emissive && original.emissive.getHex() !== 0) invertColor(material.emissive);
  material.transparent = true;
  material.opacity = original.opacity * GHOST_OPACITY;
  material.alphaTest = original.alphaTest * GHOST_OPACITY;
  material.depthWrite = false;
  material.forceSinglePass = true;

  const previous = original.onBeforeCompile, key = original.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => previous.call(material, shader, renderer);
  material.customProgramCacheKey = () => key;
  if (original.map && original.color) {
    // Inverting only the white tint would make a mapped number decal black.
    // Invert its sampled colour instead, inside the original standard shader;
    // the real car's shared texture and material remain unchanged.
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      shader.uniforms.ghostSourceColor = { value: original.color.clone() };
      shader.fragmentShader = `
        uniform vec3 ghostSourceColor;
        vec3 ghostToSRGB(vec3 c) {
          return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
        }
        vec3 ghostFromSRGB(vec3 c) {
          return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
        }
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        #ifdef USE_MAP
          diffuseColor.rgb = ghostFromSRGB(vec3(1.0) - clamp(ghostToSRGB(ghostSourceColor * sampledDiffuseColor.rgb), 0.0, 1.0));
        #endif
      `);
    };
    material.customProgramCacheKey = () => `${key}-ghost-inverted-map-v1`;
  }
  return material;
}

export class BestLapGhost {
  constructor(scene, vehicle) {
    this.vehicle = vehicle;
    this.best = null;
    this.bestDuration = null;
    this.group = new THREE.Group(); this.group.name = 'best-lap-ghost';
    this.mesh = createRacingCar();
    for (const child of this.mesh.children) child.position.y += vehicle.centerOfMassOffset ?? 0.18;
    this.wheels = vehicle.wheels.map(wheel => wheel.mesh.clone(true));
    this.objects = [this.mesh, ...this.wheels];
    this.group.add(...this.objects);
    const materials = new Map();
    this.group.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = true;
      const cloneMaterial = original => {
        if (!materials.has(original)) materials.set(original, ghostMaterial(original));
        return materials.get(original);
      };
      object.material = Array.isArray(object.material) ? object.material.map(cloneMaterial) : cloneMaterial(object.material);
    });
    this.mesh.userData.lampMaterial = materials.get(this.mesh.userData.lampMaterial);
    this.mesh.userData.tailMaterial = materials.get(this.mesh.userData.tailMaterial);
    this.mesh.userData.underglowMaterial = materials.get(this.mesh.userData.underglowMaterial);
    this.group.visible = false;
    scene.add(this.group);
    this.quaternionA = new THREE.Quaternion(); this.quaternionB = new THREE.Quaternion();
    this.reset();
  }

  writePose(poses) {
    const physical = [this.vehicle.item, ...this.vehicle.wheels];
    for (let i = 0; i < physical.length; i++) {
      const offset = i * POSE_SIZE, { position, quaternion } = physical[i];
      poses[offset] = position.x; poses[offset + 1] = position.y; poses[offset + 2] = position.z;
      poses[offset + 3] = quaternion.x; poses[offset + 4] = quaternion.y;
      poses[offset + 5] = quaternion.z; poses[offset + 6] = quaternion.w;
    }
  }

  capture(time) {
    if (this.invalid) return;
    if (time > MAX_LAP_SECONDS || this.frames.length >= MAX_SAMPLES) {
      this.invalid = true; this.frames.length = 0; return;
    }
    const last = this.frames[this.frames.length - 1];
    if (last && Math.abs(last.time - time) < 1e-8) {
      this.writePose(last.poses); return;
    }
    const frame = { time, poses: new Float32Array(this.objects.length * POSE_SIZE) };
    this.writePose(frame.poses);
    this.frames.push(frame);
  }

  step(dt, laps, completed) {
    if (this.vehicle.recoveries !== this.recoveries) {
      this.recoveries = this.vehicle.recoveries;
      this.invalid = true; this.frames.length = 0;
    }
    if (completed) {
      const duration = laps.lastLap;
      if (Number.isFinite(duration) && duration > 0) {
        this.capture(duration);
        if (!this.invalid && this.frames.length > 1 && (this.bestDuration === null || duration < this.bestDuration)) {
          this.best = this.frames;
          this.bestDuration = duration;
        }
      }
      this.beginAttempt();
      return;
    }
    if (!laps.running) { this.capture(0); return; }
    if (laps.time > MAX_LAP_SECONDS) { this.invalid = true; this.frames.length = 0; return; }
    this.sampleElapsed += dt;
    if (this.sampleElapsed >= SAMPLE_INTERVAL - 1e-8) {
      this.sampleElapsed %= SAMPLE_INTERVAL;
      this.capture(laps.time);
    }
  }

  beginAttempt() {
    this.frames = [];
    this.invalid = false;
    this.sampleElapsed = 0;
    this.recoveries = this.vehicle.recoveries;
    this.playbackIndex = 0;
    this.capture(0);
  }

  render(time) {
    if (!this.best || time < 0 || time > this.bestDuration + 1e-8) {
      this.group.visible = false; return;
    }
    this.group.visible = true;
    updateUnderglowStrips(this.mesh, this.vehicle.headlightSystem.activation, GHOST_OPACITY);
    const frames = this.best;
    if (time < frames[this.playbackIndex].time) this.playbackIndex = 0;
    while (this.playbackIndex < frames.length - 2 && frames[this.playbackIndex + 1].time <= time) this.playbackIndex++;
    const a = frames[this.playbackIndex], b = frames[this.playbackIndex + 1];
    const alpha = THREE.MathUtils.clamp((time - a.time) / Math.max(b.time - a.time, 1e-8), 0, 1);
    for (let i = 0; i < this.objects.length; i++) {
      const offset = i * POSE_SIZE, object = this.objects[i];
      object.position.set(
        THREE.MathUtils.lerp(a.poses[offset], b.poses[offset], alpha),
        THREE.MathUtils.lerp(a.poses[offset + 1], b.poses[offset + 1], alpha),
        THREE.MathUtils.lerp(a.poses[offset + 2], b.poses[offset + 2], alpha),
      );
      this.quaternionA.fromArray(a.poses, offset + 3); this.quaternionB.fromArray(b.poses, offset + 3);
      object.quaternion.slerpQuaternions(this.quaternionA, this.quaternionB, alpha);
    }
  }

  reset() {
    this.beginAttempt();
    this.render(0);
  }
}
