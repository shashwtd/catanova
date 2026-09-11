import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { SoundEngine, soundScore, soundLayers, MUSIC_URL } from '../apps/client/src/sound.js';
import type { SoundCue } from '../apps/client/src/sound.js';
import { DICE_IMPACT_MS } from '../apps/client/src/DiceThrow.js';
import { DEFAULT_PREFERENCES } from '../apps/client/src/preferences.js';
import { AUDIO_SAMPLES } from '../apps/client/src/audio-samples.js';

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
  playbackRate = new Parameter();
  loop = false;
  startOffset?: number;
  onended: (() => void) | null = null;
  startAt?: number;
  stopAt?: number;
  stopCalls = 0;
  start(at: number, offset?: number) {
    this.startAt = at;
    this.startOffset = offset;
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
  async decodeAudioData(data: ArrayBuffer) {
    return { duration: new Uint8Array(data)[0] === 255 ? 57.73 : 1.4 };
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
  assert.equal(
    context.sources.length,
    48 + soundScore('hover').length,
    'released voices are available to every note of a later cue',
  );
  assert.ok(context.sources.every((source) => source.stopAt! > source.startAt!));
});

function sampleFetch(t: TestContext) {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return new Response(new Uint8Array([url === MUSIC_URL ? 255 : 1]));
  });
  return urls;
}

test('recorded dice contacts match the animation and construction has a three-strike hammer rhythm', () => {
  const dice = soundLayers('dice').filter(({ sample }) => sample === 'diceContact');
  assert.deepEqual(
    dice.map(({ at }) => at * 1000),
    [...DICE_IMPACT_MS],
  );
  assert.ok(dice.every((layer, i) => i === 0 || layer.gain < dice[i - 1]!.gain));
  assert.deepEqual(
    soundLayers('settlement').map(({ at }) => at),
    [0, 0.19, 0.39],
  );
  assert.ok(soundLayers('city').some(({ sample }) => sample === 'woodHeavy'));
  assert.ok(soundLayers('gain').every(({ sample }) => sample.startsWith('paper')));
  assert.notDeepEqual(soundLayers('turn'), soundLayers('join'));
});

test('samples warm only after activation, never delay a cue, and never replay it after a download', async (t) => {
  environment(t);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    urls.push(String(input));
    await pending;
    return new Response(new Uint8Array([1]));
  });
  const engine = new SoundEngine(() => DEFAULT_PREFERENCES);
  t.after(() => engine.dispose());
  assert.equal(urls.length, 0);
  await engine.unlock();
  assert.equal(urls.length, Object.keys(AUDIO_SAMPLES).length);
  assert.ok(!urls.includes(MUSIC_URL), 'optional music is not downloaded during SFX warmup');
  const context = AudioContextDouble.instances[0]!;
  engine.play('road');
  await flush();
  const fallbackCount = context.sources.length;
  assert.equal(fallbackCount, soundScore('road').length);
  finish();
  for (let i = 0; i < 8; i++) await flush();
  assert.equal(context.sources.length, fallbackCount, 'download completion must not replay an old event');
  engine.play('city');
  await flush();
  const recorded = context.sources.slice(fallbackCount);
  assert.equal(recorded.length, soundLayers('city').length);
  assert.ok(recorded.every((source) => source.buffer && source.playbackRate.value > 0));
});

test('music is independent, game-only, opt-in and resumes its position after visibility silence', async (t) => {
  const doc = environment(t);
  const urls = sampleFetch(t);
  let preferences = { ...DEFAULT_PREFERENCES, sound: false, music: true };
  const engine = new SoundEngine(() => preferences);
  t.after(() => engine.dispose());
  await engine.unlock();
  assert.equal(urls.length, 0, 'menu does not download a music track');
  engine.setScene('game');
  for (let i = 0; i < 8; i++) await flush();
  const context = AudioContextDouble.instances[0]!;
  assert.deepEqual(urls, [MUSIC_URL]);
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0]!.loop, true);
  engine.play('road');
  await flush();
  assert.equal(context.sources.length, 1, 'muted effects do not silence independently enabled music');
  context.currentTime = 12.25;
  doc.hidden = true;
  engine.silence();
  assert.ok(context.sources[0]!.disconnected);
  doc.hidden = false;
  engine.refresh();
  await flush();
  assert.equal(context.sources[1]!.startOffset, 12.25);
  assert.equal(urls.length, 1, 'the decoded loop is reused');
  preferences = { ...preferences, music: false };
  engine.refresh();
  await flush();
  assert.ok(context.sources[1]!.disconnected);
  assert.equal(context.state, 'suspended');
});

