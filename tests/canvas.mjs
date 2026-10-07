// A minimal 2D canvas for constructing textures in Node. No pixels are rendered;
// this helper must not be used as evidence of visual correctness.
export function withCanvas(action) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  if (!globalThis.document) Object.defineProperty(globalThis, 'document', {
    configurable: true, value: {
      createElement() {
        return { width: 0, height: 0, getContext() {
          return { createLinearGradient: () => ({ addColorStop() {} }), fillRect() {} };
        } };
      },
    },
  });
  try { return action(); }
  finally {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  }
}
