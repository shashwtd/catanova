import type { Preferences } from './preferences.js';
import { DICE_IMPACT_MS } from './DiceThrow.js';
export type SoundCue =
  | 'ui'
  | 'hover'
  | 'road'
  | 'settlement'
  | 'city'
  | 'dice'
  | 'gain'
  | 'spend'
  | 'trade'
  | 'development'
  | 'knight'
  | 'robber'
  | 'turn'
  | 'award'
  | 'win'
  | 'warning'
  | 'error'
  | 'join';
export type SoundNote = {
  at: number;
  duration: number;
  gain: number;
  frequency: number;
  endFrequency?: number;
  wave: OscillatorType | 'noise';
  filter?: number;
};
/** Short original layered foley/chimes. No downloaded samples or continuously running audio. */
export function soundScore(cue: SoundCue): SoundNote[] {
  const tone = (
    frequency: number,
    at = 0,
    duration = 0.16,
    gain = 0.12,
    wave: OscillatorType = 'sine',
  ): SoundNote => ({ frequency, at, duration, gain, wave });
  const tap = (frequency: number, at = 0, gain = 0.15): SoundNote => ({
    ...tone(frequency, at, 0.09, gain, 'triangle'),
    endFrequency: frequency * 0.62,
  });
  const noise = (at = 0, duration = 0.08, gain = 0.1, filter = 2000): SoundNote => ({
    at,
    duration,
    gain,
    frequency: 0,
    wave: 'noise',
    filter,
  });
  switch (cue) {
    case 'ui':
      return [tap(700, 0, 0.035)];
    case 'hover':
      return [tone(760, 0, 0.055, 0.022)];
    case 'road':
      return [tap(185, 0, 0.13), noise(0, 0.065, 0.065, 1050), tap(290, 0.065, 0.05)];
    case 'settlement':
      return [
        tap(145, 0, 0.16),
        noise(0, 0.1, 0.075, 850),
        tap(270, 0.07, 0.08),
        tone(590, 0.14, 0.22, 0.045),
      ];
    case 'city':
      return [
        tap(110, 0, 0.16),
        noise(0, 0.13, 0.075, 1500),
        tone(392, 0.08, 0.3, 0.075),
        tone(587, 0.16, 0.4, 0.055),
        tone(784, 0.23, 0.45, 0.035),
      ];
    case 'dice':
      return [
        noise(0.025, 0.12, 0.04, 1500),
        ...DICE_IMPACT_MS.flatMap((at, i) => [
          tap(260 - i * 23, at / 1000, 0.145 - i * 0.028),
          tap(355 - i * 21, at / 1000 + 0.018, 0.075 - i * 0.014),
          noise(at / 1000, 0.045, 0.07 - i * 0.014, 1650 - i * 170),
        ]),
      ];
    case 'gain':
      return [tone(523, 0, 0.19, 0.08), tone(659, 0.065, 0.25, 0.07), tone(784, 0.13, 0.3, 0.055)];
    case 'spend':
      return [noise(0, 0.13, 0.1, 2800), noise(0.07, 0.15, 0.08, 1700), tap(420, 0.13, 0.035)];
    case 'trade':
      return [noise(0, 0.1, 0.06, 1900), tone(880, 0.06, 0.24, 0.08), tone(1174, 0.15, 0.22, 0.045)];
    case 'knight':
      return [
        noise(0, 0.2, 0.13, 2100),
        tone(196, 0.04, 0.34, 0.12, 'triangle'),
        tone(294, 0.11, 0.34, 0.08, 'triangle'),
        tone(587, 0.2, 0.38, 0.07),
      ];
    case 'development':
      return [
        noise(0, 0.17, 0.045, 2700),
        ...[392, 523, 659, 784].map((n, i) => tone(n, i * 0.06, 0.4, 0.075)),
      ];
    case 'robber':
      return [
        noise(0, 0.28, 0.085, 680),
        { ...tone(150, 0.05, 0.25, 0.09, 'triangle'), endFrequency: 80 },
        tap(115, 0.21, 0.09),
      ];
    case 'turn':
      return [tone(660, 0, 0.28, 0.08), tone(880, 0.11, 0.32, 0.055)];
    case 'award':
      return [523, 659, 784, 1046].map((n, i) => tone(n, i * 0.1, 0.45, 0.08));
    case 'win':
      return [392, 523, 659, 784, 659, 784, 1046].map((n, i) => tone(n, i * 0.13, 0.6, 0.08));
    case 'warning':
      return [tap(660, 0, 0.05), tap(660, 0.18, 0.05)];
    case 'error':
      return [tap(150, 0, 0.09)];
    case 'join':
      return [tone(440, 0, 0.2, 0.05), tone(554, 0.08, 0.23, 0.06)];
  }
}
export class SoundEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private voices = new Map<AudioScheduledSourceNode, { gain: GainNode; filter: BiquadFilterNode }>();
  private idle?: ReturnType<typeof setTimeout>;
  private resuming?: Promise<void>;
  private suspending?: Promise<void>;
  private generation = 0;
  private last = new Map<SoundCue, number>();
  private unlocked = false;
  constructor(private preferences: () => Preferences) {}
  private enabled() {
    const p = this.preferences();
    return p.sound && p.volume > 0;
  }
  private hidden() {
    return typeof document !== 'undefined' && document.hidden;
  }
  private async wake(context: AudioContext) {
    // Wait for a pending idle suspension, otherwise a fresh cue could start just
    // before that suspension completes and then freeze midway through playback.
    if (this.suspending) await this.suspending;
    if (context !== this.context || context.state === 'closed') return;
    if (context.state !== 'running') {
      const resume = this.resuming ?? context.resume();
      this.resuming = resume;
      try {
        await resume;
      } finally {
        if (this.resuming === resume) this.resuming = undefined;
      }
    }
  }
  private suspend(context = this.context) {
    if (!context || context !== this.context || context.state !== 'running' || this.suspending) return;
    const suspend = context.suspend().catch(() => {});
    this.suspending = suspend;
    void suspend.finally(() => {
      if (this.suspending === suspend) this.suspending = undefined;
    });
  }
  async unlock() {
    if (!this.enabled() || this.hidden() || typeof AudioContext === 'undefined') return;
    this.unlocked = true;
    const generation = this.generation;
    try {
      this.context ??= new AudioContext({ latencyHint: 'interactive' });
      if (!this.master) {
        this.master = this.context.createGain();
        this.master.gain.value = 0;
        this.master.connect(this.context.destination);
      }
      const context = this.context;
      await this.wake(context);
      if (context !== this.context) return;
      if (generation !== this.generation || !this.enabled() || this.hidden()) {
        this.sleepWhenIdle(0);
        return;
      }
      this.refresh();
      this.sleepWhenIdle(1200);
    } catch {
      /* Audio support must never block a game action. */
    }
  }
  refresh() {
    if (this.context && this.context.state !== 'closed' && this.master)
      this.master.gain.setTargetAtTime(
        this.enabled() ? this.preferences().volume * 0.6 : 0,
        this.context.currentTime,
        0.025,
      );
    if (!this.enabled()) this.silence();
  }
  private sleepWhenIdle(ms: number) {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      if (!this.voices.size) this.suspend();
    }, ms);
  }
  private release(source: AudioScheduledSourceNode) {
    const voice = this.voices.get(source);
    if (!voice) return;
    source.onended = null;
    source.disconnect();
    voice.filter.disconnect();
    voice.gain.disconnect();
    this.voices.delete(source);
  }
  private noiseBuffer(context: AudioContext) {
    if (!this.noise) {
      this.noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const values = this.noise.getChannelData(0);
      let seed = 746593;
      for (let i = 0; i < values.length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        values[i] = seed / 2147483648 - 1;
      }
    }
    return this.noise;
  }
  play(cue: SoundCue) {
    if (!this.unlocked || !this.enabled() || !this.context || !this.master || this.hidden()) return;
    const now = performance.now(),
      last = this.last.get(cue) ?? -Infinity;
    if (now - last < (cue === 'hover' ? 180 : cue === 'ui' ? 35 : 70)) return;
    this.last.set(cue, now);
    const generation = this.generation,
      ctx = this.context;
    void (async () => {
      try {
        await this.wake(ctx);
        if (ctx !== this.context) return;
        if (generation !== this.generation || !this.enabled() || this.hidden()) {
          this.sleepWhenIdle(0);
          return;
        }
        clearTimeout(this.idle);
        const start = ctx.currentTime + 0.006;
        for (const note of soundScore(cue)) {
          if (this.voices.size >= 48) break;
          const source = note.wave === 'noise' ? ctx.createBufferSource() : ctx.createOscillator();
          if (note.wave !== 'noise') {
            const oscillator = source as OscillatorNode;
            oscillator.type = note.wave;
            oscillator.frequency.setValueAtTime(note.frequency, start + note.at);
            if (note.endFrequency)
              oscillator.frequency.exponentialRampToValueAtTime(
                note.endFrequency,
                start + note.at + note.duration,
              );
          } else (source as AudioBufferSourceNode).buffer = this.noiseBuffer(ctx);
          const gain = ctx.createGain(),
            filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = note.filter ?? 7000;
          gain.gain.setValueAtTime(0.0001, start + note.at);
          gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, note.gain), start + note.at + 0.006);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.duration);
          source.connect(filter);
          filter.connect(gain);
          gain.connect(this.master!);
          this.voices.set(source, { gain, filter });
          source.onended = () => {
            this.release(source);
            this.sleepWhenIdle(650);
          };
          try {
            source.start(start + note.at);
            source.stop(start + note.at + note.duration + 0.012);
          } catch (error) {
            this.release(source);
            throw error;
          }
        }
      } catch {
        /* A suspended/unsupported audio device never affects authoritative state. */
        if (!this.voices.size && ctx === this.context) this.sleepWhenIdle(0);
      }
    })();
  }
  silence() {
    this.generation++;
    clearTimeout(this.idle);
    this.last.clear();
    for (const source of this.voices.keys()) {
      try {
        source.stop();
      } catch {}
      this.release(source);
    }
    this.suspend();
  }
  dispose() {
    this.silence();
    const context = this.context;
    this.master?.disconnect();
    this.context = undefined;
    this.master = undefined;
    this.noise = undefined;
    this.unlocked = false;
    this.resuming = undefined;
    this.suspending = undefined;
    void context?.close().catch(() => {});
  }
}
