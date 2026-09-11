import test from 'node:test';
import assert from 'node:assert/strict';
import { TradeSubmission } from '../apps/client/src/trade-submission.js';

const action = { kind: 'cancelTrade' } as const;

test('a refused trade never masquerades as an acknowledgement through nested submitters', async () => {
  const outer = new TradeSubmission(),
    inner = new TradeSubmission();
  assert.equal(await outer.run(action, () => inner.run(action, () => false)), false);
  assert.equal(await outer.run(action, () => inner.run(action, async () => false)), false);
  assert.equal(outer.pending, false);
  assert.equal(inner.pending, false);
  assert.equal(await outer.run(action, () => inner.run(action, async () => true)), true);
});

test('a nested busy trade remains unacknowledged while its original command waits for the server', async () => {
  const outer = new TradeSubmission(),
    inner = new TradeSubmission();
  let accept!: (accepted: boolean) => void,
    calls = 0;
  const original = inner.run(action, () => {
    calls++;
    return new Promise<boolean>((resolve) => {
      accept = resolve;
    });
  });
  assert.equal(
    await outer.run(action, () =>
      inner.run(action, () => {
        calls++;
      }),
    ),
    false,
  );
  assert.equal(calls, 1);
  assert.equal(inner.pending, true);
  accept(true);
  assert.equal(await original, true);
  assert.equal(inner.pending, false);
});

test('a rejected nested trade releases both locks and preserves the error for a safe retry', async () => {
  const outer = new TradeSubmission(),
    inner = new TradeSubmission();
  const failure = new Error('The connection closed');
  await assert.rejects(
    outer.run(action, () =>
      inner.run(action, async () => {
        throw failure;
      }),
    ),
    (error) => error === failure,
  );
  assert.equal(outer.pending, false);
  assert.equal(inner.pending, false);
  assert.equal(await outer.run(action, () => inner.run(action, async () => true)), true);
});
