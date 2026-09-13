import test from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameIcon } from '../apps/client/src/GameIcons.js';
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
    Object.keys(PAINTED_ICONS).length,
  );
  for (const [name, [x, y]] of Object.entries(PAINTED_ICONS)) {
    assert.ok(x >= 0 && y >= 0 && x + 72 <= ICON_ATLAS_WIDTH && y + 72 <= ICON_ATLAS_HEIGHT, name);
  }
});

test('closed tools are inert and linked to an accessible trigger, with fullscreen outside the menu', () => {
  const html = renderToStaticMarkup(
    createElement(GameTools, {
      fullscreen: false,
      onPanel() {},
      onFullscreen() {},
      onLeave() {},
    }),
  );
  assert.match(html, /aria-expanded="false"/);
  assert.ok(!html.includes('aria-label="Connection"'));
  assert.ok(!html.includes('aria-label="Game rules"'));
  assert.match(html, /aria-label="How to play"/);
  assert.match(html, /inert=""/);
  assert.match(html, /aria-controls="([^"]+)"/);
  const fullscreen = html.indexOf('fullscreen-control');
  assert.ok(fullscreen > 0 && fullscreen < html.indexOf('game-tools-menu'));
});

test('painted game symbols stay intact while utility controls use contextual SVG paths', () => {
  for (const name of [
    'trophy',
    'cards',
    'development',
    'road-award',
    'army-award',
    'fullscreen',
    'trade',
    'help',
    'check',
  ] as const) {
    assert.ok(renderToStaticMarkup(createElement(GameIcon, { name })).includes(ICON_ATLAS));
  }
  for (const name of [
    'settings',
    'invite',
    'edit',
    'share',
    'link',
    'copy',
    'join',
    'logout',
    'music',
    'history',
    'defeat',
    'light-check',
    'light-close',
    'next-turn',
    'exchange',
  ] as const) {
    const html = renderToStaticMarkup(createElement(GameIcon, { name }));
    assert.match(html, /stroke="currentColor"/);
    assert.ok(!html.includes('<image'));
  }
});
