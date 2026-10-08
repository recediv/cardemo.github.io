import * as THREE from '../vendor/three.module.js';

const NEON_COLOR = '#54d9ef';

export function createUnderglowStrips() {
  const positions = [];
  const add = (size, offset) => {
    const box = new THREE.BoxGeometry(...size).toNonIndexed();
    box.translate(...offset); positions.push(...box.attributes.position.array); box.dispose();
  };
  for (const side of [-1, 1]) add([0.035, 0.024, 2.6], [side * 0.65, -0.245, -0.05]);
  for (const end of [-1, 1]) add([1.25, 0.024, 0.035], [0, -0.245, end * 1.33 - 0.05]);
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.MeshBasicMaterial({ color: NEON_COLOR, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const strips = new THREE.Mesh(geometry, material); strips.name = 'underglow-strips'; strips.visible = false;
  return strips;
}

export function updateUnderglowStrips(car, activation, opacity = 1) {
  const strips = car.userData.underglowMesh;
  strips.material.opacity = activation * 0.85 * opacity;
  strips.visible = activation > 0.005;
}

const UP = new THREE.Vector3(0, 1, 0);

export class UnderglowSystem {
  constructor(scene, vehicle, world) {
    this.vehicle = vehicle; this.world = world;
    this.surface = { height: 0, normal: new THREE.Vector3(0, 1, 0) };
    this.forward = new THREE.Vector3(0, 0, 1); this.direction = new THREE.Vector3();
    this.right = new THREE.Vector3(); this.along = new THREE.Vector3(); this.basis = new THREE.Matrix4(); this.up = new THREE.Vector3();
    const material = new THREE.ShaderMaterial({
      uniforms: { glowColor: { value: new THREE.Color(NEON_COLOR) }, intensity: { value: 0 } },
      vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 glowColor; uniform float intensity; varying vec2 vUv;
        void main() {
          vec2 p = (vUv - 0.5) * 2.0; float radius = dot(p, p);
          float alpha = intensity * exp(-radius * 2.7) * (1.0 - smoothstep(0.65, 1.0, radius));
          if (alpha < 0.001) discard;
          gl_FragColor = vec4(glowColor, alpha);
          #include <colorspace_fragment>
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.glow.name = 'underglow-ground'; this.glow.visible = false; scene.add(this.glow);
  }

  update() {
    const car = this.vehicle.mesh, darkness = this.vehicle.headlightSystem.activation;
    updateUnderglowStrips(car, darkness);
    this.up.copy(UP).applyQuaternion(car.quaternion);
    const activation = darkness * THREE.MathUtils.smoothstep(this.up.y, 0, 0.6);
    this.glow.visible = activation > 0.005;
    if (!this.glow.visible) return;
    this.world.surfaceAt(car.position, this.surface);
    const height = Math.max(0, car.position.y - this.surface.height - 0.42), spread = Math.min(height, 4);
    this.glow.position.set(car.position.x, this.surface.height + 0.025, car.position.z);
    this.direction.set(0, 0, 1).applyQuaternion(car.quaternion).setY(0);
    if (this.direction.lengthSq() > 0.001) this.forward.copy(this.direction).normalize();
    this.right.crossVectors(this.surface.normal, this.forward).normalize();
    this.along.crossVectors(this.surface.normal, this.right).normalize();
    this.basis.makeBasis(this.right, this.along, this.surface.normal);
    this.glow.quaternion.setFromRotationMatrix(this.basis);
    this.glow.scale.set(3.4 + spread * 0.8, 5 + spread * 0.9, 1);
    this.glow.material.uniforms.intensity.value = activation * 0.3 / (1 + height * 0.32);
  }
}
