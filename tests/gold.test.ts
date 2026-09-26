/**
 * Gold fields in Open Sea: section 9 of docs/RULEBOOK-OPEN-SEA.md, with the starting resources of section 5.5.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { seededRandom } from '../packages/rules/src/board.js';
import { emptyHand, total } from '../packages/rules/src/game.js';
import type { Building, Hand } from '../packages/rules/src/game.js';
import { RESOURCES } from '../packages/rules/src/index.js';
import {
  GOLD_PICK_SECONDS,
  applyGoldPick,
  defaultGoldPick,
  defaultGoldPicks,
  goldOwedForRoll,
  goldPickIssue,
  goldPickText,
  goldPickTypes,
  remainingGoldOwed,
  startingResources,
} from '../packages/rules/src/gold.js';
import type { GoldOwed } from '../packages/rules/src/gold.js';
import { pirateHexes, producedResource, robberHexes } from '../packages/rules/src/sea.js';
import type { SeaBoard } from '../packages/rules/src/sea.js';
import { corner, sketch } from './sea-boards.js';

const hand = (cards: Partial<Hand> = {}): Hand => ({ ...emptyHand(), ...cards });
const full = () => hand({ wood: 19, brick: 19, sheep: 19, wheat: 19, ore: 19 });
/** Mountains on the main island and a gold field on a small island, both numbered 10, and a desert. */
function goldBoard() {
  const sk = sketch(' . . . . . . .', '. . R D . g . .', ' . . . . . g .', '. . . . . . . .');
  const [mountains, , gold, gold2] = sk.board.hexes.filter((h) => h.terrain !== 'sea');
  mountains!.number = 10;
  gold!.number = 10;
  gold2!.number = 4;
  return { board: sk.board, mountains: mountains!.id, gold: gold!.id, gold2: gold2!.id };
}
const seats = (...ids: string[]) => ids.map((id) => ({ id, hand: emptyHand() }));
/** Classic section 5, as game.ts's produce applies it, with producedResource saying what each hex pays. */
function ordinaryProduction(
  g: { board: SeaBoard; buildings: Record<number, Building>; robber: number; bank: Hand },
  players: string[],
  roll: number,
) {
  const owed = new Map(players.map((p) => [p, emptyHand()]));
  for (const hex of g.board.hexes) {
    const resource = producedResource(hex);
    if (hex.number !== roll || hex.id === g.robber || !resource) continue;
    for (const v of hex.vertices) {
      const building = g.buildings[v];
      if (building) owed.get(building.player)![resource] += building.kind === 'city' ? 2 : 1;
    }
  }
  const bank = { ...g.bank },
    received = new Map(players.map((p) => [p, emptyHand()]));
  for (const r of RESOURCES) {
    const takers = players.filter((p) => owed.get(p)![r]);
    if (takers.reduce((n, p) => n + owed.get(p)![r], 0) > bank[r] && takers.length > 1) continue;
    for (const p of takers) {
      const n = Math.min(owed.get(p)![r], bank[r]);
      received.get(p)![r] += n;
      bank[r] -= n;
    }
  }
  return { bank, received };
}

test('§9.1 a gold field pays each settlement 1 pick and each city 2, unless the robber is on it', () => {
  const { board, gold, gold2 } = goldBoard();
  const buildings: Record<number, Building> = {
    [corner(board, gold, 'n')]: { player: 'blue', kind: 'city' },
    [corner(board, gold, 'se')]: { player: 'red', kind: 'settlement' },
    [corner(board, gold, 'sw')]: { player: 'green', kind: 'settlement' },
  };
  const players = [{ id: 'red' }, { id: 'blue' }, { id: 'green' }];
  const g = { board, buildings, robber: -1, players, active: 0 };
  assert.deepEqual(goldOwedForRoll(g, 10), [
    { player: 'red', picks: 1 },
    { player: 'blue', picks: 2 },
    { player: 'green', picks: 1 },
  ]);
  assert.deepEqual(goldOwedForRoll(g, 9), []);
  assert.deepEqual(goldOwedForRoll({ ...g, robber: gold }, 10), [], 'the robber stops a gold field');
  assert.deepEqual(
    goldOwedForRoll({ ...g, players: [{ id: 'red' }, { id: 'blue', resigned: true }, { id: 'green' }] }, 10),
    [
      { player: 'red', picks: 1 },
      { player: 'green', picks: 1 },
    ],
    'a resigned player’s buildings stop producing',
  );
  // Red's settlement also touches the second gold field; its number pays red alone.
  assert.ok(board.hexes[gold2]!.vertices.includes(corner(board, gold, 'se')));
  assert.deepEqual(goldOwedForRoll(g, 4), [{ player: 'red', picks: 1 }]);
  // Gold is not a resource: no card, no ordinary production.
  assert.equal(producedResource(board.hexes[gold]!), null);
  assert.ok(!(RESOURCES as readonly string[]).includes('gold'));
});

