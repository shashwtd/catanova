import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberEntryIntent, takeEntryIntent } from '../apps/client/src/entry-intent.js';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

test('Google return restores the chosen room action once and lets the next sign-in choose again', () => {
  const session = storage();
  assert.equal(takeEntryIntent(session, 1000), 'home');
  rememberEntryIntent(session, 'join', 1000);
  assert.equal(takeEntryIntent(session, 2000), 'join');
  assert.equal(takeEntryIntent(session, 2000), 'home');
  rememberEntryIntent(session, 'create', 3000);
  assert.equal(takeEntryIntent(session, 4000), 'create');
});

test('abandoned, malformed, and future room choices return safely to the menu', () => {
  const session = storage();
  rememberEntryIntent(session, 'create', 1000);
  assert.equal(takeEntryIntent(session, 1000 + 30 * 60 * 1000), 'home');
  rememberEntryIntent(session, 'join', 2000);
  assert.equal(takeEntryIntent(session, 1000), 'home');
  for (const raw of ['{', 'null', '[]', '{"entry":"invite","at":1000}', '{"entry":"create","at":"1000"}']) {
    session.setItem('catanova.entry.intent', raw);
    assert.equal(takeEntryIntent(session, 1000), 'home');
  }
});

test('an invite or ordinary sign-in clears an earlier Create or Join choice', () => {
  const session = storage();
  for (const entry of ['invite', 'home']) {
    rememberEntryIntent(session, 'create', 1000);
    rememberEntryIntent(session, entry, 1000);
    assert.equal(takeEntryIntent(session, 1000), 'home');
  }
});
