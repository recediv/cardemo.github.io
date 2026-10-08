import * as THREE from '../vendor/three.module.js';

// Construction-only stubs. Pixel output requires a real browser.
export function canvasContext() {
  return new Proxy({}, {
    get: (target, key) => key in target ? target[key]
      : key === 'createLinearGradient' ? () => ({ addColorStop() {} })
      : key === 'measureText' ? () => ({ width: 0 }) : () => {},
  });
}

export function stubTextureLoader() {
  const original = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = function (_, onLoad) {
    const texture = new THREE.Texture({ width: 256, height: 256 });
    queueMicrotask(() => onLoad?.(texture));
    return texture;
  };
  return () => { THREE.TextureLoader.prototype.load = original; };
}

export function withCanvas(action) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const restoreLoader = stubTextureLoader();
  if (!globalThis.document) Object.defineProperty(globalThis, 'document', {
    configurable: true, value: {
      createElement() { return { width: 0, height: 0, getContext: canvasContext }; },
    },
  });
  try { return action(); }
  finally {
    restoreLoader();
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  }
}
