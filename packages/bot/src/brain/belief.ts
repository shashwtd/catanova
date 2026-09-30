/**
 * Card counting.
 *
 * Almost everything in Catan happens in public: dice income, building costs, bank
 * and harbour trades, trades between players, discards, Monopoly and Year of
 * Plenty. Only a steal hides which card moved, and only from the players who were
 * not part of it. So for every opponent the bot keeps a small set of possible
 * hands with weights. Most of the time there is exactly one. A steal splits it;
 * spending cards the hand could not have held removes the possibilities it rules
 * out. Research on Catan bots found that counting like this is as good as seeing
 * every hand.
 *
 * Development cards are counted the same way: the kinds played are public, so the
 * chance that an opponent is holding hidden points follows from the cards nobody
 * has seen yet.
 *
 * Nothing here ever reads a hidden card. The only input is `PublicFact`, and the
 * only code that makes those from a real game is `facts.ts`, which is tested to
 * give the same facts whatever the stolen card was.
 */

import { DEVELOPMENT_DECK, RESOURCES } from '../../../rules/src/index.js';
import type { Resource } from '../../../rules/src/index.js';
import type { CardKind, Hand } from '../../../rules/src/game.js';
import { emptyHand, handSize } from './table.js';

/** One thing every player at the table saw happen to a player's cards. */
export type PublicFact =
  /** Cards gained or lost, all of them seen: income, building, trades, discards, Monopoly, Year of Plenty. */
  | { kind: 'change'; player: string; delta: Hand }
  /** A steal the viewer was not part of: one unseen card moved from `victim` to `thief`. */
  | { kind: 'steal'; thief: string; victim: string }
  /** After a Monopoly on `resource`, a player holds none of it. */
  | { kind: 'none'; player: string; resource: Resource }
  /** A development card was bought. */
  | { kind: 'bought'; player: string }
  /** A development card was played, and everyone saw which. */
  | { kind: 'played'; player: string; card: CardKind }
  /** The public card count, to check the counting against: a mismatch means something was missed. */
  | { kind: 'count'; player: string; cards: number };

type Possible = { hand: Hand; weight: number };

export type Belief = {
  version: 1;
  /** Possible hands for each opponent, weights summing to one. */
  hands: Record<string, Possible[]>;
  /** Development cards each player holds, by the public count. */
  cardsHeld: Record<string, number>;
  /** Development cards each player has played, by kind. */
  played: Record<string, Partial<Record<CardKind, number>>>;
};

const MAX_POSSIBLE = 48;

export const newBelief = (): Belief => ({ version: 1, hands: {}, cardsHeld: {}, played: {} });

const key = (h: Hand) => RESOURCES.map((r) => h[r]).join(',');

function merge(list: Possible[]): Possible[] {
  const byKey = new Map<string, Possible>();
  for (const p of list) {
    if (p.weight <= 0) continue;
    const k = key(p.hand);
    const seen = byKey.get(k);
    if (seen) seen.weight += p.weight;
    else byKey.set(k, { hand: { ...p.hand }, weight: p.weight });
  }
  let out = [...byKey.values()].sort((a, b) => b.weight - a.weight).slice(0, MAX_POSSIBLE);
  const sum = out.reduce((n, p) => n + p.weight, 0);
  if (sum > 0) out = out.map((p) => ({ ...p, weight: p.weight / sum }));
  return out;
}

/**
 * Start counting a player whose hand is not known, from how many cards they hold:
 * spread in proportion to `prior` (what their buildings produce), as a handful of
 * possibilities that spending will narrow down.
 */
export function unknownHand(count: number, prior: Hand): Possible[] {
  const weights = RESOURCES.map((r) => prior[r] + 0.03);
  const sum = weights.reduce((a, b) => a + b, 0);
  // Every way of dealing `count` cards would be too many; deal them in order of
  // likelihood a few different ways instead.
  const out: Possible[] = [];
  const expected = RESOURCES.map((_, i) => (weights[i]! / sum) * count);
  const base = emptyHand();
  let left = count;
  RESOURCES.forEach((r, i) => {
    base[r] = Math.floor(expected[i]!);
    left -= base[r];
  });
  const order = RESOURCES.map((r, i) => ({ r, frac: expected[i]! - Math.floor(expected[i]!) })).sort(
    (a, b) => b.frac - a.frac,
  );
  // The most likely hand, then the ones that move a single card around it.
  const first = { ...base };
  for (let i = 0; i < left; i++) first[order[i % order.length]!.r]++;
  out.push({ hand: first, weight: 1 });
  for (const from of RESOURCES)
    for (const to of RESOURCES) {
      if (from === to || first[from] === 0) continue;
      const h = { ...first };
      h[from]--;
      h[to]++;
      out.push({ hand: h, weight: (weights[RESOURCES.indexOf(to)]! / sum) * 0.5 });
    }
  return merge(out);
}

