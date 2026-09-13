import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parsePreferences } from '../apps/client/src/preferences.js';
import { BOARD_THEMES } from '../apps/client/src/board-theme.js';
import { HiddenResource } from '../apps/client/src/HiddenResource.js';
import { GameSettings } from '../apps/client/src/GameSettings.js';

test('new and existing players default to Storybook; a saved Classic preference survives parsing', () => {
  for (const saved of [null, {}, { sound: false }, { boardTheme: 'invalid' }])
    assert.equal(parsePreferences(saved).boardTheme, 'storybook');
  const classic = parsePreferences({ boardTheme: 'classic', volume: 0.2 });
  assert.equal(parsePreferences(JSON.parse(JSON.stringify(classic))).boardTheme, 'classic');
  assert.equal(classic.volume, 0.2);
});

test('both personal themes have versioned atlases and stay within the texture budget', async () => {
  for (const theme of Object.values(BOARD_THEMES)) {
    let bytes = 0;
    for (const path of [theme.terrain, theme.environment]) {
      assert.match(path, /\.[a-f0-9]{12}\.webp$/);
      bytes += (await stat(`apps/client/public${path}`)).size;
    }
    assert.ok(bytes < 1_500_000);
  }
});

test('personal appearance remains selectable without host privileges or a room', () => {
  const html = renderToStaticMarkup(
    createElement(GameSettings, {
      preferences: parsePreferences({ boardTheme: 'classic' }),
      update() {},
      room: null,
      busy: false,
      async save() {},
      previewSound() {},
    }),
  );
  assert.match(html, /Only changes your view/);
  const radios = html.match(/<input[^>]*name="board-theme"[^>]*>/g)!;
  assert.equal(radios.length, 2);
  assert.ok(!radios[0]!.includes('checked'));
  assert.ok(radios[1]!.includes('checked'));
  assert.ok(radios.every((radio) => !radio.includes('disabled')));
});

test('private resource feedback identifies an unknown resource without development art', () => {
  const html = renderToStaticMarkup(createElement(HiddenResource));
  assert.match(html, /aria-label="Hidden resource"/);
  assert.ok(!html.includes('development'));
  assert.ok(!html.includes('ore') && !html.includes('wheat'));
});
