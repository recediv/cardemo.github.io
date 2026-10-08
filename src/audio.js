import { clamp } from './simulation.js';

// These gears affect sound only. Fixed thresholds and separate downshift
// points keep the engine from hunting between gears at a steady speed.
const ENGINE_UPSHIFTS = [6, 10.5, 16, 22.5, 30, Infinity];
const ENGINE_DOWNSHIFTS = [0, 4.5, 8, 12.5, 18, 24];
const ENGINE_RPM_PER_SPEED = [820, 470, 310, 220, 165, 130];
const ENGINE_IDLE_RPM = 1000, ENGINE_SHIFT_DURATION = 0.26;

// Local synthesis plus bundled CC0 recordings for night insects and tire skids.
export class Soundscape {
  constructor() {
    this.context = null; this.enabled = false; this.volume = 0.45; this.birdClock = 0; this.voices = 0;
    this.engineGear = 0; this.engineDirection = 1; this.enginePrimed = false;
    this.engineRpm = ENGINE_IDLE_RPM; this.engineShiftRemaining = 0; this.engineShiftCooldown = 0;
    this.exhaustShots = 0;
  }
  async start() {
    if (!this.context) this.create();
    await this.context.resume();
    // Finish decoding and loop preparation before the race starts.
    await Promise.all([this.loadCrickets(), this.loadLoop('skid', 'tires-squeak.mp3', this.skidGain)]);
    this.enginePrimed = false;
    this.enabled = true;
    this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.08);
  }
  create() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('This browser does not support Web Audio');
    const c = this.context = new AudioContext();
    this.master = c.createGain(); this.master.gain.value = 0;
    const limiter = c.createDynamicsCompressor(); limiter.threshold.value = -15; limiter.ratio.value = 5;
    this.master.connect(limiter); limiter.connect(c.destination);
    const noise = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = noise;
    this.backfireBuffer = this.createBackfireBuffer();
    this.engine = c.createOscillator(); this.engine.type = 'sawtooth'; this.engine.frequency.value = 32;
    this.engineFilter = c.createBiquadFilter(); this.engineFilter.type = 'lowpass'; this.engineFilter.frequency.value = 220; this.engineFilter.Q.value = 0.65;
    this.engineGain = c.createGain(); this.engineGain.gain.value = 0;
    this.engine.connect(this.engineFilter); this.engineFilter.connect(this.engineGain); this.engineGain.connect(this.master); this.engine.start();
    // A quiet, permanent lower voice gives the engine some body without
    // creating oscillators or sample buffers when a gear changes.
    this.engineBody = c.createOscillator(); this.engineBody.type = 'triangle'; this.engineBody.frequency.value = 16;
    this.engineBodyGain = c.createGain(); this.engineBodyGain.gain.value = 0.18;
    this.engineBody.connect(this.engineBodyGain); this.engineBodyGain.connect(this.engineFilter); this.engineBody.start();
    const hornFilter = c.createBiquadFilter(); hornFilter.type = 'lowpass'; hornFilter.frequency.value = 1400;
    this.hornGain = c.createGain(); this.hornGain.gain.value = 0;
    hornFilter.connect(this.hornGain); this.hornGain.connect(this.master);
    // Two tones give the horn its familiar car sound. A smooth gain envelope
    // starts and stops it while E is held, without creating voices on key repeat.
    for (const frequency of [350, 440]) {
      const oscillator = c.createOscillator(); oscillator.type = 'sawtooth'; oscillator.frequency.value = frequency;
      oscillator.connect(hornFilter); oscillator.start();
    }
    this.rain = this.noiseLoop('lowpass', 1600, this.weatherNoise('rain'), 160, 0.55);
    this.wind = this.noiseLoop('lowpass', 900, this.weatherNoise('wind'), 50, 0.6);
    this.tires = this.noiseLoop('bandpass', 850);
    this.skidGain = c.createGain(); this.skidGain.gain.value = 0; this.skidGain.connect(this.master);
    this.splash = this.noiseLoop('lowpass', 1500);
    this.createCrickets();
  }
  createCrickets() {
    const c = this.context;
    this.cricketGain = c.createGain(); this.cricketGain.gain.value = 0; this.cricketGain.connect(this.master);
  }
  loadCrickets() {
    return this.loadLoop('cricket', 'crickets-night.mp3', this.cricketGain);
  }
  loadLoop(name, file, gain) {
    const sourceKey = `${name}Source`, loadingKey = `${name}Loading`;
    if (this[sourceKey] || this[loadingKey]) return this[loadingKey];
    // Load after the user requests sound; reuse the decoded loop after muting.
    this[loadingKey] = (async () => {
      const response = await fetch(new URL(`./audio/${file}`, import.meta.url));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      let buffer = await this.context.decodeAudioData(await response.arrayBuffer());
      if (name === 'skid') buffer = this.crossfadeLoop(buffer);
      const source = this.context.createBufferSource();
      source.buffer = buffer; source.loop = true;
      source.connect(gain);
      source.start(0, Math.random() * buffer.duration);
      this[sourceKey] = source;
    })().catch(error => {
      this[loadingKey] = null;
      console.warn(`Could not load audio ${file}:`, error);
    });
    return this[loadingKey];
  }
  crossfadeLoop(buffer) {
    const overlap = Math.min(Math.ceil(buffer.sampleRate * 0.065), Math.floor(buffer.length / 4));
    const length = buffer.length - overlap, loop = this.context.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const original = buffer.getChannelData(channel), samples = loop.getChannelData(channel);
      samples.set(original.subarray(overlap));
      for (let i = 0; i < overlap; i++) {
        const amount = i / Math.max(1, overlap - 1), index = length - overlap + i;
        samples[index] = samples[index] * (1 - amount) + original[i] * amount;
      }
    }
    return loop;
  }
  weatherNoise(kind) {
    const c = this.context, duration = 8, rate = c.sampleRate, length = Math.ceil(rate * duration);
    const buffer = c.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel++) {
      const samples = buffer.getChannelData(channel); let slow = 0, fast = 0, mean = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        slow = slow * 0.985 + white * 0.025; fast = fast * 0.85 + white * 0.15;
        samples[i] = kind === 'rain' ? (slow * 0.55 + fast * 0.3 + white * 0.1) * 2 : (slow * 0.65 + fast * 0.2 + white * 0.03) * 2;
        mean += samples[i];
      }
      mean /= length;
      for (let i = 0; i < length; i++) samples[i] -= mean;
      if (kind === 'rain') {
        // Soft, irregular close drops sit over a broad stereo rain bed.
        for (let drop = 0; drop < duration * 60; drop++) {
          const start = Math.floor(Math.random() * (length - rate * 0.05)), count = Math.floor(rate * (0.008 + Math.random() * 0.025));
          const level = 0.04 + Math.random() * 0.08;
          for (let i = 0; i < count; i++) {
            const envelope = Math.sin(Math.PI * i / count) ** 2;
            samples[start + i] += (Math.random() * 2 - 1) * level * envelope;
          }
        }
      }
      // A short taper prevents clicks at the loop boundary.
      const fade = Math.ceil(rate * 0.012);
      for (let i = 0; i < fade; i++) { const amount = Math.sin(i / fade * Math.PI / 2) ** 2; samples[i] *= amount; samples[length - 1 - i] *= amount; }
    }
    return buffer;
  }
  noiseLoop(type, frequency, buffer = this.noise, lowCut = 0, damping = 1) {
    const c = this.context, source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain();
    source.buffer = buffer; source.loop = true; filter.type = type; filter.frequency.value = frequency; filter.Q.value = damping; gain.gain.value = 0;
    if (lowCut) {
      const cut = c.createBiquadFilter(); cut.type = 'highpass'; cut.frequency.value = lowCut; cut.Q.value = 0.5;
      source.connect(cut); cut.connect(filter);
    } else source.connect(filter);
    filter.connect(gain); gain.connect(this.master); source.start(0, Math.random() * (buffer.duration ?? 3));
    return gain;
  }
  mute() {
    this.enabled = false;
    if (this.context) {
      this.hornGain.gain.setValueAtTime(0, this.context.currentTime);
      this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.06);
    }
  }
  setVolume(value) {
    this.volume = clamp(value);
    if (this.context && this.enabled) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.06);
  }
  pause() {
    if (this.context?.state === 'running') {
      this.hornGain.gain.setValueAtTime(0, this.context.currentTime);
      return this.context.suspend();
    }
  }
  resume() { if (this.context && this.enabled) return this.context.resume(); }
  createBackfireBuffer() {
    const c = this.context, length = Math.ceil(c.sampleRate * 0.16), buffer = c.createBuffer(1, length, c.sampleRate);
    const samples = buffer.getChannelData(0); let noise = 0, phase = 0;
    for (let i = 0; i < length; i++) {
      const time = i / c.sampleRate;
      noise = noise * 0.82 + (Math.random() * 2 - 1) * 0.18;
      phase += Math.PI * 2 * (65 + 110 * Math.exp(-time * 18)) / c.sampleRate;
      const envelope = (1 - Math.exp(-time * 800)) * Math.exp(-time * 37) * clamp((0.16 - time) / 0.015);
      samples[i] = (Math.sin(phase) * 0.65 + noise * 0.7) * envelope;
    }
    return buffer;
  }
  exhaustPop(power) {
    const c = this.context;
    if (!c || !this.enabled || c.state !== 'running' || this.voices >= 5) return;
    const source = c.createBufferSource(), gain = c.createGain();
    source.buffer = this.backfireBuffer; source.playbackRate.value = 0.91 + Math.random() * 0.12;
    gain.gain.value = 0.24 + clamp(power) * 0.12;
    source.connect(gain); gain.connect(this.master); this.voices++; source.start();
    source.onended = () => { this.voices--; source.disconnect(); gain.disconnect(); };
  }
  updateEngine(dt, time, elapsed, speed, signedThrottle, boost, input) {
    const step = clamp(dt, 0, 0.1), throttle = clamp(Math.abs(signedThrottle));
    const requestedDirection = input.backward && !input.forward ? -1 : input.forward && !input.backward ? 1
      : signedThrottle < -0.08 ? -1 : signedThrottle > 0.08 ? 1 : this.engineDirection;
    if (!this.enginePrimed) {
      this.engineDirection = requestedDirection; this.engineGear = 0;
      if (this.engineDirection > 0) {
        while (this.engineGear < ENGINE_UPSHIFTS.length - 1 && speed >= ENGINE_UPSHIFTS[this.engineGear]) this.engineGear++;
      }
      this.engineRpm = ENGINE_IDLE_RPM + speed * (this.engineDirection < 0 ? 430 : ENGINE_RPM_PER_SPEED[this.engineGear]);
      this.engineShiftRemaining = this.engineShiftCooldown = 0; this.enginePrimed = true;
    }
    this.engineShiftRemaining = Math.max(0, this.engineShiftRemaining - step);
    this.engineShiftCooldown = Math.max(0, this.engineShiftCooldown - step);
    // Requesting reverse first brakes the real car. Keep its current sound
    // direction until it is nearly stopped, including coasting with no input.
    if (speed < 0.7) {
      this.engineDirection = requestedDirection; this.engineGear = 0;
      this.engineShiftRemaining = this.engineShiftCooldown = 0;
    } else if (this.engineDirection > 0 && this.engineShiftCooldown === 0) {
      const previousGear = this.engineGear;
      if (this.engineGear < ENGINE_UPSHIFTS.length - 1 && speed >= ENGINE_UPSHIFTS[this.engineGear]) this.engineGear++;
      else if (this.engineGear > 0 && speed <= ENGINE_DOWNSHIFTS[this.engineGear]) this.engineGear--;
      if (this.engineGear !== previousGear) {
        this.engineShiftRemaining = ENGINE_SHIFT_DURATION;
        this.engineShiftCooldown = 0.48;
      }
    }
    const shiftAge = ENGINE_SHIFT_DURATION - this.engineShiftRemaining;
    const clutchCut = this.engineShiftRemaining > 0 ? clamp(shiftAge / 0.035) * clamp(this.engineShiftRemaining / 0.15) : 0;
    const load = signedThrottle * this.engineDirection > 0 ? throttle : 0;
    const ratio = this.engineDirection < 0 ? 430 : ENGINE_RPM_PER_SPEED[this.engineGear];
    const stationaryRev = (1 - clamp(speed / 2)) * Math.max(load, boost * 0.75) * (2800 + boost * 2200);
    const targetRpm = clamp((ENGINE_IDLE_RPM + speed * ratio + load * 300 + boost * (250 + load * 250) + stationaryRev)
      * (1 - clutchCut * 0.13), ENGINE_IDLE_RPM, this.engineDirection < 0 ? 6200 : 7200);
    this.engineRpm += (targetRpm - this.engineRpm) * (1 - Math.exp(-(this.engineShiftRemaining > 0 ? 22 : 9) * step));
    const revAmount = clamp((this.engineRpm - ENGINE_IDLE_RPM) / 6200);
    const frequency = this.engineRpm / 34 + Math.sin(elapsed * 19) * (1 - revAmount) * 0.45;
    this.engine.frequency.setTargetAtTime(frequency, time, 0.025);
    this.engineBody.frequency.setTargetAtTime(frequency * 0.5, time, 0.03);
    this.engineFilter.frequency.setTargetAtTime((220 + revAmount * 450 + load * 150 + boost * 230)
      * (1 - clutchCut * 0.35), time, 0.04);
    this.engineGain.gain.setTargetAtTime((0.065 + load * 0.042 + clamp(speed / 25) * 0.028 + boost * 0.045)
      * (1 - clutchCut * 0.67), time, clutchCut > 0 ? 0.018 : 0.055);
  }
  update(dt, environment, vehicle, input, inPuddle, exhaust = null) {
    const shots = exhaust?.shots ?? 0, fired = shots !== this.exhaustShots; this.exhaustShots = shots;
    const c = this.context;
    if (!c || !this.enabled || c.state !== 'running') return;
    if (fired && shots > 0) this.exhaustPop(exhaust.lastShotPower);
    const t = c.currentTime, speed = vehicle.speed, signedThrottle = vehicle.throttle ?? Number(input.forward) - Number(input.backward), boost = Number(input.boost);
    this.hornGain.gain.setTargetAtTime(input.horn ? 0.13 : 0, t, input.horn ? 0.012 : 0.025);
    this.updateEngine(dt, t, environment.elapsed, speed, signedThrottle, boost, input);
    this.rain.gain.setTargetAtTime(environment.rain * 0.34, t, 0.4);
    const windBreath = 0.85 + Math.sin(environment.elapsed * 0.43) * 0.1 + Math.sin(environment.elapsed * 0.17) * 0.05;
    this.wind.gain.setTargetAtTime(environment.windStrength * windBreath * 0.28 + speed * 0.0012, t, 0.45);
    const skid = speed > 2.5 && vehicle.surface.onRoad ? (input.brake ? clamp((speed - 2.5) / 7) * 0.2 : Math.abs(vehicle.steer) * clamp(speed / 18) * 0.06) : 0;
    this.skidGain.gain.setTargetAtTime(skid * (1 - environment.wetness * 0.4), t, 0.055);
    this.skidSource?.playbackRate.setTargetAtTime(0.88 + clamp(speed / 28) * 0.24, t, 0.12);
    this.tires.gain.setTargetAtTime(!vehicle.surface.onRoad ? clamp(speed / 14) * 0.06 : 0, t, 0.07);
    this.splash.gain.setTargetAtTime(inPuddle ? clamp(speed / 12) * 0.18 : 0, t, 0.05);
    const night = 1 - environment.daylight;
    this.cricketGain.gain.setTargetAtTime(night * (1 - environment.rain * 0.85) * 0.12, t, 0.3);
    this.birdClock -= dt;
    if (this.birdClock <= 0) {
      this.birdClock = 2.5 + Math.random() * 4;
      if (environment.daylight > 0.55 && environment.rain < 0.35) this.bird();
    }
  }
  bird() {
    const c = this.context, t = c.currentTime, oscillator = c.createOscillator(), gain = c.createGain(), pan = c.createStereoPanner();
    oscillator.frequency.setValueAtTime(1800 + Math.random() * 900, t);
    oscillator.frequency.exponentialRampToValueAtTime(3400, t + 0.09);
    oscillator.frequency.exponentialRampToValueAtTime(1800, t + 0.22);
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.045, t + 0.025); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    pan.pan.value = Math.random() * 1.6 - 0.8;
    oscillator.connect(gain); gain.connect(pan); pan.connect(this.master); oscillator.start(t); oscillator.stop(t + 0.26);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); pan.disconnect(); };
  }
  impact(strength, position, listenerPosition) {
    const c = this.context;
    if (!c || !this.enabled || c.state !== 'running' || this.voices >= 5) return;
    const distance = Math.hypot(position.x - listenerPosition.x, position.z - listenerPosition.z);
    const loudness = strength / (1 + distance * 0.2);
    if (loudness < 0.03) return;
    this.voices++;
    const t = c.currentTime, source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain();
    const thump = c.createOscillator(), thumpGain = c.createGain();
    source.buffer = this.noise; filter.type = 'lowpass'; filter.frequency.value = 350 + strength * 450; filter.Q.value = 0.5;
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(loudness * 0.26, t + 0.003); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    thump.type = 'triangle'; thump.frequency.setValueAtTime(110 + strength * 80, t); thump.frequency.exponentialRampToValueAtTime(45 + strength * 15, t + 0.16);
    thumpGain.gain.setValueAtTime(0, t); thumpGain.gain.linearRampToValueAtTime(loudness * 0.22, t + 0.004); thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start(t); source.stop(t + 0.14);
    thump.connect(thumpGain); thumpGain.connect(this.master); thump.start(t); thump.stop(t + 0.24);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    thump.onended = () => { this.voices--; thump.disconnect(); thumpGain.disconnect(); };
  }
}
