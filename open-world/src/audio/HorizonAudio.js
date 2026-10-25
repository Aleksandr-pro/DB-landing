// Procedural WebAudio Engine & Nature Soundscape for Horizon Valley

export class HorizonAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.osc1 = null;
    this.osc2 = null;
    this.engineGain = null;
    this.filter = null;
    this.windGain = null;
    this.screechGain = null;
  }

  toggle() {
    if (!this.ctx) {
      this._init();
    }
    this.enabled = !this.enabled;
    if (this.ctx.state === 'suspended' && this.enabled) {
      this.ctx.resume();
    }
    if (!this.enabled && this.engineGain) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      this.windGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      this.screechGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    }
    return this.enabled;
  }

  _init() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();

    // Ferrari V8 dual harmonic oscillators + resonant exhaust filter
    this.osc1 = this.ctx.createOscillator();
    this.osc2 = this.ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2.type = 'triangle';

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 380;
    this.filter.Q.value = 3.2;

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.0;

    this.osc1.connect(this.filter);
    this.osc2.connect(this.filter);
    this.filter.connect(this.engineGain);
    this.engineGain.connect(this.ctx.destination);
    this.osc1.start();
    this.osc2.start();

    // Filtered noise for wind rush & drift tire squeal
    const bufSize = this.ctx.sampleRate * 2;
    const noiseBuf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const out = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) out[i] = Math.random() * 2 - 1;

    const windSrc = this.ctx.createBufferSource();
    windSrc.buffer = noiseBuf;
    windSrc.loop = true;
    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.7;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    windSrc.connect(windFilter);
    windFilter.connect(this.windGain);
    this.windGain.connect(this.ctx.destination);
    windSrc.start();

    const screechSrc = this.ctx.createBufferSource();
    screechSrc.buffer = noiseBuf;
    screechSrc.loop = true;
    const screechFilter = this.ctx.createBiquadFilter();
    screechFilter.type = 'bandpass';
    screechFilter.frequency.value = 1650;
    screechFilter.Q.value = 9.5;
    this.screechGain = this.ctx.createGain();
    this.screechGain.gain.value = 0;
    screechSrc.connect(screechFilter);
    screechFilter.connect(this.screechGain);
    this.screechGain.connect(this.ctx.destination);
    screechSrc.start();
  }

  update(rpm, speedMs, isDrifting, isDriveMode) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;

    if (!isDriveMode) {
      this.engineGain.gain.setTargetAtTime(0.0, t, 0.1);
      this.windGain.gain.setTargetAtTime(0.025, t, 0.1);
      this.screechGain.gain.setTargetAtTime(0.0, t, 0.08);
      return;
    }

    const baseFreq = 32 + (rpm / 8800) * 195;
    this.osc1.frequency.setTargetAtTime(baseFreq, t, 0.04);
    this.osc2.frequency.setTargetAtTime(baseFreq * 1.5, t, 0.04);
    this.filter.frequency.setTargetAtTime(240 + (rpm / 8800) * 1650, t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.045 + (rpm / 8800) * 0.055, t, 0.06);

    const windVol = Math.min(0.07, Math.abs(speedMs) * 0.0009);
    this.windGain.gain.setTargetAtTime(windVol, t, 0.1);

    const screechVol = isDrifting && Math.abs(speedMs) > 7 ? 0.045 : 0.0;
    this.screechGain.gain.setTargetAtTime(screechVol, t, 0.05);
  }
}
