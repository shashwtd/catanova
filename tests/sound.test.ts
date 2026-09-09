import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { SoundEngine, soundScore } from '../apps/client/src/sound.js';
import type { SoundCue } from '../apps/client/src/sound.js';
import { DICE_IMPACT_MS } from '../apps/client/src/DiceThrow.js';
import { DEFAULT_PREFERENCES } from '../apps/client/src/preferences.js';

class Parameter {
  value = 0;
  targets: number[] = [];
  setValueAtTime(value: number) {
    this.value = value;
  }
  exponentialRampToValueAtTime(value: number) {
    this.value = value;
  }
  setTargetAtTime(value: number) {
    this.targets.push(value);
    this.value = value;
  }
}
class AudioNodeDouble {
  disconnected = false;
  connect(_node: unknown) {}
  disconnect() {
    this.disconnected = true;
  }
}
class Source extends AudioNodeDouble {
  type = 'sine';
  frequency = new Parameter();
  buffer?: unknown;
  onended: (() => void) | null = null;
  startAt?: number;
  stopAt?: number;
  stopCalls = 0;
  start(at: number) {
    this.startAt = at;
  }
  stop(at = 0) {
    this.stopAt = at;
    this.stopCalls++;
  }
  end() {
    this.onended?.();
  }
}
class Gain extends AudioNodeDouble {
  gain = new Parameter();
}
class Filter extends AudioNodeDouble {
  frequency = new Parameter();
  type = 'lowpass';
}
class AudioContextDouble {
  static instances: AudioContextDouble[] = [];
  state = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  destination = new AudioNodeDouble();
  sources: Source[] = [];
  gains: Gain[] = [];
  filters: Filter[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  holdResume = false;
  holdSuspend = false;
  finishResume?: () => void;
  finishSuspend?: () => void;
  constructor() {
    AudioContextDouble.instances.push(this);
  }
  resume() {
    this.resumeCalls++;
    if (this.holdResume)
      return new Promise<void>((resolve, reject) => {
        this.finishResume = () => {
          this.holdResume = false;
          if (this.state === 'closed') {
            reject(new Error('Closed'));
            return;
          }
          this.state = 'running';
          resolve();
        };
      });
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.suspendCalls++;
    if (this.holdSuspend)
      return new Promise<void>((resolve) => {
        this.finishSuspend = () => {
          this.holdSuspend = false;
          this.state = 'suspended';
          resolve();
        };
      });
    this.state = 'suspended';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
  createGain() {
    const gain = new Gain();
    this.gains.push(gain);
    return gain;
  }
  createBiquadFilter() {
    const filter = new Filter();
    this.filters.push(filter);
    return filter;
  }
  createOscillator() {
    const source = new Source();
    this.sources.push(source);
    return source;
  }
  createBufferSource() {
    return this.createOscillator();
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function environment(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const keys = ['AudioContext', 'document'] as const;
  const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  AudioContextDouble.instances = [];
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: AudioContextDouble });
  const document = { hidden: false };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  t.after(() => {
    keys.forEach((key, i) => {
      if (descriptors[i]) Object.defineProperty(globalThis, key, descriptors[i]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  });
  return document;
}

test('dice foley meets each visible contact, softens on successive bounces, and distinguishes materials', () => {
  const score = soundScore('dice');
  const impacts = DICE_IMPACT_MS.map((at) =>
    score.find((note) => note.at === at / 1000 && note.wave === 'triangle')!,
  );
  assert.ok(impacts.every(Boolean));
  for (let i = 1; i < impacts.length; i++) assert.ok(impacts[i]!.gain < impacts[i - 1]!.gain);
  assert.ok(score.some((note) => note.wave === 'noise'));
  assert.ok(Math.max(...score.map((note) => note.at + note.duration)) < 1.2);
  assert.notDeepEqual(soundScore('road'), soundScore('settlement'));
  assert.notDeepEqual(soundScore('settlement'), soundScore('city'));
});

test('audio is lazy, volume-zero stays asleep, voices clean up immediately on mute, and unmute works', async (t) => {
  const doc = environment(t);
  let preferences = { ...DEFAULT_PREFERENCES, volume: 0 };
  const engine = new SoundEngine(() => preferences);
  t.after(() => engine.dispose());
  engine.play('dice');
  await engine.unlock();
  assert.equal(AudioContextDouble.instances.length, 0, 'silent settings create no audio hardware context');
  preferences = { ...preferences, volume: 0.5 };
  await engine.unlock();
  const context = AudioContextDouble.instances[0]!;
  engine.play('dice');
  await flush();
  assert.equal(context.sources.length, soundScore('dice').length);
  assert.ok(context.sources.every((source) => source.stopAt! > source.startAt! && source.stopAt! < 1.3));
  preferences = { ...preferences, sound: false };
  engine.refresh();
  await flush();
  assert.equal(context.state, 'suspended');
  assert.ok(
    context.sources.every(
      (source) => source.disconnected && source.onended === null && source.stopCalls === 2,
    ),
  );
  assert.ok(context.filters.every((filter) => filter.disconnected));
  assert.ok(context.gains.slice(1).every((gain) => gain.disconnected));
  assert.equal(context.gains[0]!.gain.value, 0);
  const count = context.sources.length;
  preferences = { ...preferences, sound: true };
  engine.refresh();
  engine.play('road');
  await flush();
  assert.ok(context.sources.length > count);
  const after = context.sources.length;
  doc.hidden = true;
  engine.play('city');
  await flush();
  assert.equal(context.sources.length, after, 'background tabs never schedule new sound');
});

test('muting during an unfinished resume cannot leave silent hardware running', async (t) => {
  environment(t);
  let preferences = { ...DEFAULT_PREFERENCES };
  const engine = new SoundEngine(() => preferences);
  t.after(() => engine.dispose());
  await engine.unlock();
  const context = AudioContextDouble.instances[0]!;
  t.mock.timers.tick(1200);
  await flush();
  assert.equal(context.state, 'suspended');
  context.holdResume = true;
  engine.play('dice');
  await flush();
  preferences = { ...preferences, sound: false };
  engine.refresh();
  context.finishResume!();
  await flush();
  t.mock.timers.tick(0);
  await flush();
  assert.equal(context.sources.length, 0, 'a cancelled cue never starts after mute');
  assert.equal(context.state, 'suspended', 'the late resume is put back to sleep');
});

test('a new cue waits for pending suspension and idle audio then sleeps after its final voice', async (t) => {
  environment(t);
  const engine = new SoundEngine(() => DEFAULT_PREFERENCES);
  t.after(() => engine.dispose());
  await engine.unlock();
  const context = AudioContextDouble.instances[0]!;
  context.holdSuspend = true;
  t.mock.timers.tick(1200);
  await flush();
  engine.play('settlement');
  await flush();
  assert.equal(context.sources.length, 0);
  context.finishSuspend!();
  await flush();
  assert.equal(context.state, 'running');
  assert.equal(context.sources.length, soundScore('settlement').length);
  context.sources.forEach((source) => source.end());
  t.mock.timers.tick(649);
  assert.equal(context.state, 'running');
  t.mock.timers.tick(1);
  await flush();
  assert.equal(context.state, 'suspended');
  assert.ok(context.filters.every((filter) => filter.disconnected));
  engine.dispose();
  assert.equal(context.state, 'closed');
  await engine.unlock();
  assert.equal(
    AudioContextDouble.instances.length,
    2,
    'a fresh activation after effect cleanup gets a new context',
  );
});

test('overlapping events have a fixed voice budget and release it for later cues', async (t) => {
  environment(t);
  const engine = new SoundEngine(() => DEFAULT_PREFERENCES);
  t.after(() => engine.dispose());
  await engine.unlock();
  const context = AudioContextDouble.instances[0]!;
  const cues: SoundCue[] = [
    'dice',
    'road',
    'settlement',
    'city',
    'gain',
    'spend',
    'trade',
    'knight',
    'development',
    'robber',
    'turn',
    'award',
    'win',
  ];
  assert.ok(cues.reduce((count, cue) => count + soundScore(cue).length, 0) > 48);
  cues.forEach((cue) => engine.play(cue));
  await flush();
  assert.equal(context.sources.length, 48);
  context.sources.forEach((source) => source.end());
  engine.play('hover');
  await flush();
  assert.equal(context.sources.length, 49, 'released voices are available to a later cue');
  assert.ok(context.sources.every((source) => source.stopAt! > source.startAt!));
});
