import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadAmmo } from './ammo-loader.mjs';

// Run the real entrypoint and real Bullet in a small DOM harness. The renderer
// and audio output are stubs: this checks wiring, not graphics or audibility.
test('App starts, drives, changes weather/time, toggles audio and switches quality', async () => {
  class Element {
    constructor(id, tagName = 'div') {
      this.id = id; this.tagName = tagName; this.hidden = false; this.checked = false; this.value = ''; this.textContent = '';
      this.dataset = {}; this.style = {}; this.listeners = {}; this.attributes = {}; this.classes = new Set();
      this.classList = { add: value => this.classes.add(value), remove: value => this.classes.delete(value) };
    }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    async emit(type, extra = {}) { for (const fn of this.listeners[type] ?? []) await fn({ target: this, currentTarget: this, preventDefault() {}, ...extra }); }
    matches(selector) { return selector.split(',').map(s => s.trim()).includes(this.tagName); }
    setAttribute(name, value) { this.attributes[name] = value; }
    blur() {} setPointerCapture() {}
    getContext() { return new Proxy({}, { get: (_, key) => key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : key === 'measureText' ? () => ({ width: 0 }) : () => {} }); }
  }
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const elements = new Map();
  for (const match of html.matchAll(/<([a-z]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(match[2], match[1]); element.hidden = /\bhidden\b/.test(match[0]); element.checked = /\bchecked\b/.test(match[0]);
    elements.set(match[2], element);
  }
  const metricElements = Object.fromEntries(['fps', 'frame', 'cpu', 'gpu'].map(name => [name, new Element(name)]));
  elements.get('performance').querySelector = selector => metricElements[selector.match(/"(.*?)"/)[1]];
  const buttons = [...elements.values()].filter(e => e.tagName === 'button');
  const presets = [...html.matchAll(/data-hour="([^"]+)"/g)].map(match => { const e = new Element('preset', 'button'); e.dataset.hour = match[1]; buttons.push(e); return e; });
  const touch = [...html.matchAll(/data-drive="([^"]+)"/g)].map(match => { const e = new Element('touch', 'button'); e.dataset.drive = match[1]; buttons.push(e); return e; });
  const windowStub = new Element('window'), documentStub = new Element('document');
  documentStub.hidden = false; documentStub.getElementById = id => { assert.ok(elements.has(id), `Missing HTML element: ${id}`); return elements.get(id); };
  documentStub.querySelectorAll = selector => selector === '[data-drive]' ? touch : selector === '[data-hour]' ? presets : selector === 'button' ? buttons : [];
  documentStub.createElement = tagName => new Element('', tagName);
  const factory = await loadAmmo(); windowStub.Ammo = async () => factory;
  class Parameter { constructor() { this.value = 0; } setTargetAtTime(value) { this.value = value; } setValueAtTime(value) { this.value = value; } linearRampToValueAtTime(value) { this.value = value; } exponentialRampToValueAtTime(value) { this.value = value; } }
  class AudioNode { constructor() { for (const field of ['gain', 'frequency', 'Q', 'threshold', 'ratio', 'pan']) this[field] = new Parameter(); } connect() {} disconnect() {} start() {} stop() {} }
  let context;
  windowStub.AudioContext = class {
    constructor() { context = this; this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; }
    async resume() { this.state = 'running'; } async suspend() { this.state = 'suspended'; }
    createGain() { return new AudioNode(); } createBiquadFilter() { return new AudioNode(); } createOscillator() { return new AudioNode(); }
    createBufferSource() { return new AudioNode(); } createDynamicsCompressor() { return new AudioNode(); } createStereoPanner() { return new AudioNode(); }
    createBuffer(_, length) { return { getChannelData: () => new Float32Array(length) }; }
  };
  let nextFrame, renderedScene, renderCount = 0;
  const gl = { getExtension: () => null, isContextLost: () => false };
  class Renderer {
    constructor({ canvas }) { this.domElement = canvas; this.shadowMap = {}; }
    setPixelRatio(value) { this.pixelRatio = value; } setSize() {} getContext() { return gl; }
    render(scene) { renderedScene = scene; renderCount++; }
  }
  let firstFrame; const ready = new Promise(resolve => firstFrame = resolve);
  const globals = { window: windowStub, document: documentStub, location: { search: '' }, HTMLElement: Element, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, Path2D: class { moveTo() {} lineTo() {} }, __demoRenderer: Renderer, requestAnimationFrame: callback => { nextFrame = callback; firstFrame(); } };
  const original = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  try {
    let source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
    source = source.replace(/from '([^']+)'/g, (_, specifier) => `from '${new URL(specifier, new URL('../src/main.js', import.meta.url)).href}'`);
    source = source.replace('new THREE.WebGLRenderer(', 'new globalThis.__demoRenderer(');
    source = source.replaceAll('import.meta.url', JSON.stringify(new URL('../src/main.js', import.meta.url).href));
    await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    await Promise.race([ready, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(elements.get('loading-message').textContent || 'App did not start')), 3000); timer.unref(); })]);
    assert.equal(elements.get('start-actions').hidden, false);
    await elements.get('start-sound').emit('click'); assert.equal(elements.get('loading').hidden, true); assert.equal(context.state, 'running');
    await windowStub.emit('keydown', { code: 'KeyW', repeat: false });
    for (let i = 0; i < 181; i++) nextFrame(i * 1000 / 60);
    assert.ok(Number(elements.get('speed').textContent) > 10); assert.ok(renderCount > 170);
    await windowStub.emit('keyup', { code: 'KeyW' });
    const previousHour = elements.get('clock').textContent;
    elements.get('day-duration').value = '45'; await elements.get('day-duration').emit('change'); nextFrame(3100);
    assert.notEqual(elements.get('clock').textContent, previousHour);
    await presets.find(e => e.dataset.hour === '0').emit('click'); nextFrame(3200);
    assert.equal(elements.get('phase').textContent, 'Night');
    elements.get('weather').value = 'rain'; await elements.get('weather').emit('change');
    for (let i = 1; i <= 300; i++) nextFrame(3200 + i * 100);
    assert.equal(elements.get('weather-label').textContent, 'Rain'); assert.equal(elements.get('wet-label').textContent, 'Wet');
    const headlights = []; renderedScene.traverse(object => { if (object.isSpotLight) headlights.push(object); }); assert.ok(headlights.every(light => light.intensity > 80));
    await elements.get('sound-button').emit('click'); assert.equal(elements.get('sound-button').attributes['aria-pressed'], 'false');
    await elements.get('sound-button').emit('click'); assert.equal(elements.get('sound-button').attributes['aria-pressed'], 'true');
    elements.get('quality').value = 'low'; await elements.get('quality').emit('change'); nextFrame(33200);
    assert.equal(elements.get('toast').textContent, 'Low quality enabled');
    await elements.get('settings-button').emit('click'); assert.equal(elements.get('settings').hidden, false);
    documentStub.hidden = true; await documentStub.emit('visibilitychange'); assert.equal(context.state, 'suspended');
    documentStub.hidden = false; await documentStub.emit('visibilitychange'); assert.equal(context.state, 'running');
    await elements.get('reset-button').emit('click'); nextFrame(33400); assert.equal(elements.get('lap').textContent, '01');
  } finally {
    for (const [key, descriptor] of Object.entries(original)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
