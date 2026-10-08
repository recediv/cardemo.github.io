import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadAmmo } from './ammo-loader.mjs';
import * as THREE from '../vendor/three.module.js';
import { canvasContext, stubTextureLoader } from './canvas.mjs';

// Run the real entrypoint and real Bullet in a small DOM harness. The renderer
// and audio output are stubs: this checks wiring, not graphics or audibility.
test('App starts, drives and switches lights, exhaust, weather, audio and quality', async () => {
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
    getContext() { return canvasContext(); }
  }
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const elements = new Map();
  for (const match of html.matchAll(/<([a-z]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(match[2], match[1]); element.hidden = /\bhidden\b/.test(match[0]); element.checked = /\bchecked\b/.test(match[0]);
    element.width = Number(match[0].match(/\bwidth="(\d+)"/)?.[1] ?? 0); element.height = Number(match[0].match(/\bheight="(\d+)"/)?.[1] ?? 0);
    elements.set(match[2], element);
  }
  const metricElements = Object.fromEntries(['fps', 'frame', 'cpu', 'gpu'].map(name => [name, new Element(name)]));
  elements.get('performance').querySelector = selector => metricElements[selector.match(/"(.*?)"/)[1]];
  const buttons = [...elements.values()].filter(e => e.tagName === 'button');
  const presets = [...html.matchAll(/data-hour="([^"]+)"/g)].map(match => { const e = new Element('preset', 'button'); e.dataset.hour = match[1]; buttons.push(e); return e; });
  const touch = [...html.matchAll(/data-drive="([^"]+)"/g)].map(match => { const e = new Element('touch', 'button'); e.dataset.drive = match[1]; buttons.push(e); return e; });
  const windowStub = new Element('window'), documentStub = new Element('document');
  windowStub.innerHeight = 800; windowStub.devicePixelRatio = 1;
  documentStub.hidden = false; documentStub.getElementById = id => { assert.ok(elements.has(id), `Missing HTML element: ${id}`); return elements.get(id); };
  documentStub.querySelectorAll = selector => selector === '[data-drive]' ? touch : selector === '[data-hour]' ? presets : selector === 'button' ? buttons : [];
  documentStub.createElement = tagName => new Element('', tagName);
  const factory = await loadAmmo(); windowStub.Ammo = async () => factory;
  class Parameter { constructor() { this.value = 0; } setTargetAtTime(value) { this.value = value; } setValueAtTime(value) { this.value = value; } linearRampToValueAtTime(value) { this.value = value; } exponentialRampToValueAtTime(value) { this.value = value; } }
  class AudioNode { constructor() { for (const field of ['gain', 'frequency', 'Q', 'threshold', 'ratio', 'pan', 'playbackRate']) this[field] = new Parameter(); } connect() {} disconnect() {} start() {} stop() {} }
  let context;
  windowStub.AudioContext = class {
    constructor() { context = this; this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; }
    async resume() { this.state = 'running'; } async suspend() { this.state = 'suspended'; }
    createGain() { return new AudioNode(); } createBiquadFilter() { return new AudioNode(); } createOscillator() { return new AudioNode(); }
    createBufferSource() { return new AudioNode(); } createDynamicsCompressor() { return new AudioNode(); } createStereoPanner() { return new AudioNode(); }
    createBuffer(channels, length, sampleRate = this.sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: channel => data[channel] };
    }
    async decodeAudioData() { return this.createBuffer(2, this.sampleRate, this.sampleRate); }
  };
  let nextFrame, renderedScene, renderCount = 0;
  const gl = { getExtension: () => null, isContextLost: () => false, fenceSync: () => null };
  class Renderer {
    constructor({ canvas }) { this.domElement = canvas; this.shadowMap = {}; this.viewport = new THREE.Vector4(); }
    setPixelRatio(value) { this.pixelRatio = value; }
    setSize(width, height) { this.domElement.width = width; this.domElement.height = height; }
    getContext() { return gl; }
    getViewport(target) { return target.copy(this.viewport); }
    setViewport(x, y, width, height) { if (x.isVector4) this.viewport.copy(x); else this.viewport.set(x, y, width, height); }
    initTexture() {} async compileAsync() {}
    render(scene) { renderedScene = scene; renderCount++; }
  }
  let firstFrame; const ready = new Promise(resolve => firstFrame = resolve);
  const globals = { window: windowStub, document: documentStub, location: { search: '?inspect' }, HTMLElement: Element, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, Path2D: class { moveTo() {} lineTo() {} }, __demoRenderer: Renderer, requestAnimationFrame: callback => { nextFrame = callback; firstFrame(); }, fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }) };
  const original = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const restoreLoader = stubTextureLoader();
  let startupTimer;
  try {
    let source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
    source = source.replace(/from '([^']+)'/g, (_, specifier) => `from '${new URL(specifier, new URL('../src/main.js', import.meta.url)).href}'`);
    source = source.replace('new THREE.WebGLRenderer(', 'new globalThis.__demoRenderer(');
    source = source.replaceAll('import.meta.url', JSON.stringify(new URL('../src/main.js', import.meta.url).href));
    await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    await Promise.race([ready, new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error(elements.get('loading-message').textContent || 'App did not start')), 3000); })]);
    clearTimeout(startupTimer);
    const game = windowStub.__DEMO__;
    assert.equal(elements.get('start-actions').hidden, false);
    await elements.get('start-sound').emit('click'); assert.equal(elements.get('loading').hidden, true); assert.equal(context.state, 'running');
    await windowStub.emit('keydown', { code: 'KeyW', repeat: false });
    for (let i = 0; i < 181; i++) nextFrame(i * 1000 / 60);
    assert.ok(Number(elements.get('speed').textContent) > 10); assert.ok(renderCount > 170);
    await windowStub.emit('keyup', { code: 'KeyW' });
    assert.ok(game.environment.hour > 14, 'Automatic time advances while driving');
    await presets.find(e => e.dataset.hour === '0').emit('click'); game.environment.autoTime = false; nextFrame(3200);
    assert.equal(game.environment.hour, 0);
    elements.get('rain-toggle').checked = true; await elements.get('rain-toggle').emit('change');
    for (let i = 1; i <= 300; i++) nextFrame(3200 + i * 100);
    assert.ok(game.environment.rain > 0.99); assert.ok(game.environment.wetness > 0.9);
    assert.ok(game.world.rainLines.visible); assert.ok(game.world.puddles.every(puddle => puddle.mesh.visible));
    const headlights = []; renderedScene.traverse(object => { if (object.isSpotLight) headlights.push(object); }); assert.ok(headlights.every(light => light.intensity > 80));
    await elements.get('sound-button').emit('click'); assert.equal(elements.get('sound-button').attributes['aria-pressed'], 'false');
    await elements.get('sound-button').emit('click'); assert.equal(elements.get('sound-button').attributes['aria-pressed'], 'true');
    elements.get('rain-toggle').checked = false; await elements.get('rain-toggle').emit('change');
    assert.equal(game.environment.weatherMode, 'auto');
    elements.get('quality').value = 'low'; await elements.get('quality').emit('change'); nextFrame(33200);
    assert.equal(elements.get('toast').textContent, 'Low quality enabled');
    await elements.get('settings-button').emit('click'); assert.equal(elements.get('settings').hidden, false);
    documentStub.hidden = true; await documentStub.emit('visibilitychange'); assert.equal(context.state, 'suspended');
    documentStub.hidden = false; await documentStub.emit('visibilitychange'); assert.equal(context.state, 'running');
    await elements.get('reset-button').emit('click'); nextFrame(33400); assert.equal(elements.get('lap').textContent, '01');
    let lightTimestamp = 33400;
    const advanceLights = (frames = 1) => { for (let i = 0; i < frames; i++) nextFrame(lightTimestamp += 1000 / 60); };
    const lightMode = elements.get('light-mode'), system = game.vehicle.headlightSystem;
    let flips = 0; const originalFlip = game.vehicle.flip;
    game.vehicle.flip = function () { flips++; return originalFlip.call(this); };
    assert.equal(lightMode.value, 'auto');
    await windowStub.emit('keydown', { code: 'KeyF', repeat: false }); advanceLights();
    assert.equal(flips, 0); assert.equal(lightMode.value, 'off');
    assert.ok(headlights.every(light => light.intensity === 0));
    assert.equal(system.dust.visible, false); assert.ok(system.volumes.every(v => !v.mesh.visible));
    assert.equal(game.vehicle.mesh.userData.underglowMesh.visible, false); assert.equal(game.underglow.glow.visible, false);
    await windowStub.emit('keydown', { code: 'KeyF', repeat: true }); advanceLights();
    assert.equal(lightMode.value, 'off', 'Holding F must not keep toggling the lights');
    await windowStub.emit('keyup', { code: 'KeyF' });
    await windowStub.emit('keydown', { code: 'KeyF', repeat: false }); advanceLights(120);
    await windowStub.emit('keyup', { code: 'KeyF' });
    assert.equal(lightMode.value, 'on'); assert.ok(headlights.every(light => light.intensity > 200));
    assert.equal(game.vehicle.mesh.userData.underglowMesh.visible, true); assert.equal(game.underglow.glow.visible, true);
    await presets.find(e => e.dataset.hour === '14').emit('click'); game.environment.autoTime = false; advanceLights(30);
    assert.ok(headlights.every(light => light.intensity > 200), 'Manual On must survive the transition to daylight');
    await windowStub.emit('keydown', { code: 'KeyF', repeat: false }); advanceLights(120);
    await windowStub.emit('keyup', { code: 'KeyF' });
    assert.equal(lightMode.value, 'off'); assert.ok(system.opening < 0.001);
    assert.ok(headlights.every(light => light.intensity === 0));
    lightMode.value = 'on'; await lightMode.emit('change'); advanceLights(120);
    assert.ok(headlights.every(light => light.intensity > 200));
    lightMode.value = 'auto'; await lightMode.emit('change'); advanceLights(120);
    assert.ok(headlights.every(light => light.intensity === 0));
    await presets.find(e => e.dataset.hour === '0').emit('click'); game.environment.autoTime = false; advanceLights(120);
    assert.ok(headlights.every(light => light.intensity > 200), 'Auto must follow darkness again');
    assert.equal(game.exhaust.smoke.visible, true); assert.equal(game.exhaust.outlets.length, 1);
    const shots = game.exhaust.shots;
    await windowStub.emit('keydown', { code: 'ShiftLeft', repeat: false }); advanceLights(60);
    assert.equal(game.exhaust.shots, shots, 'A short boost must not immediately backfire');
    let sawFlame = false, sawFlash = false;
    for (let i = 0; i < 360; i++) {
      advanceLights(); sawFlame ||= game.exhaust.flames.some(flame => flame.visible);
      sawFlash ||= game.exhaust.flash.intensity > 0;
    }
    assert.ok(game.exhaust.shots > shots && game.exhaust.shots <= shots + 3);
    assert.ok(sawFlame && sawFlash); assert.equal(game.exhaust.flash.castShadow, false);
    await windowStub.emit('keyup', { code: 'ShiftLeft' });
    await elements.get('reset-button').emit('click'); advanceLights();
    assert.equal(game.exhaust.flash.intensity, 0); assert.ok(game.exhaust.flames.every(flame => !flame.visible));
    assert.ok(game.exhaust.particles.every(particle => particle.life === 0));
    await windowStub.emit('keydown', { code: 'KeyQ', repeat: false });
    await windowStub.emit('keyup', { code: 'KeyQ' });
    assert.equal(flips, 1, 'Q must trigger the manual flip action');
  } finally {
    clearTimeout(startupTimer); restoreLoader();
    for (const [key, descriptor] of Object.entries(original)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