test('§9.2 players pick one at a time in turn order from the player on turn, from the bank as it stands', () => {
  const { board, gold } = goldBoard();
  const buildings: Record<number, Building> = {
    [corner(board, gold, 'n')]: { player: 'blue', kind: 'city' },
    [corner(board, gold, 'se')]: { player: 'red', kind: 'settlement' },
    [corner(board, gold, 'sw')]: { player: 'green', kind: 'settlement' },
  };
  const players = seats('red', 'blue', 'green');
  let g = {
    bank: hand({ wood: 3, ore: 1 }),
    players,
    goldOwed: goldOwedForRoll({ board, buildings, robber: -1, players, active: 2 }, 10),
  };
  assert.deepEqual(
    g.goldOwed.map((o) => o.player),
    ['green', 'red', 'blue'],
    'green is on turn and picks first',
  );
  assert.match(goldPickIssue(g, 'red', hand({ wood: 1 }))!, /not your turn/);
  g = applyGoldPick(g, 'green', hand({ ore: 1 }));
  assert.deepEqual(goldPickTypes(g.bank), ['wood'], 'the picker offers only what the bank still has');
  assert.match(goldPickIssue(g, 'red', hand({ ore: 1 }))!, /bank does not have/);
  assert.match(goldPickIssue(g, 'red', hand({ wood: 2 }))!, /Choose 1 resource/);
  g = applyGoldPick(g, 'red', hand({ wood: 1 }));
  // Blue's city is owed 2 and may take them one at a time.
  assert.deepEqual(g.goldOwed, [{ player: 'blue', picks: 2 }]);
  g = applyGoldPick(g, 'blue', hand({ wood: 1 }));
  assert.deepEqual(g.goldOwed, [{ player: 'blue', picks: 1 }]);
  g = applyGoldPick(g, 'blue', hand({ wood: 1 }));
  assert.deepEqual(g.goldOwed, []);
  assert.deepEqual(
    g.players.map((p) => p.hand),
    [hand({ wood: 1 }), hand({ wood: 2 }), hand({ ore: 1 })],
  );
  assert.deepEqual(g.bank, emptyHand());
  assert.throws(() => applyGoldPick(g, 'blue', hand({ wood: 1 })), /not your turn/);
});

test('§9.2 the example: short of Rock, the mountains pay nobody, then gold picks from what is left', () => {
  const { board, mountains, gold } = goldBoard();
  const buildings: Record<number, Building> = {
    [corner(board, mountains, 'n')]: { player: 'blue', kind: 'city' },
    [corner(board, mountains, 's')]: { player: 'red', kind: 'settlement' },
    [corner(board, gold, 'n')]: { player: 'green', kind: 'settlement' },
  };
  const players = ['red', 'blue', 'green'];
  const table = { board, buildings, robber: -1, bank: { ...full(), ore: 2 } };
  // Ordinary hexes first: 3 Rock owed, 2 in the bank, so nobody receives Rock. Gold takes no part.
  const { bank, received } = ordinaryProduction(table, players, 10);
  assert.equal(bank.ore, 2);
  for (const p of players) assert.equal(total(received.get(p)!), 0);
  // Nothing owed from gold counted toward the shortage, and green's pick comes from the 2 Rock left.
  const goldOwed = goldOwedForRoll({ ...table, players: players.map((id) => ({ id })), active: 1 }, 10);
  assert.deepEqual(goldOwed, [{ player: 'green', picks: 1 }]);
  const after = applyGoldPick({ bank, goldOwed, players: seats(...players) }, 'green', hand({ ore: 1 }));
  assert.equal(after.bank.ore, 1);
  assert.deepEqual(after.players[2]!.hand, hand({ ore: 1 }));
});

