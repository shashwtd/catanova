import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { parseClientMessage } from '../packages/protocol/src/index.js';
import {
  REACTIONS,
  REACTION_LIST,
  isReaction,
  REACTION_BURST,
  REACTION_MIN_GAP_MS,
  reactionAllowedAt,
} from '../packages/protocol/src/reactions.js';
import { ReactionButton, ReactionLayer, scrollEdges } from '../apps/client/src/Reactions.js';
import { ReactionFace } from '../apps/client/src/ReactionArt.js';

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

test('every reaction is drawn here rather than left to the reader s emoji font', () => {
  assert.ok(REACTION_LIST.length >= 10, `expected at least ten reactions, found ${REACTION_LIST.length}`);
  for (const name of REACTION_LIST) {
    const drawn = renderToStaticMarkup(createElement(ReactionFace, { name }));
    assert.ok(drawn.startsWith('<svg'), `${name} has no artwork`);
    // A face is a disc and at least three inked features; anything less is a
    // placeholder rather than an expression.
    assert.ok(/<circle[^>]*r="15"/.test(drawn), `${name} is missing its disc`);
    assert.ok(
      (drawn.match(/<(path|circle|ellipse)/g) ?? []).length >= 5,
      `${name} is too bare to read as a face`,
    );
    // No emoji anywhere: the whole point is that we draw these ourselves.
    assert.ok(!/\p{Extended_Pictographic}/u.test(drawn), `${name} leans on an emoji`);
    assert.ok(REACTIONS[name].label.length > 2, `${name} needs a readable label`);
  }
});

test('every choreography named by a reaction actually exists in the stylesheet', () => {
  const css = readFileSync('apps/client/src/reactions.css', 'utf8');
  for (const name of REACTION_LIST) {
    const motion = REACTIONS[name].motion;
    assert.ok(css.includes(`.motion-${motion} .reaction-face`), `no rule for motion-${motion}`);
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

test('the tray fades an edge only where there is more of the set beyond it', () => {
  // Everything fits: no fade at all. A gradient here would say there is more
  // to scroll to when there is not, which is the one thing it must never do.
  assert.deepEqual(scrollEdges(0, 142, 142), { above: false, below: false });
  // A face still sliding into place leaves a couple of pixels of overflow.
  assert.deepEqual(scrollEdges(0, 144, 142), { above: false, below: false });

  // Clipped: fade below, and nothing above until you have actually moved.
  assert.deepEqual(scrollEdges(0, 300, 142), { above: false, below: true });
  assert.deepEqual(scrollEdges(70, 300, 142), { above: true, below: true });
  // Arrived: the lower fade goes, exactly at the end rather than near it.
  assert.deepEqual(scrollEdges(158, 300, 142), { above: true, below: false });
  assert.deepEqual(scrollEdges(157.5, 300, 142), { above: true, below: false });
});

test('the rate limit allows a burst and then rests, by one shared rule', () => {
  assert.ok(REACTION_BURST >= 3, 'a few in a row is part of the fun');
  assert.ok(REACTION_MIN_GAP_MS >= 250, 'but not a hose');

  assert.ok(reactionAllowedAt([], 10_000), 'the first one always goes');
  assert.ok(!reactionAllowedAt([10_000], 10_000 + REACTION_MIN_GAP_MS - 1), 'too soon after the last');
  assert.ok(reactionAllowedAt([10_000], 10_000 + REACTION_MIN_GAP_MS), 'and fine once the beat has passed');

  // A full burst rests until the oldest falls out of the window.
  const burst = Array.from({ length: REACTION_BURST }, (_, i) => 10_000 + i * REACTION_MIN_GAP_MS);
  const last = burst[burst.length - 1]!;
  assert.ok(!reactionAllowedAt(burst, last + REACTION_MIN_GAP_MS), 'a stream is refused');
  assert.ok(reactionAllowedAt(burst, 10_000 + 6000), 'and allowed again once the window has rolled');
});

test('a reaction face fills its button, and no icon rule quietly shrinks it', () => {
  const reactions = readFileSync('apps/client/src/reactions.css', 'utf8');
  // On a phone the tray is one column exactly as wide as the button it hangs
  // from, so it reads as that button unrolled rather than as a panel near it.
  const phone = reactions.slice(reactions.indexOf('@media (max-width: 700px)'));
  const tray = phone.slice(phone.indexOf('.reaction-tray {'));
  assert.match(tray.slice(0, tray.indexOf('}')), /width: var\(--game-tool-edge[^)]*\);/);
  assert.match(tray.slice(0, tray.indexOf('}')), /padding: 0;/);
  // And the face is the large part of its button: a few pixels of air so they
  // read as separate tokens, not a frame the drawing sits inside.
  const air = (block: string) => Number(block.match(/padding: (\d+)px;/)![1]);
  const phoneChoice = phone.slice(phone.indexOf('.reaction-choice {'));
  assert.ok(air(phoneChoice.slice(0, phoneChoice.indexOf('}'))) <= 8);
  const desktop = reactions.slice(0, reactions.indexOf('@media (max-width: 700px)'));
  const wide = desktop.slice(desktop.indexOf('.reaction-choice {'));
  const box = wide.slice(0, wide.indexOf('}'));
  const size = Number(box.match(/width: (\d+)px;/)![1]);
  assert.ok(size - air(box) * 2 >= size * 0.6, 'the drawing is most of the button');

  // The rail shrinks every icon on a small screen. A face is not an icon on a
  // button, it is the whole of one, and that rule was quietly taking each face
  // down to 17px inside a 44px pill — which looked exactly like padding.
  const base = readFileSync('apps/client/src/style.css', 'utf8');
  for (const rule of base.matchAll(/\.side-controls([^{]*)svg([^{]*)\{([^}]*)\}/g)) {
    if (!/width/.test(rule[3]!)) continue;
    const selector = rule[1]! + rule[2]!;
    // Either it says it means icons on buttons — a face's button is a
    // `.reaction-choice`, never an `.icon-button` — or it says so explicitly.
    assert.ok(
      /\.icon-button/.test(selector) || /:not\(\.reaction-face\)/.test(selector),
      `".side-controls${selector}svg" sizes reaction faces too`,
    );
  }
});
