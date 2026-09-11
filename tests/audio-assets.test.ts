import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AUDIO_SAMPLES } from '../apps/client/src/audio-samples.js';
import { MUSIC_URL } from '../apps/client/src/sound.js';
import { parsePreferences } from '../apps/client/src/preferences.js';

const publicRoot = new URL('../apps/client/public/', import.meta.url);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('shipped effects match their provenance, immutable URLs and compact transfer budget', async () => {
  const manifest = JSON.parse(await readFile(new URL('../docs/audio/sfx.json', import.meta.url), 'utf8')) as {
    samples: { id: string; url: string; bytes: number; sha256: string; duration: number; license: string }[];
  };
  const catalog = new Map<string, { url: string; duration: number }>(Object.entries(AUDIO_SAMPLES));
  assert.equal(manifest.samples.length, catalog.size);
  let total = 0;
  for (const entry of manifest.samples) {
    assert.deepEqual(catalog.get(entry.id), { url: entry.url, duration: entry.duration });
    assert.match(entry.url, /^\/audio\/sfx\/[A-Za-z]+\.[a-f0-9]{12}\.(wav|m4a)$/);
    assert.equal(entry.license, 'CC0-1.0');
    const bytes = await readFile(new URL(entry.url.slice(1), publicRoot));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(sha(bytes), entry.sha256);
    assert.ok(entry.url.includes(`.${entry.sha256.slice(0, 12)}.`));
    assert.ok(entry.duration > 0 && entry.duration < 2);
    if (entry.url.endsWith('.wav')) {
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
      const format = bytes.indexOf('fmt ');
      assert.ok(format >= 12);
      assert.equal(bytes.readUInt16LE(format + 8), 1, 'uncompressed PCM');
      assert.equal(bytes.readUInt16LE(format + 10), 1, 'mono foley');
      assert.equal(bytes.readUInt32LE(format + 12), 22050);
      assert.equal(bytes.readUInt16LE(format + 22), 16);
    } else {
      assert.equal(bytes.toString('ascii', 4, 8), 'ftyp');
    }
    total += bytes.length;
    catalog.delete(entry.id);
  }
  assert.equal(catalog.size, 0);
  assert.ok(total < 250_000, `effects transfer grew to ${total} bytes`);
});

test('optional music has a valid hashed asset below one megabyte', async () => {
  assert.match(MUSIC_URL, /^\/audio\/music\/[a-z-]+\.[a-f0-9]{12}\.m4a$/);
  const bytes = await readFile(new URL(MUSIC_URL.slice(1), publicRoot));
  assert.equal(bytes.toString('ascii', 4, 8), 'ftyp');
  assert.ok(MUSIC_URL.includes(`.${sha(bytes).slice(0, 12)}.`));
  assert.ok(bytes.length < 1_000_000, `music transfer grew to ${bytes.length} bytes`);
});

test('existing saved effects settings do not opt users into music', () => {
  assert.deepEqual(parsePreferences({ sound: false, volume: 0.8 }), {
    sound: false,
    volume: 0.8,
    music: false,
    musicVolume: 0.3,
  });
  assert.deepEqual(parsePreferences({ sound: false, volume: 0, music: true, musicVolume: 2 }), {
    sound: false,
    volume: 0,
    music: true,
    musicVolume: 1,
  });
  assert.equal(parsePreferences({ musicVolume: Number.NaN }).musicVolume, 0.3);
});
