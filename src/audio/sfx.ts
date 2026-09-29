import type { SimEvent } from '../sim/events';

// Minimal WebAudio synthesis, no files (GDD §14.4). Driven by SimEvents.
// The context starts on the first user gesture (browser autoplay rules).

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  /** Call from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  onEvent(e: SimEvent): void {
    switch (e.type) {
      case 'runStarted':
        this.tone(220, 0.08, 'square', 0.15, 440);
        break;
      case 'eyeTaken':
        // Wrong-sounding chord sliding down: the line is gone, now run.
        this.tone(660, 0.6, 'sawtooth', 0.12, 330);
        this.tone(698, 0.6, 'sawtooth', 0.1, 349);
        this.noise(0.12, 0.2);
        break;
      case 'levelCleared':
        this.tone(523, 0.12, 'triangle', 0.25);
        this.tone(784, 0.25, 'triangle', 0.25, undefined, 0.08);
        break;
      case 'died':
        this.noise(0.5, 0.5);
        this.tone(110, 0.8, 'sawtooth', 0.3, 30);
        break;
      default:
        break;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain: number): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    const t0 = ctx.currentTime;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(g).connect(master);
    src.start(t0);
  }
}