test('§9.2 picks from an empty bank lapse and are not owed later, and picks cannot be declined', () => {
  const players = seats('red', 'blue');
  let g = {
    bank: hand({ wood: 1, brick: 1 }),
    players,
    goldOwed: [
      { player: 'red', picks: 3 },
      { player: 'blue', picks: 1 },
    ],
  };
  assert.match(goldPickIssue(g, 'red', emptyHand())!, /Choose from 1 to 3/);
  assert.match(goldPickIssue(g, 'red', hand({ wood: 2 }))!, /bank does not have/);
  g = applyGoldPick(g, 'red', hand({ wood: 1, brick: 1 }));
  assert.deepEqual(g.goldOwed, [], 'red’s third pick and blue’s pick lapse with the bank empty');
  assert.deepEqual(remainingGoldOwed([{ player: 'blue', picks: 1 }], emptyHand(), players), []);
  assert.match(goldPickIssue(g, 'blue', hand({ wood: 1 }))!, /not your turn/);
});

test('§9.2 a player who resigns before picking loses their picks; the rest pick from the bank as it stands', () => {
  const players = [
    { id: 'red', hand: hand({ ore: 4 }) },
    { id: 'blue', hand: emptyHand() },
    { id: 'green', hand: emptyHand() },
  ];
  const owed: GoldOwed[] = [
    { player: 'red', picks: 2 },
    { player: 'blue', picks: 1 },
    { player: 'green', picks: 1 },
  ];
  // Red, owed and on turn, resigns: the hand goes back to the bank, and the picks go on without red.
  const bank = hand({ ore: 4 });
  const after = players.map((p) => (p.id === 'red' ? { ...p, hand: emptyHand(), resigned: true } : p));
  const goldOwed = remainingGoldOwed(owed, bank, after);
  assert.deepEqual(goldOwed, owed.slice(1));
  const g = applyGoldPick({ bank, players: after, goldOwed }, 'blue', hand({ ore: 1 }));
  assert.deepEqual(g.goldOwed, [{ player: 'green', picks: 1 }]);
  assert.equal(g.bank.ore, 3);
});

test('§9.3 and §5.5 a second starting settlement takes a card per producing hex and a pick per gold field', () => {
  const { board, mountains, gold } = goldBoard();
  // Between the two gold fields and the sea.
  const between = board.hexes[gold]!.vertices.find(
    (v) =>
      board.vertices[v]!.hexes.length === 3 &&
      board.vertices[v]!.hexes.filter((h) => board.hexes[h]!.terrain === 'gold').length === 2,
  )!;
  assert.deepEqual(startingResources(board, between), { resources: emptyHand(), goldPicks: 2 });
  // The mountains and the desert: a desert or the sea gives nothing.
  const shared = board.hexes[mountains]!.vertices.find((v) =>
    board.vertices[v]!.hexes.some((h) => board.hexes[h]!.terrain === 'desert'),
  )!;
  assert.deepEqual(startingResources(board, shared), { resources: hand({ ore: 1 }), goldPicks: 0 });
});

test('§9.4 the robber stops a gold field like any land, and the pirate never stands on one', () => {
  const { board, gold } = goldBoard();
  assert.ok(robberHexes(board, -1).includes(gold));
  assert.ok(!pirateHexes(board).includes(gold));
});

