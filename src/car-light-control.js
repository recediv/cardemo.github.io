export class CarLightControl {
  constructor() {
    this.mode = 'auto';
    this.autoActivation = 0;
  }

  get activation() {
    if (this.mode === 'on') return 1;
    if (this.mode === 'off') return 0;
    return this.autoActivation;
  }

  toggle() {
    this.mode = this.activation > 0.005 ? 'off' : 'on';
    return this.mode;
  }
}
