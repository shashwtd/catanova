/**
 * What a player watching the table saw happen between two moments.
 *
 * This is the only code in the brain that looks at a real game with its hidden
 * cards, and its job is to throw the hidden part away. It compares two
 * consecutive states and says what everybody could see: who gained and spent
 * what, who stole from whom (but not what, unless the viewer was one of the two),
 * which development card was played, who bought one. `tests/bot-brain.test.ts`
 * checks that two games differing only in the stolen card give the same facts to
 * everyone else.
 *
 * The same comparison names the moments a bot might react to: a seven, a steal,
 * a city, an award changing hands, a win.
 */

import { RESOURCES } from '../../../rules/src/index.js';
import type { Resource } from '../../../rules/src/index.js';
import { score } from '../../../rules/src/game.js';
import type { CardKind, Game, Hand } from '../../../rules/src/game.js';
import type { PublicFact } from './belief.js';
import { emptyHand, handSize, minus } from './table.js';

export type TableEvent =
  | { kind: 'roll'; player: string; total: number }
  | { kind: 'discard'; player: string; count: number }
  | { kind: 'steal'; thief: string; victim: string }
  | { kind: 'robber'; player: string; hex: number; blocks: string[] }
  | { kind: 'build'; player: string; what: 'settlement' | 'city' | 'road' }
  | { kind: 'card'; player: string; card: CardKind }
  | { kind: 'monopoly'; player: string; resource: Resource; taken: Record<string, number> }
  | { kind: 'award'; award: 'longestRoad' | 'largestArmy'; from: string | null; to: string | null }
  | { kind: 'trade'; players: [string, string] }
  | { kind: 'declined'; maker: string; by: string }
  | { kind: 'offer'; player: string }
  | { kind: 'points'; player: string; points: number }
  | { kind: 'win'; player: string };

type Pair = { facts: PublicFact[]; events: TableEvent[] };

