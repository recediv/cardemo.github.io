import * as THREE from '../vendor/three.module.js';

export function installStableShadowFilter() {
  // Three r184 rotates five PCF samples with screen-space random noise. That
  // pattern crawls over the world during camera motion. Use a fixed tent kernel
  // with native bilinear depth comparisons, shared by every scene material.
  const stablePCF = `float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
    vec3 coord = shadowCoord.xyz / shadowCoord.w;
    coord.z += shadowBias;
    if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z > 1.0) return 1.0;
    vec2 spacing = vec2(shadowRadius) / shadowMapSize;
    float shadow = 0.0;
    for (int y = 0; y < 4; y++) {
      float weightY = (y == 0 || y == 3) ? 1.0 : 3.0;
      for (int x = 0; x < 4; x++) {
        float weightX = (x == 0 || x == 3) ? 1.0 : 3.0;
        vec2 offset = (vec2(float(x), float(y)) - vec2(1.5)) * spacing;
        shadow += texture(shadowMap, vec3(coord.xy + offset, coord.z)) * weightX * weightY;
      }
    }
    return mix(1.0, shadow / 64.0, shadowIntensity);
  }
  `;
  THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment.replace(
    /float getShadow\( sampler2DShadow[\s\S]*?(?=#elif defined\( SHADOWMAP_TYPE_VSM \))/,
    stablePCF,
  );
}

export class SunShadows {
  constructor(light) {
    this.light = light;
    this.direction = new THREE.Vector3(); this.solarDirection = new THREE.Vector3(); this.center = new THREE.Vector3(0, 2, 0);
    light.shadow.bias = -0.00015;
    light.shadow.normalBias = 0.06;
    light.shadow.radius = 2;
    light.shadow.intensity = 0.68;
    // One world-space shadow volume for the entire course and its forest.
    Object.assign(light.shadow.camera, { left: -115, right: 115, top: 115, bottom: -115, near: 1, far: 360 });
    light.shadow.camera.updateProjectionMatrix();
  }
  update(hour) {
    // East at 06:00, high in the sky at noon, west at 18:00.
    const angle = (hour - 6) / 24 * Math.PI * 2;
    const height = Math.sin(angle);
    this.solarDirection.set(Math.cos(angle), height * 0.9, -height * 0.42).normalize();
    // The dim night light continues along the same horizontal path. Reflect its
    // elevation smoothly; flipping the whole vector at sunset caused a 180° jump.
    this.direction.set(Math.cos(angle), Math.sqrt(height * height + 0.0256) * 0.9, -height * 0.42).normalize();
    const daylight = THREE.MathUtils.smootherstep(this.solarDirection.y, -0.2, 0.2);
    const fade = THREE.MathUtils.smootherstep(Math.abs(this.solarDirection.y), 0.04, 0.28);
    this.light.shadow.intensity = fade * THREE.MathUtils.lerp(0.3, 0.68, daylight);
    this.light.target.position.copy(this.center);
    this.light.position.copy(this.center).addScaledVector(this.direction, 180);
    this.light.target.updateMatrixWorld(); this.light.updateMatrixWorld();
  }
}
