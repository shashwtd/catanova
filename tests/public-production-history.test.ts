import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createGame, emptyHand, gameView, total } from '../packages/rules/src/game.js';
import type { Game } from '../packages/rules/src/game.js';
import { RESOURCES, RESOURCE_NAMES } from '../packages/rules/src/index.js';
const seats = ['Alice', 'Bob', 'Cara'].map((name, i) => ({ id: `p${i}`, name }));
const gains = (before: Game, after: Game) =>
  after.log.filter((e) => e.id >= before.nextLog).map((e) => e.text);
function production() {
  const game = createGame(seats, 82, () => 0.34);
  game.phase = 'roll';
  game.turn = 1;
  const hex = game.board.hexes.find((h) => h.number === 6 && h.terrain !== 'desert')!;
  game.buildings[hex.vertices[0]!] = { player: 'p0', kind: 'city' };
  return { game, hex };
}
test('public receipts record actual resource gains, including cities, robber blocking and bank shortages', () => {
  for (const mode of ['normal', 'robber', 'sole-shortage', 'shared-shortage', 'resigned'] as const) {
    const { game, hex } = production();
    assert.notEqual(hex.terrain, 'desert');
    const resource = hex.terrain as keyof typeof RESOURCE_NAMES;
    if (mode === 'robber') game.robber = hex.id;
    if (mode.includes('shortage')) {
      game.bank[resource] = 1;
      game.players[2]!.hand[resource] = 18;
    }
    if (mode === 'shared-shortage') game.buildings[hex.vertices[2]!] = { player: 'p1', kind: 'settlement' };
    if (mode === 'resigned') {
      game.players[0]!.resigned = true;
      game.active = 1;
    }
    const next = applyAction(game, seats[game.active]!.id, { kind: 'roll' }, () => 0.34);
    const lines = gains(game, next);
    for (let i = 0; i < game.players.length; i++) {
      const before = game.players[i]!,
        after = next.players[i]!;
      const delta = Object.fromEntries(
        RESOURCES.map((r) => [r, after.hand[r] - before.hand[r]]),
      ) as typeof before.hand;
      const receipt = lines.filter((line) => line.startsWith(`${after.name} received `));
      if (total(delta)) {
        const amounts = RESOURCES.filter((r) => delta[r])
          .map((r) => `${delta[r]} ${RESOURCE_NAMES[r]}`)
          .join(', ');
        assert.deepEqual(receipt, [`${after.name} received ${amounts}.`], mode);
      } else assert.deepEqual(receipt, [], mode);
    }
    if (mode === 'shared-shortage') assert.ok(lines.some((line) => line.includes('The bank is short')));
    if (['robber', 'shared-shortage', 'resigned'].includes(mode))
      assert.ok(lines.includes('No resources produced.'));
    assert.deepEqual(
      gameView(next, 'p1').log,
      gameView(next, 'p2').log,
      'all players see the same public receipts',
    );
  }
});
test('starting resources are logged only for each second settlement', () => {
  let game = createGame(seats, 82, () => 0.34);
  let receipts = 0;
  while (!game.turn) {
    const player = game.players[game.active]!;
    const legal = gameView(game, player.id).legal;
    const settlement = game.phase === 'setupSettlement';
    const before = game;
    game = applyAction(
      game,
      player.id,
      settlement
        ? { kind: 'settlement', vertex: legal.settlements[0]! }
        : { kind: 'road', edge: legal.roads[0]! },
      () => 0.34,
    );
    const lines = gains(before, game).filter((line) => line.includes('received'));
    if (settlement && before.setupIndex >= seats.length) {
      assert.equal(lines.length, 1);
      assert.match(lines[0]!, /from the starting settlement\.$/);
      receipts++;
    } else assert.deepEqual(lines, []);
  }
  assert.equal(receipts, seats.length);
});
test('robber history records the victim but keeps stolen resource identity private', () => {
  const { game, hex } = production();
  game.phase = 'robber';
  game.buildings = { [hex.vertices[0]!]: { player: 'p1', kind: 'settlement' } };
  game.players[1]!.hand = { ...emptyHand(), ore: 1 };
  game.bank.ore--;
  const next = applyAction(game, 'p0', { kind: 'robber', hex: hex.id, victim: 'p1' }, () => 0.34);
  const lines = gains(game, next);
  assert.ok(lines.includes('Alice moved the robber and stole a card from Bob.'));
  assert.ok(!lines.some((line) => line.includes('received') || line.includes('Rock')));
});
