/**
 * Trading with the table, selfishly.
 *
 * A bot trades for its own reasons and no one else's. Every trade is priced in the
 * one currency the brain uses, the chance of winning, for both sides:
 *
 * - it answers yes only when a trade helps it more than it helps the other
 *   player, and never helps someone close to winning;
 * - it offers a trade only when a card or two stands between it and a purchase,
 *   to players the counting says hold what it wants, at most three times a turn
 *   and never the same refused offer twice;
 * - when somebody offers cards and asks for anything in return, it proposes the
 *   least it can give that the other player should still want;
 * - when its own offer draws acceptances or proposals, it takes the best one for
 *   itself and ignores the rest.
 *
 * Research on Catan bots is clear on both sides of this: good trading roughly
 * doubles a bot's share of wins against other bots, and generous or careless
 * trading is how bots lose to people.
 */

import { RESOURCES } from '../../../rules/src/index.js';
import { score } from '../../../rules/src/game.js';
import type { Game, GameAction, Hand, Trade } from '../../../rules/src/game.js';
import { chanceHolds } from './belief.js';
import { planTurn, standings, value } from './search.js';
import type { Thinker } from './search.js';
import type { Profile } from './mind.js';
import { COSTS, canAfford, emptyHand, handSize, minus, plus, target } from './table.js';

/** Below this a trade is not worth the table's time. In chance of winning. */
export const MIN_GAIN = 0.004;
/** What one roll taken off a race is worth, in chance of winning, when pricing a trade. */
export const ROLL_WORTH = 0.002;
/** How many offers a bot makes in one turn at most. */
export const OFFERS_PER_TURN = 1;
/** An offer must be worth at least this much, expected, to be made at all. */
export const OFFER_GAIN = 0.008;
/** How long a bot waits for answers to its own offer before withdrawing it. */
export const OFFER_WAIT_MS = 9000;

export type Verdict = {
  /** The bot's own gain in chance of winning. */
  mine: number;
  /** The other player's gain in chance of winning. Zero-sum, so it falls whenever the bot gains. */
  theirs: number;
  /** Rolls the trade takes off the other player's own race: how it looks to them. */
  speedsThem: number;
  /** Whether the other player is too close to winning to trade with at all. */
  threat: boolean;
  ok: boolean;
  /** A close call: worth a second opinion when the other side is a person. */
  marginal: boolean;
};

/** The same game with a trade done between two hands. */
export function traded(g: Game, me: string, partner: string, give: Hand, get: Hand): Game | null {
  const players = g.players.map((p) => ({ ...p, hand: { ...p.hand } }));
  const a = players.find((p) => p.id === me),
    b = players.find((p) => p.id === partner);
  if (!a || !b || !canAfford(a.hand, give)) return null;
  // The other hand is imagined from the counting. When the rules say they can pay
  // (their own offer, or cards the counting says they probably hold), make sure
  // the imagined hand can too, rather than pricing a trade that cannot happen.
  // The count of their cards is public, so the missing card takes the place of
  // one of theirs rather than appearing from nowhere.
  for (const r of RESOURCES)
    while (b.hand[r] < get[r]) {
      const from = RESOURCES.filter((x) => x !== r && b.hand[x] > get[x]).sort((x, y) => b.hand[y] - b.hand[x])[0];
      if (from) b.hand[from]--;
      b.hand[r]++;
    }
  a.hand = plus(minus(a.hand, give), get);
  b.hand = plus(minus(b.hand, get), give);
  return { ...g, players };
}

/**
 * Whether a player is too close to winning to trade with. From about seven
 * points in a game to ten, a leader gets nothing: research on JSettlers found
 * its own cut-off of eight came too late.
 */
export function isThreat(g: Game, th: Thinker, partner: string, chances?: Map<string, number>): boolean {
  const seat = g.players.find((p) => p.id === partner);
  if (!seat) return true;
  const points = score(g, { ...seat, cards: [] }, false);
  if (points >= target(g) - 3) return true;
  const table = chances ?? new Map(standings(g, th, false).map((s) => [s.id, s.chance]));
  // Head to head every trade is with the one rival, and helping them more than
  // the bot is already ruled out; the leader rule is for a table of three or more.
  if (g.players.filter((p) => !p.resigned).length < 3) return false;
  const theirs = table.get(partner) ?? 0,
    mine = table.get(th.me) ?? 0;
  return theirs > 0.4 && theirs > mine * 1.4;
}