test('hidden tabs play only an explicitly requested attention cue after activation', async (t) => {
  const doc = environment(t);
  sampleFetch(t);
  const engine = new SoundEngine(() => DEFAULT_PREFERENCES);
  t.after(() => engine.dispose());
  engine.playAttention('turn');
  assert.equal(AudioContextDouble.instances.length, 0);
  await engine.unlock();
  for (let i = 0; i < 8; i++) await flush();
  const context = AudioContextDouble.instances[0]!;
  doc.hidden = true;
  engine.silence();
  engine.play('road');
  await flush();
  assert.equal(context.sources.length, 0);
  engine.playAttention('turn');
  await flush();
  assert.equal(context.sources.length, soundLayers('turn').length);
  context.sources.forEach((source) => source.end());
  t.mock.timers.tick(650);
  await flush();
  assert.equal(context.state, 'suspended');
});

test('music disabled during a pending device resume returns the silent context to sleep', async (t) => {
  environment(t);
  sampleFetch(t);
  let preferences = { ...DEFAULT_PREFERENCES };
  const engine = new SoundEngine(() => preferences);
  t.after(() => engine.dispose());
  await engine.unlock();
  const context = AudioContextDouble.instances[0]!;
  t.mock.timers.tick(1200);
  await flush();
  context.holdResume = true;
  preferences = { ...preferences, music: true };
  engine.setScene('game');
  for (let i = 0; i < 8; i++) await flush();
  assert.ok(context.finishResume);
  preferences = { ...preferences, music: false };
  engine.refresh();
  context.finishResume!();
  await flush();
  t.mock.timers.tick(0);
  await flush();
  assert.equal(context.sources.length, 0);
  assert.equal(context.state, 'suspended');
});

test('a cancelled music fetch is reconciled after immediate hide/show, while real failures back off', async (t) => {
  const doc = environment(t);
  let rejectFirst!: (error: Error) => void;
  let musicRequests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    musicRequests++;
    if (musicRequests === 1)
      return new Promise<Response>((_resolve, reject) => {
        rejectFirst = reject;
      });
    return new Response(new Uint8Array([255]));
  });
  const preferences = { ...DEFAULT_PREFERENCES, sound: false, music: true };
  const engine = new SoundEngine(() => preferences);
  t.after(() => engine.dispose());
  engine.setScene('game');
  await engine.unlock();
  doc.hidden = true;
  engine.silence();
  doc.hidden = false;
  engine.refresh();
  rejectFirst(new DOMException('Aborted', 'AbortError'));
  for (let i = 0; i < 8; i++) await flush();
  assert.equal(musicRequests, 2);
  assert.equal(AudioContextDouble.instances[0]!.sources.length, 1);
  engine.dispose();
  let failures = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    failures++;
    throw new Error('Offline');
  });
  const failed = new SoundEngine(() => DEFAULT_PREFERENCES);
  t.after(() => failed.dispose());
  await failed.unlock();
  for (let i = 0; i < 8; i++) await flush();
  const attempts = failures;
  await failed.unlock();
  failed.play('dice');
  failed.play('settlement');
  await flush();
  assert.equal(failures, attempts, 'ordinary interactions must not repeatedly download failing samples');
});

test('late sample and music downloads cannot recreate sources after disposal', async (t) => {
  environment(t);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    await pending;
    return new Response(new Uint8Array([String(input) === MUSIC_URL ? 255 : 1]));
  });
  const engine = new SoundEngine(() => ({ ...DEFAULT_PREFERENCES, music: true }));
  engine.setScene('game');
  await engine.unlock();
  const context = AudioContextDouble.instances[0]!;
  engine.dispose();
  finish();
  for (let i = 0; i < 8; i++) await flush();
  assert.equal(context.state, 'closed');
  assert.equal(context.sources.length, 0);
});
