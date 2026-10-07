// The GPU runs independently of JavaScript. We measure its time with an asynchronous
// WebGL query and never block rendering while waiting for the result.
export class GpuTimer {
  constructor(gl) {
    this.gl = gl;
    this.extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (this.extension && gl.getQuery(this.extension.TIME_ELAPSED_EXT, this.extension.QUERY_COUNTER_BITS_EXT) === 0) this.extension = null;
    this.query = null;
    this.active = false;
    this.pending = false;
    this.lastMs = null;
  }
  poll() {
    if (!this.extension || !this.pending) return;
    if (this.gl.isContextLost()) { this.reset(); return; }
    // If the GPU timer fails, discard the result instead of showing an incorrect value.
    if (this.gl.getParameter(this.extension.GPU_DISJOINT_EXT)) {
      this.pending = false;
      this.lastMs = null;
      return;
    }
    if (!this.gl.getQueryParameter(this.query, this.gl.QUERY_RESULT_AVAILABLE)) return;
    const milliseconds = this.gl.getQueryParameter(this.query, this.gl.QUERY_RESULT) / 1e6;
    this.lastMs = Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : null;
    this.pending = false;
  }
  begin() {
    if (!this.extension || this.pending || this.active || this.gl.isContextLost()) return;
    if (!this.query) this.query = this.gl.createQuery();
    if (!this.query) return;
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, this.query);
    this.active = true;
  }
  end() {
    if (!this.active) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.active = false;
    this.pending = true;
  }
  reset() {
    if (this.active && !this.gl.isContextLost()) this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    if (this.query) this.gl.deleteQuery(this.query);
    this.query = null;
    this.active = false;
    this.pending = false;
    this.lastMs = null;
  }
}

export class PerformanceMonitor {
  constructor(renderer, panel, now = () => performance.now()) {
    this.gl = renderer.getContext();
    this.now = now;
    this.gpu = new GpuTimer(this.gl);
    this.outputs = Object.fromEntries(['fps', 'frame', 'cpu', 'gpu'].map(name => [name, panel.querySelector(`[data-metric="${name}"]`)]));
    this.reset();
  }
  reset() {
    this.gpu.reset();
    this.previousTimestamp = null;
    this.windowStart = null;
    this.intervalTotal = 0;
    this.intervalCount = 0;
    this.cpuTotal = 0;
    this.frameCount = 0;
    this.sampleCount = 0;
    for (const output of Object.values(this.outputs)) output.textContent = '—';
    if (!this.gpu.extension) this.outputs.gpu.textContent = 'N/A';
  }
  restoreGpu() {
    this.gpu = new GpuTimer(this.gl);
    this.reset();
  }
  beginFrame(timestamp) {
    if (this.windowStart === null) this.windowStart = timestamp;
    if (this.previousTimestamp !== null && timestamp > this.previousTimestamp) {
      this.intervalTotal += timestamp - this.previousTimestamp;
      this.intervalCount++;
    }
    this.previousTimestamp = timestamp;
    this.timestamp = timestamp;
    this.gpu.poll();
    this.cpuStart = this.now();
    // One GPU sample per eight frames reduces monitoring overhead.
    if (this.sampleCount++ % 8 === 0) this.gpu.begin();
  }
  endFrame() {
    this.gpu.end();
    this.cpuTotal += this.now() - this.cpuStart;
    this.frameCount++;
    // Update the text twice per second instead of every frame.
    if (this.timestamp - this.windowStart < 500 || this.intervalCount === 0) return;
    this.outputs.fps.textContent = (1000 * this.intervalCount / this.intervalTotal).toFixed(0);
    this.outputs.frame.textContent = `${(this.intervalTotal / this.intervalCount).toFixed(1)} ms`;
    this.outputs.cpu.textContent = `${(this.cpuTotal / this.frameCount).toFixed(2)} ms`;
    this.outputs.gpu.textContent = !this.gpu.extension ? 'N/A' : this.gpu.lastMs === null ? '—' : `${this.gpu.lastMs.toFixed(2)} ms`;
    this.windowStart = this.timestamp;
    this.intervalTotal = 0;
    this.intervalCount = 0;
    this.cpuTotal = 0;
    this.frameCount = 0;
  }
}