export function observe(before: Game, after: Game, viewer: string): Pair {
  const facts: PublicFact[] = [];
  const events: TableEvent[] = [];
  const delta = new Map<string, Hand>();
  for (const p of after.players) {
    const was = before.players.find((q) => q.id === p.id);
    delta.set(p.id, was ? minus(p.hand, was.hand) : emptyHand());
  }
  const active = before.players[before.active]?.id ?? '';

  // Dice.
  if (before.phase === 'roll' && after.dice && (after.phase !== 'roll' || after.turn !== before.turn))
    events.push({ kind: 'roll', player: active, total: after.dice[0] + after.dice[1] });

  // Discards: public, cards and all.
  if (before.phase === 'discard')
    for (const [id, d] of delta) if (handSize(d) < 0) events.push({ kind: 'discard', player: id, count: -handSize(d) });

  // A steal: the robber moved and exactly one card went from one player to the thief.
  let steal: { thief: string; victim: string; card: Resource } | null = null;
  if (before.phase === 'robber' && after.robber !== before.robber) {
    const hex = after.board.hexes[after.robber];
    const blocks = [
      ...new Set(
        (hex?.vertices ?? [])
          .map((v) => after.buildings[v]?.player)
          .filter((id): id is string => !!id && id !== active),
      ),
    ];
    events.push({ kind: 'robber', player: active, hex: after.robber, blocks });
    const gained = delta.get(active);
    const victim = [...delta.entries()].find(([id, d]) => id !== active && handSize(d) === -1);
    if (gained && victim && handSize(gained) === 1) {
      const card = RESOURCES.find((r) => gained[r] === 1);
      if (card) steal = { thief: active, victim: victim[0], card };
    }
  }
  if (steal) {
    events.push({ kind: 'steal', thief: steal.thief, victim: steal.victim });
    if (viewer === steal.thief || viewer === steal.victim) {
      // The two of them know what moved.
      facts.push({ kind: 'change', player: steal.thief, delta: delta.get(steal.thief)! });
      facts.push({ kind: 'change', player: steal.victim, delta: delta.get(steal.victim)! });
    } else facts.push({ kind: 'steal', thief: steal.thief, victim: steal.victim });
    delta.set(steal.thief, emptyHand());
    delta.set(steal.victim, emptyHand());
  }

  // Development cards: bought (kind unseen) and played (kind public).
  for (const p of after.players) {
    const was = before.players.find((q) => q.id === p.id);
    if (!was) continue;
    const nowIds = new Set(p.cards.map((c) => c.id));
    const wasIds = new Set(was.cards.map((c) => c.id));
    for (const c of p.cards) if (!wasIds.has(c.id)) facts.push({ kind: 'bought', player: p.id });
    for (const c of was.cards)
      if (!nowIds.has(c.id)) {
        facts.push({ kind: 'played', player: p.id, card: c.kind });
        events.push({ kind: 'card', player: p.id, card: c.kind });
        if (c.kind === 'monopoly') {
          const gained = delta.get(p.id)!;
          const resource = RESOURCES.find((r) => gained[r] > 0);
          if (resource) {
            const taken: Record<string, number> = {};
            for (const [id, d] of delta) if (id !== p.id && d[resource] < 0) taken[id] = -d[resource];
            events.push({ kind: 'monopoly', player: p.id, resource, taken });
            for (const other of after.players)
              if (other.id !== p.id) {
                const d = delta.get(other.id)!;
                if (handSize(d)) facts.push({ kind: 'change', player: other.id, delta: d });
                delta.set(other.id, emptyHand());
                facts.push({ kind: 'none', player: other.id, resource });
              }
          }
        }
      }
  }

  // Everything else that moved cards was seen by everybody.
  for (const [id, d] of delta) if (RESOURCES.some((r) => d[r] !== 0)) facts.push({ kind: 'change', player: id, delta: d });
  for (const p of after.players) facts.push({ kind: 'count', player: p.id, cards: p.cards.length });

  // A trade between two players: two hands moved in opposite directions with the bank untouched.
  const bankSame = RESOURCES.every((r) => before.bank[r] === after.bank[r]);
  if (bankSame && before.phase === 'actions' && after.phase === 'actions') {
    const moved = [...delta.entries()].filter(([, d]) => RESOURCES.some((r) => d[r] !== 0));
    if (moved.length === 2 && RESOURCES.every((r) => moved[0]![1][r] === -moved[1]![1][r]))
      events.push({ kind: 'trade', players: [moved[0]![0], moved[1]![0]] });
  }
  if (before.trade && after.trade && before.trade.id === after.trade.id)
    for (const by of after.trade.declinedBy ?? [])
      if (!before.trade.declinedBy?.includes(by)) events.push({ kind: 'declined', maker: after.trade.player, by });
  if (before.trade && !after.trade && before.phase === 'actions') {
    // An offer that closed because everyone declined.
    for (const p of after.players)
      if (p.id !== before.trade.player && !before.trade.declinedBy?.includes(p.id) && !handSize(delta.get(p.id) ?? emptyHand()))
        if (after.log.some((l) => l.id >= before.nextLog && /everyone declined/.test(l.text)))
          events.push({ kind: 'declined', maker: before.trade.player, by: p.id });
  }

  if (after.trade && after.trade.id !== before.trade?.id) events.push({ kind: 'offer', player: after.trade.player });

  // Buildings.
  for (const [v, b] of Object.entries(after.buildings)) {
    const was = before.buildings[Number(v)];
    if (!was) events.push({ kind: 'build', player: b.player, what: 'settlement' });
    else if (was.kind !== b.kind) events.push({ kind: 'build', player: b.player, what: 'city' });
  }
  for (const [e, owner] of Object.entries(after.roads))
    if (!before.roads[Number(e)]) events.push({ kind: 'build', player: owner, what: 'road' });

  if (before.longestRoad !== after.longestRoad)
    events.push({ kind: 'award', award: 'longestRoad', from: before.longestRoad, to: after.longestRoad });
  if (before.largestArmy !== after.largestArmy)
    events.push({ kind: 'award', award: 'largestArmy', from: before.largestArmy, to: after.largestArmy });

  for (const p of after.players) {
    const was = before.players.find((q) => q.id === p.id);
    const now = score(after, p, false);
    if (was && now !== score(before, was, false)) events.push({ kind: 'points', player: p.id, points: now });
  }
  if (after.winner && !before.winner) events.push({ kind: 'win', player: after.winner });
  return { facts, events };
}
