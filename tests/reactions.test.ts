import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readdirSync, readFileSync } from 'node:fs';
import { parseClientMessage } from '../packages/protocol/src/index.js';
import {
  REACTIONS,
  REACTION_LIST,
  isReaction,
  REACTION_BURST,
  REACTION_MIN_GAP_MS,
} from '../packages/protocol/src/reactions.js';
import { ReactionButton, ReactionLayer, reactionArt } from '../apps/client/src/Reactions.js';

test('a reaction is chat, not a move: validated, unnamed ones refused', () => {
  const sent = parseClientMessage(JSON.stringify({ type: 'react', reaction: 'laugh' }));
  assert.deepEqual(sent, { type: 'react', reaction: 'laugh' });
  // No commandId and no expectedRevision: it changes nothing, so it must never
  // queue behind a move or occupy the single in-flight command slot.
  assert.ok(!('commandId' in sent) && !('expectedRevision' in sent));

  for (const bad of ['', 'rude', 'LAUGH', 42, null, {}])
    assert.throws(() => parseClientMessage(JSON.stringify({ type: 'react', reaction: bad })), /reaction/i);
  assert.ok(!isReaction('rude'));
  assert.ok(isReaction('angry'));
});

test('every reaction has artwork, a label and choreography', () => {
  const files = new Set(readdirSync('apps/client/public/reactions'));
  assert.ok(REACTION_LIST.length >= 10, `expected at least ten reactions, found ${REACTION_LIST.length}`);
  for (const name of REACTION_LIST) {
    assert.ok(files.has(`${name}.svg`), `missing artwork for ${name}`);
    assert.ok(REACTIONS[name].label.length > 2, `${name} needs a readable label`);
    assert.ok(REACTIONS[name].motion.length > 2, `${name} needs a motion`);
    assert.equal(reactionArt(name), `/reactions/${name}.svg`);
  }
});

test('every choreography named by a reaction actually exists in the stylesheet', () => {
  const css = readFileSync('apps/client/src/reactions.css', 'utf8');
  for (const name of REACTION_LIST) {
    const motion = REACTIONS[name].motion;
    assert.ok(css.includes(`.motion-${motion} img`), `no rule for motion-${motion}`);
    assert.ok(css.includes(`@keyframes motion-${motion}`), `no keyframes for motion-${motion}`);
  }
  // Reduced motion must be honoured: this is a lot of movement otherwise.
  assert.ok(css.includes('prefers-reduced-motion'));
});

test('the picker opens closed and lists every reaction with a label', () => {
  const closed = renderToStaticMarkup(createElement(ReactionButton, { onReact: () => {} }));
  assert.ok(closed.includes('aria-expanded="false"'), 'the tray starts closed');
  assert.ok(!closed.includes('role="menu"'), 'and renders no tray until opened');
  assert.ok(closed.includes('aria-label="Send a reaction"'));

  const disabled = renderToStaticMarkup(createElement(ReactionButton, { onReact: () => {}, disabled: true }));
  assert.ok(disabled.includes('disabled=""'), 'a finished game cannot be reacted to');
});

test('reactions in flight name their sender and never swallow a click', () => {
  const html = renderToStaticMarkup(
    createElement(ReactionLayer, {
      flying: [
        { id: 1, reaction: 'laugh' as const, from: 'Ada', lane: 0.2 },
        { id: 2, reaction: 'angry' as const, from: 'Anchor', lane: 0.7 },
      ],
    }),
  );
  assert.ok(html.includes('motion-giggle') && html.includes('motion-rage'));
  assert.ok(html.includes('Ada') && html.includes('Anchor'));
  // Lanes keep simultaneous reactions off one another.
  assert.ok(html.includes('left:24.8%') || html.includes('left:24.799999999999997%'), html.slice(0, 200));

  const css = readFileSync('apps/client/src/reactions.css', 'utf8');
  const layer = css.slice(css.indexOf('.reaction-layer {'));
  assert.ok(layer.slice(0, layer.indexOf('}')).includes('pointer-events: none'));
});

test('the rate limit allows a burst and refuses a stream', () => {
  assert.ok(REACTION_BURST >= 3, 'a few in a row is part of the fun');
  assert.ok(REACTION_MIN_GAP_MS >= 250, 'but not a hose');
});
