import type { Preferences } from './preferences.js';
import { DICE_IMPACT_MS } from './DiceThrow.js';
import { AUDIO_SAMPLES } from './audio-samples.js';
export const MUSIC_URL = '/audio/music/bards-tale.895a05b93cf9.m4a';
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
/** Small offline/failed-download fallback; recorded foley takes precedence when available. */
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
      return [noise(0, 0.065, 0.035, 3200), tone(820, 0.015, 0.055, 0.025)];
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
type Sample = keyof typeof AUDIO_SAMPLES;
export type SampleLayer = { sample: Sample; at: number; gain: number; rate?: number; duration?: number };
/** The physical contacts use the same timeline as the visible dice. */
export function soundLayers(cue: SoundCue): SampleLayer[] {
  const layer = (sample: Sample, at = 0, gain = 0.65, rate = 1, duration?: number): SampleLayer => ({
    sample,
    at,
    gain,
    rate,
    ...(duration === undefined ? {} : { duration }),
  });
  switch (cue) {
    case 'ui':
      return [layer('paperPlace', 0, 0.15, 1.2, 0.13)];
    case 'hover':
      return [layer('paperSlide', 0, 0.18, 1.2, 0.14)];
    case 'dice':
      return [
        layer('diceRattle', 0.025, 0.38),
        ...DICE_IMPACT_MS.flatMap((at, i) => [
          layer('diceContact', at / 1000, 0.78 - i * 0.14, 1 + i * 0.04, 0.14),
          layer('wood', at / 1000 + 0.019, 0.15 - i * 0.027, 1.14 - i * 0.025, 0.1),
        ]),
      ];
    case 'road':
      return [layer('plank', 0, 0.7), layer('wood', 0.1, 0.26, 1.12)];
    case 'settlement':
      return [layer('wood', 0, 0.67, 1.03), layer('wood', 0.19, 0.61, 0.97), layer('wood', 0.39, 0.78, 1.07)];
    case 'city':
      return [
        layer('woodHeavy', 0, 0.82, 0.94),
        layer('stone', 0.16, 0.35, 0.84),
        layer('woodHeavy', 0.36, 0.76, 1.02),
        layer('wood', 0.56, 0.55, 0.89),
      ];
    case 'gain':
      return [layer('paperSlide', 0, 0.5), layer('paperPlace', 0.15, 0.46, 1.04)];
    case 'spend':
      return [layer('paperFan', 0, 0.56, 1.12), layer('paperPlace', 0.18, 0.3)];
    case 'trade':
      return [
        layer('paperSlide', 0, 0.57),
        layer('paperFan', 0.12, 0.4, 1.15),
        layer('paperPlace', 0.34, 0.52),
      ];
    case 'development':
      return [layer('paperFan', 0, 0.32), layer('magic', 0.09, 0.51)];
    case 'knight':
      return [layer('steel', 0, 0.66), layer('woodHeavy', 0.17, 0.42), layer('magic', 0.15, 0.27, 0.84)];
    case 'robber':
      return [layer('cloth', 0, 0.47), layer('woodHeavy', 0.2, 0.39, 0.76)];
    case 'turn':
      return [layer('turn', 0, 0.73)];
    case 'award':
      return [layer('award', 0, 0.77), layer('magic', 0.66, 0.37, 1.12)];
    case 'win':
      return [layer('award', 0, 0.77), layer('turn', 0.88, 0.72)];
    case 'warning':
      return [layer('wood', 0, 0.45, 1.3), layer('wood', 0.19, 0.38, 1.12)];
    case 'error':
      return [layer('woodHeavy', 0, 0.34, 0.72)];
    case 'join':
      return [layer('join', 0, 0.44)];
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
  private samples = new Map<Sample, AudioBuffer>();
  private sampleLoads = new Map<Sample, Promise<void>>();
  private sampleRetryAfter = new Map<Sample, number>();
  private requests = new Set<AbortController>();
  private scene: 'menu' | 'game' = 'menu';
  private music?: AudioBufferSourceNode;
  private musicGain?: GainNode;
  private musicBuffer?: AudioBuffer;
  private musicLoading?: Promise<void>;
  private musicOffset = 0;
  private musicStarted = 0;
  private musicRetryAfter = 0;
  constructor(private preferences: () => Preferences) {}
  private enabled() {
    const p = this.preferences();
    return p.sound && p.volume > 0;
  }
  private hidden() {
    return typeof document !== 'undefined' && document.hidden;
  }
  private wantsMusic() {
    const p = this.preferences();
    return this.unlocked && p.music && p.musicVolume > 0 && this.scene === 'game' && !this.hidden();
  }
  setScene(scene: 'menu' | 'game') {
    this.scene = scene;
    this.refresh();
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
    if (this.hidden() || typeof AudioContext === 'undefined') return;
    this.unlocked = true;
    if (!this.enabled() && !this.wantsMusic()) return;
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
      if (generation !== this.generation || (!this.enabled() && !this.wantsMusic()) || this.hidden()) {
        this.sleepWhenIdle(0);
        return;
      }
      this.refresh();
      if (this.enabled()) this.warmSamples(context);
      this.sleepWhenIdle(1200);
    } catch {
      /* Audio support must never block a game action. */
    }
  }
  refresh() {
    if (!this.context && this.unlocked && !this.hidden() && (this.enabled() || this.wantsMusic())) {
      void this.unlock();
      return;
    }
    if (this.context && this.context.state !== 'closed' && this.master)
      this.master.gain.setTargetAtTime(
        this.enabled() ? this.preferences().volume * 0.6 : 0,
        this.context.currentTime,
        0.025,
      );
    if (!this.enabled()) this.stopEffects();
    if (this.wantsMusic()) void this.startMusic();
    else this.stopMusic();
    if (!this.enabled() && !this.wantsMusic()) this.suspend();
  }
  private sleepWhenIdle(ms: number) {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      if (!this.voices.size && !this.music) this.suspend();
    }, ms);
  }
  private async download(url: string, context: AudioContext, timeoutMs = 8000): Promise<AudioBuffer> {
    const controller = new AbortController();
    this.requests.add(controller);
    const timeout = setTimeout(
      () => controller.abort(new DOMException('Audio download timed out', 'TimeoutError')),
      timeoutMs,
    );
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'force-cache', priority: 'low' });
      if (!response.ok) throw new Error('Audio unavailable');
      return await context.decodeAudioData(await response.arrayBuffer());
    } finally {
      clearTimeout(timeout);
      this.requests.delete(controller);
    }
  }
  private warmSamples(context: AudioContext) {
    for (const sample of Object.keys(AUDIO_SAMPLES) as Sample[]) {
      if (
        this.samples.has(sample) ||
        this.sampleLoads.has(sample) ||
        performance.now() < (this.sampleRetryAfter.get(sample) ?? 0)
      )
        continue;
      const loading = this.download(AUDIO_SAMPLES[sample].url, context)
        .then((buffer) => {
          if (this.context === context) this.samples.set(sample, buffer);
        })
        .catch((error: unknown) => {
          if (this.context === context && !(error instanceof Error && error.name === 'AbortError'))
            this.sampleRetryAfter.set(sample, performance.now() + 30000);
        })
        .finally(() => {
          if (this.sampleLoads.get(sample) === loading) this.sampleLoads.delete(sample);
        });
      this.sampleLoads.set(sample, loading);
    }
  }
  private async startMusic() {
    const context = this.context;
    if (!context || !this.wantsMusic() || performance.now() < this.musicRetryAfter) return;
    if (this.music && this.musicGain) {
      this.musicGain.gain.setTargetAtTime(this.preferences().musicVolume * 0.32, context.currentTime, 0.15);
      return;
    }
    if (this.musicLoading) return this.musicLoading;
    let cancelled = false;
    const loading = (async () => {
      try {
        const buffer = this.musicBuffer ?? (await this.download(MUSIC_URL, context, 60000));
        if (this.context !== context || !this.wantsMusic()) return;
        this.musicBuffer = buffer;
        await this.wake(context);
        if (this.context !== context) return;
        if (!this.wantsMusic()) {
          this.sleepWhenIdle(0);
          return;
        }
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = this.musicBuffer;
        source.loop = true;
        gain.gain.setValueAtTime(0, context.currentTime);
        gain.gain.setTargetAtTime(this.preferences().musicVolume * 0.32, context.currentTime, 0.3);
        source.connect(gain);
        gain.connect(context.destination);
        this.music = source;
        this.musicGain = gain;
        this.musicStarted = context.currentTime;
        source.start(0, this.musicOffset % this.musicBuffer.duration);
      } catch (error) {
        // No music device, blocked download, or decode failure must delay play or retry in a loop.
        cancelled = error instanceof Error && error.name === 'AbortError';
        if (this.context === context && !cancelled) this.musicRetryAfter = performance.now() + 30000;
      }
    })();
    this.musicLoading = loading;
    await loading;
    if (this.musicLoading === loading) this.musicLoading = undefined;
    if (cancelled && this.context === context && this.wantsMusic()) void this.startMusic();
  }
  private stopMusic() {
    if (this.music) {
      if (this.context && this.musicBuffer)
        this.musicOffset =
          (this.musicOffset + Math.max(0, this.context.currentTime - this.musicStarted)) %
          this.musicBuffer.duration;
      try {
        this.music.stop();
      } catch {}
      this.music.disconnect();
      this.music = undefined;
      this.musicGain?.disconnect();
      this.musicGain = undefined;
    }
    if (!this.voices.size) this.sleepWhenIdle(0);
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
    this.playCue(cue, false);
  }
  playAttention(cue: 'turn' | 'warning') {
    this.playCue(cue, true);
  }
  private playCue(cue: SoundCue, attention: boolean) {
    if (!this.unlocked || !this.enabled() || !this.context || !this.master || (!attention && this.hidden()))
      return;
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
        if (generation !== this.generation || !this.enabled() || (!attention && this.hidden())) {
          this.sleepWhenIdle(0);
          return;
        }
        clearTimeout(this.idle);
        const start = ctx.currentTime + 0.006;
        const layers = soundLayers(cue);
        if (layers.every(({ sample }) => this.samples.has(sample))) {
          for (const layer of layers) {
            if (this.voices.size >= 48) break;
            const source = ctx.createBufferSource(),
              gain = ctx.createGain(),
              filter = ctx.createBiquadFilter();
            source.buffer = this.samples.get(layer.sample)!;
            source.playbackRate.value = layer.rate ?? 1;
            const duration = Math.min(
              layer.duration ?? Infinity,
              source.buffer.duration / source.playbackRate.value,
            );
            filter.type = 'lowpass';
            filter.frequency.value = 14000;
            gain.gain.setValueAtTime(layer.gain, start + layer.at);
            gain.gain.setTargetAtTime(0.0001, start + layer.at + Math.max(0.01, duration - 0.018), 0.006);
            source.connect(filter);
            filter.connect(gain);
            gain.connect(this.master!);
            this.voices.set(source, { gain, filter });
            source.onended = () => {
              this.release(source);
              this.sleepWhenIdle(650);
            };
            try {
              source.start(start + layer.at);
              source.stop(start + layer.at + duration);
            } catch (error) {
              this.release(source);
              throw error;
            }
          }
          return;
        }
        // Never play a downloaded cue late: use the immediate fallback for this event only.
        if (!this.hidden()) this.warmSamples(ctx);
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
  private stopEffects() {
    this.generation++;
    clearTimeout(this.idle);
    this.last.clear();
    for (const source of this.voices.keys()) {
      try {
        source.stop();
      } catch {}
      this.release(source);
    }
  }
  silence() {
    this.stopEffects();
    this.stopMusic();
    for (const controller of this.requests) controller.abort();
    this.suspend();
  }
  dispose() {
    this.silence();
    const context = this.context;
    this.master?.disconnect();
    this.context = undefined;
    this.master = undefined;
    this.noise = undefined;
    this.samples.clear();
    this.sampleLoads.clear();
    this.sampleRetryAfter.clear();
    this.musicBuffer = undefined;
    this.musicLoading = undefined;
    this.musicOffset = 0;
    this.musicRetryAfter = 0;
    this.unlocked = false;
    this.resuming = undefined;
    this.suspending = undefined;
    void context?.close().catch(() => {});
  }
}
