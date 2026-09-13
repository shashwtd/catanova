import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GAME_ICON_NAMES, GameIcon } from '../apps/client/src/GameIcons.js';
import {
  PAINTED_ICONS,
  ICON_ATLAS,
  ICON_ATLAS_WIDTH,
  ICON_ATLAS_HEIGHT,
} from '../apps/client/src/painted-icons.js';
import { GameTools } from '../apps/client/src/GameTools.js';

test('all painted icons share a versioned atlas below 100 KB and have distinct in-bounds cells', async () => {
  assert.match(ICON_ATLAS, /\.[a-f0-9]{12}\.webp$/);
  assert.ok((await stat(`apps/client/public${ICON_ATLAS}`)).size < 100_000);
  assert.equal(
    new Set(Object.values(PAINTED_ICONS).map((cell) => cell.join(','))).size,
    GAME_ICON_NAMES.length,
  );
  for (const name of GAME_ICON_NAMES) {
    const [x, y] = PAINTED_ICONS[name];
    assert.ok(x >= 0 && y >= 0 && x + 72 <= ICON_ATLAS_WIDTH && y + 72 <= ICON_ATLAS_HEIGHT, name);
    const html = renderToStaticMarkup(createElement(GameIcon, { name }));
    assert.ok(html.includes(ICON_ATLAS));
    assert.match(html, /overflow="hidden"/);
  }
});

test('closed tools are inert and linked to an accessible trigger, with fullscreen outside the menu', () => {
  const html = renderToStaticMarkup(
    createElement(GameTools, {
      connected: true,
      fullscreen: false,
      onPanel() {},
      onFullscreen() {},
      onLeave() {},
    }),
  );
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /inert=""/);
  assert.match(html, /aria-controls="([^"]+)"/);
  const fullscreen = html.indexOf('fullscreen-control');
  assert.ok(fullscreen > 0 && fullscreen < html.indexOf('game-tools-menu'));
});
