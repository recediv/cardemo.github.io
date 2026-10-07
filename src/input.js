export class Input {
  constructor(actions) {
    this.keys = new Set(); this.touches = new Map(); this.actions = actions;
    window.addEventListener('keydown', event => {
      if (event.target instanceof HTMLElement && event.target.matches('input, select, button, textarea')) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
      this.keys.add(event.code);
      if (!event.repeat) actions[event.code]?.();
    });
    window.addEventListener('keyup', event => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.clear());
    for (const button of document.querySelectorAll('[data-drive]')) {
      button.addEventListener('pointerdown', event => {
        event.preventDefault(); button.setPointerCapture(event.pointerId);
        this.touches.set(event.pointerId, button.dataset.drive); button.classList.add('pressed');
      });
      const release = event => { this.touches.delete(event.pointerId); button.classList.remove('pressed'); };
      button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
    }
  }
  held(action, ...codes) { return codes.some(code => this.keys.has(code)) || [...this.touches.values()].includes(action); }
  get forward() { return this.held('forward', 'KeyW', 'ArrowUp'); }
  get backward() { return this.held('backward', 'KeyS', 'ArrowDown'); }
  get left() { return this.held('left', 'KeyA', 'ArrowLeft'); }
  get right() { return this.held('right', 'KeyD', 'ArrowRight'); }
  get brake() { return this.held('brake', 'Space'); }
  get boost() { return this.held('boost', 'ShiftLeft', 'ShiftRight'); }
  get horn() { return this.held('horn', 'KeyE'); }
  clear() { this.keys.clear(); this.touches.clear(); for (const button of document.querySelectorAll('[data-drive]')) button.classList.remove('pressed'); }
}
