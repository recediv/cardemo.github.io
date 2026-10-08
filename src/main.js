import * as THREE from '../vendor/three.module.js';
import { Physics } from './physics.js';
import { Vehicle } from './vehicle.js';
import { BestLapGhost } from './ghost.js';
import { UnderglowSystem } from './underglow.js';
import { Track } from './track.js';
import { World } from './world.js';
import { EnvironmentState, LapTimer, clamp, formatTime } from './simulation.js';
import { Soundscape } from './audio.js';
import { Input } from './input.js';
import { PerformanceMonitor } from './performance.js';
import { installStableShadowFilter } from './lighting.js';
import { TRACK_SCALE } from './scene-config.js';
import { prepareVegetationAssets } from './vegetation.js';
import { prepareRenderer } from './render-preparation.js';

const $ = id => document.getElementById(id);
let toastDeadline = 0;
function notify(message) { $('toast').textContent = message; $('toast').classList.add('visible'); toastDeadline = performance.now() + 3200; }
function clock(hour) { const minutes = Math.floor(hour * 60); return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; }

async function boot() {
  installStableShadowFilter();
  const renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.75, 520);
  const [Ammo] = await Promise.all([
    window.Ammo({ locateFile: filename => new URL(`../vendor/${filename}`, import.meta.url).href }),
    prepareVegetationAssets(),
  ]);
  const physics = new Physics(Ammo), track = new Track(scene);
  track.attachPhysics(physics);
  const world = new World(scene, physics, track);
  const environment = new EnvironmentState(), laps = new LapTimer(), sound = new Soundscape();
  const vehicle = new Vehicle(scene, physics, track, notify);
  const ghost = new BestLapGhost(scene, vehicle);
  const underglow = new UnderglowSystem(scene, vehicle, world);
  if (new URLSearchParams(location.search).has('inspect')) window.__DEMO__ = { renderer, scene, camera, physics, track, world, environment, vehicle, ghost, underglow };
  const monitor = new PerformanceMonitor(renderer, $('performance'));
  physics.onImpact = (strength, position) => sound.impact(strength, position, vehicle.item.position);
  let running = false, cameraIndex = 0, lowQuality = false, contextLost = false;
  let azimuth = 0.65, distance = 27, lastTimestamp = null, accumulator = 0, uiElapsed = 1;
  const target = vehicle.mesh.position.clone(), desired = new THREE.Vector3(), offset = new THREE.Vector3(), lookAt = new THREE.Vector3();
  const chaseForward = track.spawn.tangent.clone().setY(0).normalize(), heading = new THREE.Vector3();
  function cameraMode() {
    cameraIndex = (cameraIndex + 1) % 2;
    const name = ['Free', 'Rear'][cameraIndex];
    $('camera-button').setAttribute('aria-label', `Switch camera: ${name}`);
    $('camera-button').setAttribute('title', `Camera: ${name} · C`);
    updateCamera(1, true); notify(`Camera: ${name}`);
  }
  function reset() { vehicle.reset(); laps.reset(); ghost.reset(); accumulator = 0; target.copy(vehicle.item.position); updateCamera(1, true); }
  async function toggleSound() {
    try { if (sound.enabled) sound.mute(); else await sound.start(); }
    catch (error) { console.error('Could not enable sound:', error); notify('Could not enable sound'); }
    updateSoundButton();
  }
  function updateSoundButton() { $('sound-button').setAttribute('aria-pressed', String(sound.enabled)); $('sound-button').setAttribute('aria-label', sound.enabled ? 'Mute sound' : 'Enable sound'); }
  const input = new Input({ KeyR: reset, KeyC: cameraMode, KeyF: () => vehicle.flip(), KeyM: toggleSound });
  $('camera-button').addEventListener('click', cameraMode);
  $('reset-button').addEventListener('click', reset);
  $('flip-button').addEventListener('click', () => vehicle.flip());
  $('sound-button').addEventListener('click', toggleSound);
  $('settings-button').addEventListener('click', () => {
    $('settings').hidden = !$('settings').hidden;
    $('settings-button').setAttribute('aria-expanded', String(!$('settings').hidden));
  });
  $('hour').addEventListener('input', event => { environment.setTime(Number(event.target.value)); environment.autoTime = true; uiElapsed = 1; });
  for (const button of document.querySelectorAll('[data-hour]')) button.addEventListener('click', () => {
    environment.setTime(Number(button.dataset.hour)); environment.autoTime = true; $('hour').value = environment.hour; uiElapsed = 1;
  });
  $('rain-toggle').addEventListener('change', event => {
    environment.setWeather(event.target.checked ? 'rain' : 'auto');
    uiElapsed = 1;
  });
  $('volume').addEventListener('input', event => sound.setVolume(Number(event.target.value)));
  $('quality').addEventListener('change', event => {
    lowQuality = event.target.value === 'low'; world.setQuality(lowQuality);
    renderer.setPixelRatio(Math.min(devicePixelRatio, lowQuality ? 1 : 1.5));
    renderer.shadowMap.enabled = !lowQuality;
    scene.traverse(object => { if (object.material) for (const material of [].concat(object.material)) material.needsUpdate = true; });
    resize(); notify(lowQuality ? 'Low quality enabled' : 'Standard quality enabled');
  });
  for (const button of document.querySelectorAll('button')) button.addEventListener('click', () => button.blur());

  let dragging = null;
  renderer.domElement.addEventListener('pointerdown', event => { if (event.button === 0) { dragging = { id: event.pointerId, x: event.clientX }; renderer.domElement.setPointerCapture(event.pointerId); } });
  renderer.domElement.addEventListener('pointermove', event => { if (dragging?.id === event.pointerId && cameraIndex === 0) { azimuth -= (event.clientX - dragging.x) * 0.008; dragging.x = event.clientX; } });
  renderer.domElement.addEventListener('pointerup', () => dragging = null);
  renderer.domElement.addEventListener('pointercancel', () => dragging = null);
  renderer.domElement.addEventListener('wheel', event => {
    event.preventDefault();
    distance = clamp(distance + event.deltaY * 0.025, 12, 44);
  }, { passive: false });

  function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
  window.addEventListener('resize', resize); resize();
  function updateCamera(dt, snap = false) {
    const rearView = cameraIndex === 1;
    const amount = snap || rearView ? 1 : 1 - Math.exp(-5 * dt);
    target.lerp(vehicle.mesh.position, amount);
    const fit = Math.max(1, 0.8 / camera.aspect);
    if (rearView) {
      heading.set(0, 0, 1).applyQuaternion(vehicle.mesh.quaternion).setY(0);
      if (heading.lengthSq() > 0.01) chaseForward.copy(heading).normalize();
      offset.copy(chaseForward).multiplyScalar(-distance * fit);
      offset.y = distance * 0.77 * fit;
    } else {
      offset.set(Math.sin(azimuth) * distance * fit, distance * 0.77 * fit, Math.cos(azimuth) * distance * fit);
    }
    desired.copy(target).add(offset); lookAt.copy(target); lookAt.y += 0.5;
    // The rendered car is already interpolated; extra lag moves the rear view sideways in turns.
    camera.position.lerp(desired, snap || rearView ? 1 : 1 - Math.exp(-4 * dt)); camera.lookAt(lookAt);
    camera.userData.focus = lookAt;
  }
  updateCamera(1, true);

  const map = $('minimap'), mapContext = map.getContext('2d'), mapScale = 2.05 / TRACK_SCALE;
  const course = new Path2D();
  for (let i = 0; i <= 240; i++) { const p = track.point(i / 240).position; if (i === 0) course.moveTo(p.x, p.z); else course.lineTo(p.x, p.z); }
  function drawMap() {
    const ctx = mapContext; ctx.clearRect(0, 0, map.width, map.height); ctx.save(); ctx.translate(170, 110); ctx.scale(mapScale, mapScale);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#172b25'; ctx.lineWidth = track.width + 3; ctx.stroke(course);
    ctx.strokeStyle = '#648470'; ctx.lineWidth = track.width; ctx.stroke(course);
    ctx.strokeStyle = '#b9c7a777'; ctx.lineWidth = 0.5; ctx.setLineDash([2, 3]); ctx.stroke(course); ctx.setLineDash([]);
    const start = track.point(0); ctx.save(); ctx.translate(start.position.x, start.position.z); ctx.rotate(-start.yaw); ctx.fillStyle = '#eee9cd'; ctx.fillRect(-4, -0.6, 8, 1.2); ctx.restore();
    ctx.translate(vehicle.item.position.x, vehicle.item.position.z);
    ctx.rotate(Math.atan2(vehicle.forward.z, vehicle.forward.x)); ctx.fillStyle = '#e64c4a'; ctx.strokeStyle = '#20362c'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(3.8, 0); ctx.lineTo(-2.7, -2.6); ctx.lineTo(-1.5, 0); ctx.lineTo(-2.7, 2.6); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  function updateUI() {
    const kmh = Math.round(vehicle.speed * 3.6);
    $('speed').textContent = kmh; $('speed-meter').style.width = `${clamp(kmh / 160) * 100}%`;
    $('hour-output').textContent = clock(environment.hour); if (environment.autoTime) $('hour').value = environment.hour;
    $('rain-toggle').checked = environment.weatherMode === 'rain' || (environment.weatherMode === 'auto' && environment.weatherPhase === 'rain');
    $('lap').textContent = String(laps.lap).padStart(2, '0'); $('lap-time').textContent = formatTime(laps.time);
    $('best-time').textContent = laps.best === null ? '—' : formatTime(laps.best);
    $('surface-label').textContent = vehicle.surface.onRoad ? 'ASPHALT' : 'GRASS';
    $('recovery').hidden = vehicle.recovery.elapsed === 0;
    if (vehicle.recovery.elapsed > 0) $('recovery').textContent = `Recovery in ${vehicle.recovery.remaining.toFixed(1)} s`;
    drawMap();
  }
  let starting = false;
  async function start(withSound) {
    if (starting || running) return;
    starting = true;
    if (withSound) {
      $('loading-message').textContent = 'Preparing sound…';
      $('start-actions').hidden = true; $('loading-spinner').hidden = false;
      try { await sound.start(); } catch (error) { console.error('Could not enable sound:', error); notify('Could not enable sound'); }
    }
    updateSoundButton(); running = true; input.clear(); lastTimestamp = null; $('loading').hidden = true;
    notify('WASD / arrows to drive. Drag to rotate the camera');
  }
  $('start-sound').addEventListener('click', () => start(true)); $('start-quiet').addEventListener('click', () => start(false));
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); contextLost = true; input.clear(); sound.pause()?.catch(() => {}); notify('Graphics paused. Waiting for recovery'); });
  renderer.domElement.addEventListener('webglcontextrestored', () => { contextLost = false; monitor.restoreGpu(); lastTimestamp = null; accumulator = 0; if (!document.hidden) sound.resume()?.catch(() => {}); notify('Graphics restored'); });
  document.addEventListener('visibilitychange', () => {
    lastTimestamp = null; accumulator = 0; input.clear(); monitor.reset();
    if (document.hidden) sound.pause()?.catch(() => {}); else sound.resume()?.catch(() => {});
  });
  const fixedStep = 1 / 120;
  function frame(timestamp) {
    requestAnimationFrame(frame);
    if (document.hidden || contextLost || !running) return;
    const dt = lastTimestamp === null ? 0 : Math.min((timestamp - lastTimestamp) / 1000, 0.1); lastTimestamp = timestamp;
    monitor.beginFrame(timestamp);
    environment.step(dt);
    if (running) {
      accumulator += dt;
      while (accumulator >= fixedStep) {
        physics.beforeStep(); vehicle.preStep(fixedStep, input, environment); physics.step(fixedStep); vehicle.postStep(fixedStep);
        const completed = laps.step(vehicle.surface.progress, vehicle.surface.onRoad, vehicle.speed, fixedStep);
        const previousGhostTime = ghost.bestDuration;
        ghost.step(fixedStep, laps, completed);
        if (completed) {
          const improved = ghost.bestDuration !== previousGhostTime;
          notify(improved ? `Best lap ${formatTime(ghost.bestDuration)} — ghost updated` : `Lap ${formatTime(laps.lastLap)}. Best ghost kept`);
        }
        accumulator -= fixedStep;
      }
      physics.render(accumulator / fixedStep); vehicle.render(accumulator / fixedStep, environment);
      ghost.render(Math.max(0, laps.time - fixedStep + accumulator));
    } else { vehicle.render(1, environment); ghost.render(laps.time); }
    updateCamera(dt); world.update(dt, environment, camera, false, vehicle);
    underglow.update();
    sound.update(dt, environment, vehicle, input, world.inPuddle(vehicle.item.position, environment.wetness));
    uiElapsed += dt; if (uiElapsed > 0.075) { updateUI(); uiElapsed = 0; }
    if (timestamp > toastDeadline) $('toast').classList.remove('visible');
    renderer.render(scene, camera); monitor.endFrame();
  }
  $('loading-message').textContent = 'Preparing track…';
  vehicle.render(1, environment); world.update(0, environment, camera, false, vehicle);
  await prepareRenderer(renderer, scene, camera);
  $('loading-message').textContent = ''; $('loading-spinner').hidden = true; $('start-actions').hidden = false;
  requestAnimationFrame(frame);
}

boot().catch(error => {
  console.error(error);
  $('loading-spinner').hidden = true;
  $('loading-message').className = 'loading-error';
  $('loading-message').textContent = 'Could not load the track. Reload the page to try again.';
});