/**
 * Price a trade for both sides. On the bot's own turn its side is what it can
 * then do with the cards this turn; otherwise it is the position they leave.
 */
export function judge(g: Game, th: Thinker, partner: string, give: Hand, get: Hand, myTurn: boolean): Verdict {
  const table = standings(g, th, false);
  const before = new Map(table.map((s) => [s.id, s.chance]));
  const threat = isThreat(g, th, partner, before);
  const after = traded(g, th.me, partner, give, get);
  if (!after) return { mine: -1, theirs: 0, speedsThem: 0, threat, ok: false, marginal: false };
  const afterStandings = standings(after, th, false);
  const afterTable = new Map(afterStandings.map((s) => [s.id, s.chance]));
  const rolls = (list: typeof table) => list.find((s) => s.id === partner)?.rolls ?? 0;
  const speedsThem = rolls(table) - rolls(afterStandings);
  // Gains are counted in chance of winning plus a little for every roll taken off
  // a race, so a trade still counts when the chance is all but settled.
  const myRolls = (list: typeof table) => list.find((s) => s.id === th.me)?.rolls ?? 0;
  let mine = (afterTable.get(th.me) ?? 0) - (before.get(th.me) ?? 0) + ROLL_WORTH * (myRolls(table) - myRolls(afterStandings));
  if (myTurn) {
    // What the cards let it do this turn, against what it could do without them.
    const quick = { ...th, depth: 2, beam: 6, scored: 0, positions: 120 };
    mine = planTurn(after, quick).value - planTurn(g, quick).value;
  }
  const theirs = (afterTable.get(partner) ?? 0) - (before.get(partner) ?? 0) + ROLL_WORTH * speedsThem;
  // Selfish: it must help the bot, and help the bot more than it helps them.
  const ok = !threat && mine > MIN_GAIN && mine > theirs;
  const marginal = ok && (mine < MIN_GAIN * 3 || theirs > mine * 0.7);
  return { mine, theirs, speedsThem, threat, ok, marginal };
}

/** An offer on the table from someone else: accept, decline, or propose (for an open offer). */
export function answer(g: Game, th: Thinker, trade: Trade): { action: GameAction; verdict?: Verdict; partner: string } {
  const maker = trade.player;
  const decline: GameAction = { kind: 'declineTrade', tradeId: trade.id };
  const me = g.players.find((p) => p.id === th.me);
  if (!me) return { action: decline, partner: maker };
  if (!trade.open) {
    // They give `give` and want `want` from whoever accepts.
    if (!canAfford(me.hand, trade.want)) return { action: decline, partner: maker };
    const verdict = judge(g, th, maker, trade.want, trade.give, false);
    return {
      action: verdict.ok ? { kind: 'acceptTrade', tradeId: trade.id } : decline,
      verdict,
      partner: maker,
    };
  }
  // An open offer: they give `give` and take proposals. Propose the least it can
  // give that still leaves them better off, as long as the bot gains more.
  const chances = new Map(standings(g, th, false).map((s) => [s.id, s.chance]));
  if (isThreat(g, th, maker, chances)) return { action: decline, partner: maker };
  // They chose to part with those cards, so a proposal only has to look fair to
  // them, not be a gift. Prefer giving less; among equals, what suits the bot best
  // while still looking good to them.
  let best: { give: Hand; verdict: Verdict; score: number } | null = null;
  for (const give of handsUpTo(me.hand, 2, trade.give)) {
    const verdict = judge(g, th, maker, give, trade.give, false);
    // They must see it as a step forward for themselves, or they will not take it.
    if (!verdict.ok || verdict.speedsThem < -0.5) continue;
    const score = verdict.mine + 0.002 * verdict.speedsThem;
    if (!best || handSize(give) < handSize(best.give) || (handSize(give) === handSize(best.give) && score > best.score))
      best = { give, verdict, score };
  }
  if (!best) return { action: decline, partner: maker };
  return { action: { kind: 'proposeTrade', tradeId: trade.id, give: best.give }, verdict: best.verdict, partner: maker };
}

