/**
 * A bot's memory between decisions, and the imagined games it thinks with.
 *
 * `Mind` is what survives from one move to the next: the card counting, the long
 * plan, what it has offered this turn, what it has learnt about each opponent.
 * `imagine` turns what the bot can see into a full game the rules engine can play
 * forward: its own hand and cards as they are, and for every opponent a hand drawn
 * from the counting and development cards drawn from those nobody has seen.
 */

import { DEVELOPMENT_DECK, RESOURCES } from '../../../rules/src/index.js';
import { score } from '../../../rules/src/game.js';
import type { Card, CardKind, Game, GameView, Hand } from '../../../rules/src/game.js';
import { cardChance, newBelief, reconcile, sampleHand, unseenCards } from './belief.js';
import type { Belief } from './belief.js';
import type { Knowledge, Strategy } from './race.js';
import { handSize, income } from './table.js';
import type { Table } from './table.js';

/** What the bot has learnt about how one opponent plays. */
export type Profile = {
  offersSeen: number;
  accepted: number;
  declined: number;
  robbedMe: number;
  /** The bot's offers this player has turned down or ignored in a row, and the turn of the last. */
  refusals?: number;
  refusedTurn?: number;
};

export type Mind = {
  version: 2;
  belief: Belief;
  /** The long game, and the turn it was last chosen. */
  strategy?: Strategy;
  strategyTurn?: number;
  /** Trade offers made this turn, by a key of what was offered, so a refused offer is not repeated. */
  offers: { turn: number; made: string[] };
  /** When the bot's own live offer went up, to know how long it has waited for answers. */
  offerSince?: { tradeId: number; at: number };
  /** Who the bot robbed last, so it does not pick on the same person twice while nobody is ahead. */
  lastVictim?: string;
  profiles: Record<string, Profile>;
  /** When this bot last reacted, and how many times this game. */
  reacted: { at: number; count: number };
  /** Offers made and offers that ended in a trade this game: a table that never trades gets fewer. */
  trading: { made: number; filled: number };
};

export const newMind = (): Mind => ({
  version: 2,
  belief: newBelief(),
  offers: { turn: -1, made: [] },
  profiles: {},
  reacted: { at: Number.MIN_SAFE_INTEGER, count: 0 },
  trading: { made: 0, filled: 0 },
});

export const profileOf = (mind: Mind, id: string): Profile =>
  (mind.profiles[id] ??= { offersSeen: 0, accepted: 0, declined: 0, robbedMe: 0 });

/**
 * A full game to think with, from what this seat can see.
 *
 * The real rules engine plays it forward, so everything the bot imagines follows
 * the real rules. What the bot cannot see is drawn: each opponent's hand from the
 * counting, their development cards and the deck from the cards nobody has seen.
 */
export function imagine(view: GameView, meId: string, mind: Mind, random: () => number): Game {
  const me = view.players.find((p) => p.id === meId);
  const mine = me?.cards ?? [];
  const unseen = unseenCards(mind.belief, mine);
  const pool: CardKind[] = [];
  for (const [kind, n] of Object.entries(unseen)) for (let i = 0; i < n; i++) pool.push(kind as CardKind);
  const draw = (): CardKind => {
    if (!pool.length) return 'knight';
    const at = Math.floor(random() * pool.length);
    return pool.splice(at, 1)[0]!;
  };
  let nextCard = 1;
  const players = view.players.map((p) => {
    let hand: Hand;
    let cards: Card[];
    if (p.hand) {
      hand = { ...p.hand };
      cards = (p.cards ?? []).map((c) => ({ ...c }));
    } else {
      reconcile(mind.belief, p.id, p.resourceCount, income(view as unknown as Table, p.id));
      hand = sampleHand(mind.belief, p.id, random) ?? { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
      // Opponents' cards are drawn, but never as points: their hidden points are
      // counted separately as an expectation, not as a lucky draw.
      cards = Array.from({ length: p.cardCount }, () => {
        let kind = draw();
        if (kind === 'victoryPoint') kind = 'knight';
        return { id: `imagined-${nextCard++}`, kind, boughtTurn: 0 };
      });
    }
    return { id: p.id, name: p.name, hand, cards, knights: p.knights, ...(p.resigned ? { resigned: true } : {}) };
  });
  const deck: CardKind[] = [];
  for (let i = 0; i < view.deckCount; i++) deck.push(draw());
  const { legal: _legal, deckCount: _deckCount, players: _players, ...rest } = view;
  return {
    ...(rest as unknown as Game),
    players,
    deck,
    nextCard: 100_000,
    nextLog: 0,
    nextTrade: (view.trade?.id ?? 0) + 1,
    log: [],
    diceMode: 'classic',
  } as Game;
}

/**
 * What the bot knows or expects about each player's points and cards: its own
 * exactly, everyone else's from the public score plus what their unplayed
 * development cards are likely to be.
 */
export function knowledge(view: GameView, meId: string, mind: Mind) {
  const me = view.players.find((p) => p.id === meId);
  const unseen = unseenCards(mind.belief, me?.cards ?? []);
  const vp = cardChance(unseen, 'victoryPoint'),
    knight = cardChance(unseen, 'knight');
  const cardCount = new Map(view.players.map((p) => [p.id, p.cardCount]));
  return (t: Table) =>
    (id: string): Knowledge => {
      const seat = t.players.find((p) => p.id === id);
      if (!seat) return { points: 0, knightsHeld: 0, otherCards: 0 };
      if (id === meId) {
        const held = (k: CardKind) => seat.cards.filter((c) => c.kind === k).length;
        return {
          points: score(t as never, seat as never, true),
          knightsHeld: held('knight'),
          otherCards: held('yearOfPlenty') + held('monopoly') + held('roadBuilding'),
        };
      }
      const cards = cardCount.get(id) ?? 0;
      return {
        points: score(t as never, { ...seat, cards: [] } as never, false) + cards * vp,
        knightsHeld: cards * knight,
        otherCards: cards * Math.max(0, 1 - vp - knight),
      };
    };
}

export const DECK_SIZE = Object.values(DEVELOPMENT_DECK).reduce((a, b) => a + b, 0);
export const cardsIn = (hand: Hand) => handSize(hand);
export { RESOURCES };
