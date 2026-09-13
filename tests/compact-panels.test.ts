import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuickRules } from '../apps/client/src/QuickRules.js';
import { ConnectionPanel } from '../apps/client/src/ConnectionPanel.js';
import { initialMetrics } from '../apps/client/src/connection.js';
import { COSTS, RESOURCES, RESOURCE_NAMES } from '../packages/rules/src/index.js';

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
function findButton(node: ReactNode): ReactElement<{ onClick: () => void; disabled: boolean }> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const button = findButton(child);
      if (button) return button;
    }
  }
  if (!isValidElement(node)) return undefined;
  if (node.type === 'button') return node as ReactElement<{ onClick: () => void; disabled: boolean }>;
  return findButton((node.props as { children?: ReactNode }).children);
}

test('quick rules name each scoring piece and explain both award thresholds instead of relying on symbols', () => {
  const html = renderToStaticMarkup(createElement(QuickRules)),
    visible = text(html);
  assert.ok(visible.includes('First to 10 points'));
  assert.ok(visible.includes('Reach the goal on your own turn to win.'));
  assert.match(visible, /Settlement 1 point/);
  assert.match(visible, /City 2 points total/);
  assert.match(visible, /Longest Road · \+2 points Longest continuous route, at least 5 roads/);
  assert.match(visible, /Largest Army · \+2 points Most Knights played, at least 3/);
  assert.match(visible, /over 7 resources discards half, rounded down/);
  assert.match(visible, /Upgrade your own settlement to a city/);
  assert.match(visible, /Victory Point cards count immediately/);
  assert.equal([...html.matchAll(/aria-expanded="true"/g)].length, 1);
  assert.equal([...html.matchAll(/aria-expanded="false"/g)].length, 4);
  assert.equal([...html.matchAll(/inert="" aria-hidden="true"/g)].length, 4);
});

test('build recipes identify the action and explicitly group the exact resource payment', () => {
  const html = renderToStaticMarkup(createElement(QuickRules));
  const recipes = html.match(/<div class="guide-recipe">[\s\S]*?<\/dd><\/div>/g) ?? [];
  assert.equal(recipes.length, 4);
  assert.ok(text(html).includes('Build &amp; buy'));
  const kinds = ['road', 'settlement', 'city', 'developmentCard'] as const;
  const labels = ['Road', 'Settlement', 'City upgrade', 'Development card'];
  for (const [i, recipe] of recipes.entries()) {
    assert.ok(text(recipe).includes(`${labels[i]} Pay`));
    const cost = COSTS[kinds[i]!];
    for (const resource of RESOURCES) {
      const label = `aria-label="${cost[resource]} ${RESOURCE_NAMES[resource]}"`;
      assert.equal(recipe.includes(label), cost[resource] > 0);
      if (cost[resource] > 0)
        assert.ok(
          recipe.includes(`${label} data-count="${cost[resource]}"`),
          'hiding redundant visual ones retains the complete accessible payment',
        );
    }
    assert.equal(
      [...recipe.matchAll(/aria-label="\d+ /g)].length,
      RESOURCES.filter((resource) => cost[resource] > 0).length,
    );
  }
});

test('connection refresh remains the original sync action, is disabled offline, and keeps metrics and recovery information intact', () => {
  const metrics = {
    ...initialMetrics(),
    serverRevision: 14,
    reconnects: 2,
    samples: [
      { at: 1, rtt: 40 },
      { at: 2, rtt: null },
      { at: 3, rtt: 60 },
    ],
  };
  let calls = 0;
  const onSync = () => {
    calls++;
  };
  const props = { metrics, status: 'connected' as const, revision: 14, pending: false, onSync };
  const button = findButton(ConnectionPanel(props))!;
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  assert.equal(calls, 1);
  const html = renderToStaticMarkup(createElement(ConnectionPanel, props));
  assert.match(html, /aria-label="Refresh game state from the server"/);
  assert.match(html, /class="sync-refresh"/);
  assert.ok(text(html).includes('Refresh game'));
  assert.match(
    text(html),
    /Average ping 50 ms Jitter 20 ms Missed probes 1\/3 Reconnects 2 Saved revision 14 Synchronization Up to date/,
  );
  assert.ok(findButton(ConnectionPanel({ ...props, status: 'reconnecting' }))!.props.disabled);
  const recovery = renderToStaticMarkup(
    createElement(ConnectionPanel, {
      ...props,
      metrics: { ...metrics, syncIssue: 'Checking a missing road' },
    }),
  );
  assert.match(recovery, /role="alert"/);
  assert.ok(text(recovery).includes('Your displayed pieces are retained'));
});