/** Apply one public fact. `prior` supplies a starting guess for a player not yet counted. */
export function learn(belief: Belief, fact: PublicFact, prior: (id: string) => { count: number; income: Hand }) {
  const ensure = (id: string) => {
    if (!belief.hands[id]) {
      const { count, income } = prior(id);
      belief.hands[id] = unknownHand(count, income);
    }
    return belief.hands[id]!;
  };
  switch (fact.kind) {
    case 'change': {
      const list = ensure(fact.player);
      const next: Possible[] = [];
      for (const p of list) {
        const h = { ...p.hand };
        let ok = true;
        for (const r of RESOURCES) {
          h[r] += fact.delta[r];
          if (h[r] < 0) ok = false;
        }
        if (ok) next.push({ hand: h, weight: p.weight });
      }
      // Every possibility ruled out: something was missed. Start again from the
      // count, keeping what this fact shows the hand held.
      if (!next.length) {
        const size = Math.max(0, handSize(list[0]?.hand ?? emptyHand()) + handSize(fact.delta));
        belief.hands[fact.player] = unknownHand(size, prior(fact.player).income);
        return;
      }
      belief.hands[fact.player] = merge(next);
      return;
    }
    case 'steal': {
      const victim = ensure(fact.victim);
      const thief = ensure(fact.thief);
      // What the card was, as the table sees it: a random card from the victim's hand.
      const taken = emptyHand();
      const afterVictim: Possible[] = [];
      for (const p of victim) {
        const n = handSize(p.hand);
        if (!n) continue;
        for (const r of RESOURCES) {
          if (!p.hand[r]) continue;
          const chance = p.weight * (p.hand[r] / n);
          taken[r] += chance;
          const h = { ...p.hand };
          h[r]--;
          afterVictim.push({ hand: h, weight: chance });
        }
      }
      belief.hands[fact.victim] = merge(afterVictim.length ? afterVictim : victim);
      const afterThief: Possible[] = [];
      for (const p of thief)
        for (const r of RESOURCES) {
          if (taken[r] <= 0) continue;
          const h = { ...p.hand };
          h[r]++;
          afterThief.push({ hand: h, weight: p.weight * taken[r] });
        }
      belief.hands[fact.thief] = merge(afterThief.length ? afterThief : thief);
      return;
    }
    case 'none': {
      const list = ensure(fact.player);
      const next = list.filter((p) => p.hand[fact.resource] === 0);
      belief.hands[fact.player] = merge(
        next.length ? next : list.map((p) => ({ hand: { ...p.hand, [fact.resource]: 0 }, weight: p.weight })),
      );
      return;
    }
    case 'bought':
      belief.cardsHeld[fact.player] = (belief.cardsHeld[fact.player] ?? 0) + 1;
      return;
    case 'played': {
      belief.cardsHeld[fact.player] = Math.max(0, (belief.cardsHeld[fact.player] ?? 0) - 1);
      const mine = (belief.played[fact.player] ??= {});
      mine[fact.card] = (mine[fact.card] ?? 0) + 1;
      return;
    }
    case 'count': {
      belief.cardsHeld[fact.player] = fact.cards;
      return;
    }
  }
}

/** Keep the counting honest against the public card count: a mismatch restarts that player. */
export function reconcile(belief: Belief, id: string, count: number, income: Hand) {
  const list = belief.hands[id];
  if (!list || !list.length || list.some((p) => handSize(p.hand) !== count))
    belief.hands[id] = list?.length
      ? merge(list.filter((p) => handSize(p.hand) === count)).length
        ? merge(list.filter((p) => handSize(p.hand) === count))
        : unknownHand(count, income)
      : unknownHand(count, income);
}

export function possibleHands(belief: Belief, id: string): Possible[] {
  return belief.hands[id] ?? [];
}

/** The chance a random card from this player's hand is each resource. */
export function composition(belief: Belief, id: string): Hand {
  const out = emptyHand();
  for (const p of belief.hands[id] ?? []) {
    const n = handSize(p.hand);
    if (!n) continue;
    for (const r of RESOURCES) out[r] += p.weight * (p.hand[r] / n);
  }
  return out;
}

/** The expected number of each resource this player holds. */
export function expectedHand(belief: Belief, id: string): Hand {
  const out = emptyHand();
  for (const p of belief.hands[id] ?? []) for (const r of RESOURCES) out[r] += p.weight * p.hand[r];
  return out;
}

/** The chance this player holds at least `n` of `resource`. */
export function chanceHolds(belief: Belief, id: string, resource: Resource, n = 1): number {
  return (belief.hands[id] ?? []).reduce((sum, p) => sum + (p.hand[resource] >= n ? p.weight : 0), 0);
}

/** Draw one possible hand, by weight. */
export function sampleHand(belief: Belief, id: string, random: () => number): Hand | null {
  const list = belief.hands[id];
  if (!list?.length) return null;
  let roll = random();
  for (const p of list) {
    roll -= p.weight;
    if (roll <= 0) return { ...p.hand };
  }
  return { ...list[0]!.hand };
}

/**
 * The development cards nobody has seen: the whole deck, less the viewer's own
 * cards and every card anyone has played.
 */
export function unseenCards(belief: Belief, mine: readonly { kind: CardKind }[]): Record<CardKind, number> {
  const out = { ...DEVELOPMENT_DECK } as Record<CardKind, number>;
  for (const c of mine) out[c.kind] = Math.max(0, out[c.kind] - 1);
  for (const played of Object.values(belief.played))
    for (const [kind, n] of Object.entries(played)) out[kind as CardKind] = Math.max(0, out[kind as CardKind] - (n ?? 0));
  return out;
}

/** The chance one unseen card is of a kind. */
export function cardChance(unseen: Record<CardKind, number>, kind: CardKind): number {
  const total = Object.values(unseen).reduce((a, b) => a + b, 0);
  return total ? unseen[kind] / total : 0;
}
