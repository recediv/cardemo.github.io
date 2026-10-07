import * as THREE from '../vendor/three.module.js';

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

async function waitForGpu(gl) {
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) return;
  gl.flush();
  try {
    while (!gl.isContextLost()) {
      await nextFrame();
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status !== gl.TIMEOUT_EXPIRED) return;
    }
  } finally {
    gl.deleteSync(sync);
  }
}

// Prepare hidden effects, the ghost and every fixed grass tile before driving.
// A tiny viewport on the actual canvas keeps the same colour/tone shaders as
// normal frames; an offscreen render target would compile different variants.
export async function prepareRenderer(renderer, scene, camera) {
  const viewport = renderer.getViewport(new THREE.Vector4());
  const canvasVisibility = renderer.domElement.style.visibility;
  const objects = [], textures = new Set();
  const collectTexture = value => {
    if (value?.isTexture && !value.isRenderTargetTexture) textures.add(value);
    else if (Array.isArray(value)) for (const item of value) collectTexture(item);
  };
  const collectMaterial = material => {
    for (const value of Object.values(material)) collectTexture(value);
    if (material.uniforms) for (const uniform of Object.values(material.uniforms)) collectTexture(uniform.value);
  };
  scene.traverse(object => {
    objects.push({ object, visible: object.visible, frustumCulled: object.frustumCulled });
    if (!object.isLight) object.visible = true;
    object.frustumCulled = false;
    if (object.material) for (const material of [].concat(object.material)) collectMaterial(material);
    if (object.customDepthMaterial) collectMaterial(object.customDepthMaterial);
  });
  collectTexture(scene.background); collectTexture(scene.environment);
  renderer.domElement.style.visibility = 'hidden';
  try {
    scene.updateMatrixWorld(true); camera.updateMatrixWorld();
    for (const texture of textures) renderer.initTexture(texture);
    await renderer.compileAsync(scene, camera);
    renderer.setViewport(0, 0, 4, 4);
    renderer.render(scene, camera);
    await waitForGpu(renderer.getContext());
  } finally {
    for (const { object, visible, frustumCulled } of objects) {
      object.visible = visible; object.frustumCulled = frustumCulled;
    }
    renderer.setViewport(viewport);
    renderer.domElement.style.visibility = canvasVisibility;
  }
  renderer.render(scene, camera);
  await waitForGpu(renderer.getContext());
}
