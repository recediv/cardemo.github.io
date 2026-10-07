// Independent of rendering: all rates use seconds, never frame counts.
export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const damp = (current, target, rate, dt) => target + (current - target) * Math.exp(-rate * dt);
export const smoothstep = (min, max, value) => { const t = clamp((value - min) / (max - min)); return t * t * (3 - 2 * t); };
export const DEFAULT_WIND = 0.85;

export class EnvironmentState {
  constructor() {
    this.hour = 14;
    this.visualHour = this.hour;
    this.autoTime = true;
    this.dayDuration = 45;
    this.weatherMode = 'auto';
    this.weatherClock = 0;
    this.weatherPhase = 'clear';
    this.clearDuration = this.nextClearDuration();
    this.rainDuration = 18;
    this.dryBreak = 25;
    this.dryClock = 0;
    this.rain = 0;
    this.wetness = 0;
    this.wind = DEFAULT_WIND;
    this.elapsed = 0;
  }
  nextClearDuration() { return 135 + Math.random() * 135; }
  setTime(hour) { this.hour = ((hour % 24) + 24) % 24; this.autoTime = false; }
  setWeather(mode) {
    if (!['auto', 'clear', 'rain'].includes(mode)) return;
    if (mode === 'auto') { this.weatherPhase = 'clear'; this.weatherClock = 0; this.clearDuration = this.nextClearDuration(); }
    this.weatherMode = mode;
  }
  get daylight() { return smoothstep(-0.18, 0.35, Math.sin((this.visualHour - 6) / 24 * Math.PI * 2)); }
  get windStrength() { return clamp(this.wind * (0.8 + Math.sin(this.elapsed * 0.7) * 0.16 + Math.sin(this.elapsed * 0.19) * 0.12) + this.rain * this.wind * 0.35); }
  get phase() { return this.hour < 5 || this.hour >= 21 ? 'Night' : this.hour < 10 ? 'Morning' : this.hour < 17 ? 'Day' : 'Evening'; }
  get weatherLabel() { return this.rain > 0.2 ? 'Rain' : this.wetness > 0.15 ? 'After rain' : 'Clear'; }
  step(dt) {
    this.elapsed += dt;
    if (this.autoTime) this.hour = (this.hour + dt * 24 / this.dayDuration) % 24;
    // One continuous clock drives sky, sun, lamps and sound, including manual
    // preset changes and the midnight wrap. Limit fast changes to six hours/s.
    const hourDelta = ((this.hour - this.visualHour + 36) % 24) - 12;
    this.visualHour = (this.visualHour + clamp(hourDelta * (1 - Math.exp(-2.5 * dt)), -6 * dt, 6 * dt) + 24) % 24;
    if (this.weatherMode === 'auto') {
      this.weatherClock += dt;
      if (this.weatherPhase === 'rain' && this.weatherClock >= this.rainDuration) { this.weatherPhase = 'clear'; this.weatherClock = 0; this.clearDuration = this.nextClearDuration(); }
      else if (this.weatherPhase === 'clear' && this.weatherClock >= this.clearDuration && this.wetness === 0 && this.dryClock >= this.dryBreak) { this.weatherPhase = 'rain'; this.weatherClock = 0; }
    }
    const target = this.weatherMode === 'rain' ? 1 : this.weatherMode === 'clear' ? 0 : Number(this.weatherPhase === 'rain');
    this.rain = damp(this.rain, target, 0.6, dt);
    const accumulation = this.rain * 0.046;
    const evaporation = (1 - this.rain) * (0.006 + this.daylight * 0.012 + this.windStrength * 0.003);
    this.wetness = clamp(this.wetness + (accumulation - evaporation) * dt);
    this.dryClock = this.wetness === 0 && this.rain < 0.05 ? this.dryClock + dt : 0;
  }
}

export class RecoveryTimer {
  constructor(delay = 3) { this.delay = delay; this.elapsed = 0; }
  step(upY, speed, dt) {
    // A mid-air roll or banked corner is not a stuck car.
    this.elapsed = upY < 0.35 && speed < 3 ? this.elapsed + dt : 0;
    return this.elapsed >= this.delay;
  }
  get remaining() { return Math.max(0, this.delay - this.elapsed); }
  reset() { this.elapsed = 0; }
}

export class LapTimer {
  constructor() { this.reset(); this.best = null; }
  reset() { this.lap = 1; this.time = 0; this.checkpoint = 0; this.running = false; this.lastProgress = null; this.lastLap = null; }
  step(progress, onRoad, speed, dt) {
    if (speed > 0.5 && onRoad) this.running = true;
    if (this.running) this.time += dt;
    if (!onRoad) { this.lastProgress = null; return false; }
    // Sequential quarter-lap gates prevent shortcuts or reverse crossings.
    if (this.checkpoint < 3 && progress >= (this.checkpoint + 1) * 0.25 && progress < (this.checkpoint + 1) * 0.25 + 0.12) this.checkpoint++;
    const crossed = this.checkpoint === 3 && this.lastProgress > 0.9 && progress < 0.1;
    this.lastProgress = progress;
    if (!crossed) return false;
    this.lastLap = this.time;
    this.best = this.best === null ? this.time : Math.min(this.best, this.time);
    this.lap++;
    this.time = 0;
    this.checkpoint = 0;
    return true;
  }
}

export function formatTime(seconds) {
  const tenths = Math.floor(seconds * 10 + 1e-6);
  return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
}

export function randomGenerator(seed = 8421) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