test('§9.5 when the 20-second clock runs out, each pick is the type held fewest of that the bank has', () => {
  assert.equal(GOLD_PICK_SECONDS, 20);
  // The book's example: 2 Timber, 0 Clay, 1 Sheep, 0 Hay, 3 Rock, and the bank has every type.
  const green = hand({ wood: 2, sheep: 1, ore: 3 });
  assert.equal(defaultGoldPick(green, full()), 'brick');
  assert.deepEqual(defaultGoldPicks(green, full(), 2), hand({ brick: 1, wheat: 1 }), 'Clay, then Hay');
  // Only types the bank still holds, ties in the order Timber, Clay, Sheep, Hay, Rock.
  assert.equal(defaultGoldPick(green, { ...full(), brick: 0 }), 'wheat');
  assert.equal(defaultGoldPick(emptyHand(), full()), 'wood');
  assert.equal(defaultGoldPick(green, hand({ ore: 1 })), 'ore');
  assert.equal(defaultGoldPick(green, emptyHand()), null);
  // Counting the cards just taken, and stopping when the bank runs dry.
  assert.deepEqual(
    defaultGoldPicks(emptyHand(), full(), 6),
    hand({ wood: 2, brick: 1, sheep: 1, wheat: 1, ore: 1 }),
  );
  assert.deepEqual(defaultGoldPicks(emptyHand(), hand({ sheep: 1 }), 3), hand({ sheep: 1 }));
});

test('§14 gold picks are public once made: the log names the cards', () => {
  assert.equal(
    goldPickText('Green', hand({ ore: 1, wheat: 1 })),
    'Green took 1 Hay, 1 Rock from the bank for gold.',
  );
});

test('§9 gold picks, made or defaulted in random games, conserve every card and never outrun the bank', () => {
  const random = seededRandom(19);
  const draw = (n: number) => Math.floor(random() * n);
  let picks = 0,
    lapsed = 0;
  for (let round = 0; round < 400; round++) {
    const ids = ['red', 'blue', 'green', 'white'].slice(0, 3 + draw(2));
    // Deal the 19 cards of each type between the bank and the hands.
    const bank = emptyHand(),
      players = ids.map((id) => ({ id, hand: emptyHand(), resigned: false }));
    for (const r of RESOURCES)
      for (let n = 0; n < 19; n++) {
        const where = draw(ids.length + 2);
        if (where < ids.length) players[where]!.hand[r]++;
        else bank[r]++;
      }
    let g = {
      bank,
      players,
      goldOwed: ids.filter(() => random() < 0.6).map((player) => ({ player, picks: 1 + draw(4) })),
    };
    const owedAtStart = g.goldOwed.reduce((n, o) => n + o.picks, 0);
    let taken = 0;
    while (g.goldOwed.length) {
      const { player, picks: owed } = g.goldOwed[0]!;
      if (random() < 0.05) {
        // A resignation, which hands the cards back.
        const p = g.players.find((other) => other.id === player)!;
        for (const r of RESOURCES) g.bank[r] += p.hand[r];
        g = {
          ...g,
          players: g.players.map((other) =>
            other === p ? { ...p, hand: emptyHand(), resigned: true } : other,
          ),
        };
        g.goldOwed = remainingGoldOwed(g.goldOwed, g.bank, g.players);
        continue;
      }
      const me = g.players.find((p) => p.id === player)!;
      let choice = defaultGoldPicks(me.hand, g.bank, 1 + draw(owed));
      if (random() < 0.5) {
        choice = emptyHand();
        for (let n = 1 + draw(owed); n > 0; n--) {
          const types = RESOURCES.filter((r) => g.bank[r] > choice[r]);
          if (!types.length) break;
          choice[types[draw(types.length)]!]++;
        }
      }
      assert.equal(goldPickIssue(g, player, choice), null);
      const before = g.bank;
      g = applyGoldPick(g, player, choice);
      picks++;
      taken += total(choice);
      for (const r of RESOURCES) {
        assert.ok(choice[r] <= before[r], 'never more than the bank held');
        assert.ok(g.bank[r] >= 0);
        const inHands = g.players.reduce((n, p) => n + p.hand[r], 0);
        assert.equal(g.bank[r] + inHands, 19, `${r} is conserved`);
      }
      if (!total(g.bank)) assert.deepEqual(g.goldOwed, [], 'an empty bank ends the picks');
    }
    if (taken < owedAtStart) lapsed++;
  }
  assert.ok(picks > 500 && lapsed > 20, `${picks} picks, ${lapsed} rounds with lapses`);
});