/** Every hand of one or two cards the bot could give, never a resource the other side is giving. */
function handsUpTo(hand: Hand, most: number, excluded: Hand): Hand[] {
  const out: Hand[] = [];
  const kinds = RESOURCES.filter((r) => hand[r] > 0 && !excluded[r]);
  for (const a of kinds) {
    const one = emptyHand();
    one[a] = 1;
    out.push(one);
    if (most < 2) continue;
    for (const b of kinds) {
      if (RESOURCES.indexOf(b) < RESOURCES.indexOf(a)) continue;
      const two = { ...one };
      two[b]++;
      if (canAfford(hand, two)) out.push(two);
    }
  }
  return out;
}

export type Offer = { action: GameAction; key: string; mine: number; partners: string[] };

/**
 * A trade offer worth making this turn, or none.
 *
 * Only when one or two cards stand between the bot and a purchase. Each possible
 * offer is priced by what the bot could then do this turn, against its best turn
 * without it (bank and harbour trades included), and weighed by the chance
 * somebody who is not a threat both holds the cards and would want the deal.
 */
export function makeOffer(
  g: Game,
  th: Thinker,
  alreadyMade: readonly string[],
  baseline: number,
  record: { made: number; filled: number } = { made: 0, filled: 0 },
  profiles: Record<string, Profile> = {},
): Offer | null {
  // How often this table actually trades: an offer nobody takes is noise, so a
  // table that keeps refusing hears from the bot less and less, one offer a turn
  // at most once it has been ignored a while.
  const takeRate = Math.min(1, (2 * (record.filled + 1)) / (record.made + 2));
  const cap = record.made >= 6 && record.filled / record.made < 0.15 ? 1 : OFFERS_PER_TURN;
  if (alreadyMade.length >= cap) return null;
  const me = g.players.find((p) => p.id === th.me);
  if (!me) return null;
  const hand = me.hand;
  const others = g.players.filter((p) => p.id !== th.me && !p.resigned);
  if (!others.length) return null;
  const baseTable = standings(g, th, false);
  const chances = new Map(baseTable.map((s) => [s.id, s.chance]));
  // A player who has just turned the bot down is left alone for a turn, and one
  // who keeps turning it down for a good while: asking every turn is nagging.
  const patient = (id: string) => {
    const p = profiles[id];
    const n = p?.refusals ?? 0;
    if (!n) return true;
    return g.turn >= (p!.refusedTurn ?? 0) + (n >= 2 ? 10 : 3);
  };
  const partners = others.filter(
    (p) => !isThreat(g, th, p.id, chances) && !(g.notTrading ?? []).includes(p.id) && patient(p.id),
  );
  if (!partners.length) return null;

  const candidates: { give: Hand; want: Hand }[] = [];
  for (const cost of [COSTS.city, COSTS.settlement, COSTS.developmentCard, COSTS.road] as Hand[]) {
    if (canAfford(hand, cost)) continue;
    const want = emptyHand();
    for (const r of RESOURCES) want[r] = Math.max(0, cost[r] - hand[r]);
    const short = handSize(want);
    if (short < 1 || short > 2) continue;
    const spare = emptyHand();
    for (const r of RESOURCES) spare[r] = want[r] ? 0 : Math.max(0, hand[r] - cost[r]);
    for (const give of handsUpTo(spare, 2, want)) {
      // One for one, or two of its own for one card. Never asks for more cards
      // than it gives: two for one in the bot's favour reads as an insult.
      if (handSize(give) < short || handSize(give) > short + 1) continue;
      candidates.push({ give, want });
    }
  }
  let best: Offer | null = null;
  const quick = { ...th, depth: 2, beam: 6, scored: 0, positions: 120 };
  // Compared like for like: the same quick search with and without the cards.
  const base = candidates.length ? planTurn(g, { ...quick }).value : baseline;
  for (const { give, want } of candidates) {
    if (performance.now() > th.deadline + 250) break;
    const key = `${RESOURCES.map((r) => give[r]).join('')}>${RESOURCES.map((r) => want[r]).join('')}`;
    if (alreadyMade.includes(key)) continue;
    // What the cards would let the bot do this turn, over its best turn without them.
    const sample = traded(g, th.me, partners[0]!.id, give, want);
    if (!sample) continue;
    const mine = planTurn(sample, { ...quick }).value - base;
    if (mine < OFFER_GAIN) continue;
    let pAny = 1;
    const willing: string[] = [];
    for (const p of partners) {
      const holds = RESOURCES.reduce((chance, r) => (want[r] ? chance * chanceHolds(th.belief, p.id, r, want[r]) : chance), 1);
      if (holds < 0.2) continue;
      const after = traded(g, th.me, p.id, give, want);
      if (!after) continue;
      const afterTable = standings(after, th, false);
      const theirs = (afterTable.find((x) => x.id === p.id)?.chance ?? 0) - (chances.get(p.id) ?? 0);
      // Selfish: never an offer that helps them more than it helps the bot.
      if (theirs >= mine) continue;
      // Whether they would take it: does it move their own race forward?
      const speeds = (baseTable.find((x) => x.id === p.id)?.rolls ?? 0) - (afterTable.find((x) => x.id === p.id)?.rolls ?? 0);
      const accept = holds * (speeds > 0 ? 0.7 : 0.2) * takeRate;
      pAny *= 1 - accept;
      willing.push(p.id);
    }
    if (!willing.length) continue;
    const expected = (1 - pAny) * mine;
    if (expected < OFFER_GAIN) continue;
    if (!best || expected > best.mine)
      best = { action: { kind: 'offerTrade', give, want }, key, mine: expected, partners: willing };
  }
  return best;
}

/**
 * The bot's own offer is on the table: take the best answer for itself, keep
 * waiting a little for more, or withdraw it.
 */
export function manageOffer(
  g: Game,
  th: Thinker,
  trade: Trade,
  waitedMs: number,
): { action: GameAction | null; verdict?: Verdict; partner?: string } {
  let best: { player: string; give: Hand; verdict: Verdict } | null = null;
  for (const proposal of trade.proposals ?? []) {
    const verdict = judge(g, th, proposal.player, trade.give, proposal.give, true);
    if (!verdict.ok) continue;
    if (!best || verdict.mine - verdict.theirs > best.verdict.mine - best.verdict.theirs)
      best = { player: proposal.player, give: proposal.give, verdict };
  }
  if (best)
    return {
      action: { kind: 'acceptProposal', tradeId: trade.id, player: best.player, expectedGive: best.give },
      verdict: best.verdict,
      partner: best.player,
    };
  const answered = new Set([...(trade.declinedBy ?? []), ...(trade.proposals ?? []).map((p) => p.player)]);
  const waiting = g.players.some(
    (p) => p.id !== th.me && !p.resigned && !answered.has(p.id) && !(g.notTrading ?? []).includes(p.id),
  );
  if (waiting && waitedMs < OFFER_WAIT_MS) return { action: null };
  return { action: { kind: 'cancelTrade' } };
}

/**
 * An open offer: "these cards, for whatever you propose". Used when the bot has
 * a pile of one resource it cannot use and more than one card it could, so any of
 * several answers would do.
 */
export function openOffer(g: Game, th: Thinker, alreadyMade: readonly string[]): Offer | null {
  if (alreadyMade.length >= OFFERS_PER_TURN) return null;
  const me = g.players.find((p) => p.id === th.me);
  if (!me) return null;
  const hand = me.hand;
  const needed = new Set<string>();
  for (const cost of [COSTS.city, COSTS.settlement, COSTS.developmentCard] as Hand[])
    for (const r of RESOURCES) if (cost[r] > hand[r]) needed.add(r);
  if (needed.size < 2) return null;
  const surplus = RESOURCES.filter((r) => !needed.has(r) && hand[r] >= 3).sort((a, b) => hand[b] - hand[a])[0];
  if (!surplus) return null;
  const give = emptyHand();
  give[surplus] = 1;
  const key = `open:${surplus}`;
  if (alreadyMade.includes(key)) return null;
  const chances = new Map(standings(g, th, false).map((s) => [s.id, s.chance]));
  // Only worth asking a table that holds cards to offer.
  const partners = g.players.filter(
    (p) => p.id !== th.me && !p.resigned && handSize(p.hand) > 0 && !isThreat(g, th, p.id, chances),
  );
  if (!partners.length) return null;
  return { action: { kind: 'openTrade', give }, key, mine: MIN_GAIN, partners: partners.map((p) => p.id) };
}

export { value };
