/**
 * One bot decision.
 *
 * The brain in `brain/` does the thinking: the race to ten points
 * (`race.ts`), card counting (`belief.ts`), a search over whole turns played by
 * the real rules (`search.ts`), the opening (`opening.ts`) and trading
 * (`trade.ts`). This file routes each phase of the game to the right part of it,
 * turns the answer into the plan a player reads, and asks Jev (`advisor.ts`) only
 * when the engine's own numbers leave a choice genuinely open.
 *
 * Every path returns a legal move in time, with or without the decision service,
 * because a stalled seat ruins the game for everyone else at the table.
 */

import { COSTS, RESOURCES } from '../../rules/src/index.js';
import type { Board } from '../../rules/src/board.js';
import { seededRandom } from '../../rules/src/board.js';
import type { GameAction, GameView, Hand } from '../../rules/src/game.js';
import type { JevClient } from './jev.js';
import { handOf } from './heuristics.js';
import { initialPlan, describe } from './plan.js';
import type { Archetype, BotPlan, Focus } from './plan.js';
import type { BotLevel } from '../../protocol/src/bots.js';
import { STYLE_ARCHETYPE } from './style.js';
import type { StandInStyle } from './style.js';
import { imagine, knowledge, newMind } from './brain/mind.js';
import type { Mind } from './brain/mind.js';
import { unseenCards } from './brain/belief.js';
import { race } from './brain/race.js';
import type { Strategy } from './brain/race.js';
import { bestDiscard, bestRobber, knightFirst, planTurn, settle, standings, tryMove, value } from './brain/search.js';
import type { Thinker } from './brain/search.js';
import { chooseOpening, chooseOpeningRoad } from './brain/opening.js';
import { answer, makeOffer, manageOffer, openOffer } from './brain/trade.js';
import { adviseStrategy, adviseThreat, adviseTrade } from './brain/advisor.js';
import { roadSites } from '../../rules/src/game.js';
import { TUNING } from './brain/tuning.js';
import { sevenChance } from './brain/dice.js';

export type Decision = {
  /** The move. While `hold` is set it is only a placeholder and must not be played. */
  action: GameAction;
  plan: BotPlan;
  /** Jev requests spent on this decision: 0 for anything the engine settled alone. */
  calls: number;
  tokens: number;
  costUsd: number;
  /** What the bot would tell you it is doing. */
  explain: string;
  degraded?: boolean;
  /** The bot's memory after this decision, for the next one. */
  mind?: Mind;
  /** True when the bot has nothing to do yet: its trade offer is still collecting answers. */
  hold?: boolean;
};

export type DecideContext = {
  view: GameView;
  board: Board;
  meId: string;
  plan: BotPlan;
  jev: JevClient | null;
  /** Difficulty: how hard the brain thinks. See `DIALS`. */
  level?: BotLevel;
  /** A seat kept warm for a player who dropped out, and how they were playing. */
  standIn?: StandInStyle;
  /** Memory from the last decision. A fresh one is started when absent. */
  mind?: Mind;
  /** The players who are people, not bots: Jev is asked about trades only with them. */
  humans?: readonly string[];
  /** Milliseconds since the epoch, for timing the bot's own trade offers. */
  now?: number;
  /** Overrides the level's thinking time, in milliseconds: a safety cap. */
  budgetMs?: number;
  /** Overrides how many positions the level scores before settling: the real limit. */
  positions?: number;
  random?: () => number;
  /** False where trades between players do not exist (a simulator that has none): the bot then never offers. */
  canOffer?: boolean;
};

/**
 * What each level is allowed. The top level is the whole engine; the others are
 * the same engine held back, which is how a strong bot is toned down.
 */
const DIALS: Record<
  BotLevel,
  {
    budgetMs: number;
    positions: number;
    depth: number;
    beam: number;
    /** Whether the bot makes trade offers of its own. */
    offers: boolean;
    /** Whether it makes open offers ("these cards for anything"). */
    open: boolean;
    /** Whether it answers someone's open offer with a proposal, rather than declining. */
    counter: boolean;
    opening: [number, number];
    advisor: boolean;
    slack: number;
  }
> = {
  champ: { budgetMs: 1200, positions: 2000, depth: 4, beam: 10, offers: true, open: false, counter: true, opening: [8, 14], advisor: true, slack: 0 },
  sharp: { budgetMs: 700, positions: 900, depth: 3, beam: 6, offers: true, open: false, counter: true, opening: [4, 10], advisor: true, slack: 0.004 },
  steady: { budgetMs: 500, positions: 350, depth: 2, beam: 4, offers: false, open: false, counter: true, opening: [2, 6], advisor: false, slack: 0.012 },
};

const FOCUS: Record<string, Focus> = { city: 'city', settlement: 'settlement', army: 'card', card: 'card', road: 'road' };
const ARCHETYPE: Record<Strategy, Archetype> = { cities: 'cities', expansion: 'expansion', development: 'development', road: 'road' };
const STRATEGIES: Strategy[] = ['cities', 'expansion', 'development', 'road'];
const FROM_ARCHETYPE: Partial<Record<Archetype, Strategy>> = {
  cities: 'cities',
  expansion: 'expansion',
  development: 'development',
  road: 'road',
  trading: 'expansion',
};

type Spend = { calls: number; tokens: number; costUsd: number };
const zero = (): Spend => ({ calls: 0, tokens: 0, costUsd: 0 });
const add = (into: Spend, a: { calls: number; tokens: number; costUsd: number }) => {
  into.calls += a.calls;
  into.tokens += a.tokens;
  into.costUsd += a.costUsd;
};

function thinker(ctx: DecideContext, mind: Mind, random: () => number): Thinker {
  const dials = DIALS[ctx.level ?? 'steady'];
  const lean = mind.strategy ?? (ctx.standIn ? FROM_ARCHETYPE[STYLE_ARCHETYPE[ctx.standIn.style]] : undefined);
  const me = ctx.view.players.find((p) => p.id === ctx.meId);
  return {
    me: ctx.meId,
    know: knowledge(ctx.view, ctx.meId, mind),
    belief: mind.belief,
    unseen: unseenCards(mind.belief, me?.cards ?? []),
    lean: lean ? { [ctx.meId]: lean } : undefined,
    lastVictim: mind.lastVictim,
    ...(TUNING.countDice && ctx.view.diceMode === 'balanced' && mind.dice?.synced
      ? { sevens: (rolls: number) => sevenChance(mind.dice, rolls) }
      : {}),
    random,
    deadline: performance.now() + (ctx.budgetMs ?? dials.budgetMs),
    positions: ctx.positions ?? dials.positions,
    ...searchShape(ctx, dials),
    scored: 0,
  };
}

/**
 * How wide and deep the turn search goes. Near the end it goes further, where a
 * winning turn can take five or six moves and missing one costs the game.
 */
function searchShape(ctx: DecideContext, dials: (typeof DIALS)[BotLevel]): { beam: number; depth: number } {
  const me = ctx.view.players.find((p) => p.id === ctx.meId);
  const near =
    TUNING.endgameWithin > 0 && !!me && me.points >= (ctx.view.victoryPoints ?? 10) - TUNING.endgameWithin;
  return near && ctx.level === 'champ'
    ? { beam: Math.max(dials.beam, TUNING.endgameBeam), depth: Math.max(dials.depth, TUNING.endgameDepth) }
    : { beam: dials.beam, depth: dials.depth };
}

/** The plan a player reads, from the first purchases in the bot's own race. */
function planFrom(ctx: DecideContext, mind: Mind, th: Thinker, g: ReturnType<typeof imagine>, prior: BotPlan): BotPlan {
  const steps = race(g, ctx.meId, th.know(g)(ctx.meId), mind.strategy).steps;
  const first = steps[0];
  const focus: Focus = first ? (FOCUS[first.kind] ?? 'save') : 'save';
  const cost = focus === 'city' ? COSTS.city : focus === 'settlement' ? COSTS.settlement : focus === 'road' ? COSTS.road : focus === 'card' ? COSTS.developmentCard : null;
  const hand = handOf(ctx.view);
  const needs = cost ? RESOURCES.filter((r) => hand[r] < (cost as Hand)[r]) : [];
  const surplus = cost ? RESOURCES.filter((r) => hand[r] > (cost as Hand)[r] + 1) : [];
  return {
    ...prior,
    archetype: mind.strategy ? ARCHETYPE[mind.strategy] : prior.archetype,
    focus,
    targetSite: first?.site ?? first?.vertex ?? prior.targetSite,
    needs,
    surplus,
    updatedTurn: ctx.view.turn,
    decisions: prior.decisions + 1,
  };
}

export async function decide(ctx: DecideContext): Promise<Decision> {
  const mind = ctx.mind ?? newMind();
  const plan = ctx.plan ?? initialPlan(ctx.view.turn);
  const random = ctx.random ?? seededRandom(hash(`${ctx.meId}:${ctx.view.turn}:${ctx.view.phase}`));
  const spend = zero();
  const view = ctx.view;
  const g = imagine(view, ctx.meId, mind, random);
  const th = thinker(ctx, mind, random);
  const dials = DIALS[ctx.level ?? 'steady'];
  const done = (action: GameAction, explain: string, extra: Partial<Decision> = {}): Decision => {
    const next = planFrom(ctx, mind, th, g, plan);
    return { action, plan: next, ...spend, explain: explain || describe(next, ctx.board), mind, ...extra };
  };

  switch (view.phase) {
    case 'roll': {
      const knight = knightFirst(g, th);
      return knight ? done(knight, 'A knight first: the robber has to move.') : done({ kind: 'roll' }, 'Rolling.');
    }
    case 'discard': {
      const count = view.discards[ctx.meId] ?? Math.floor(RESOURCES.reduce((n, r) => n + handOf(view)[r], 0) / 2);
      return done({ kind: 'discard', resources: bestDiscard(g, th, count) }, `Discarding ${count}, keeping what the race needs.`);
    }
    case 'setupSettlement': {
      const [samples, candidates] = dials.opening;
      const pick = chooseOpening(g, th, samples, candidates);
      return done({ kind: 'settlement', vertex: pick.vertex }, '');
    }
    case 'setupRoad':
      return done(chooseOpeningRoad(g, th), 'Pointing the road at the next corner.');
    case 'freeRoads': {
      const options = roadSites(g, ctx.meId);
      if (!options.length) return done({ kind: 'endTurn' }, 'No road to build.');
      let best = options[0]!,
        bestValue = -1;
      for (const edge of options) {
        const next = tryMove(g, ctx.meId, { kind: 'road', edge });
        if (!next) continue;
        const v = value(next, th, false);
        if (v > bestValue) {
          bestValue = v;
          best = edge;
        }
      }
      return done({ kind: 'road', edge: best }, 'Placing a free road.');
    }
    case 'robber': {
      const best = bestRobber(g, th);
      if (!best) return done({ kind: 'robber', hex: view.robber }, 'Nowhere better for the robber.');
      let action = best.action;
      // Two targets the engine cannot separate, hitting different people: who is the real threat?
      if (dials.advisor && best.runnerUp !== undefined && best.value - best.runnerUp < 0.003 * TUNING.gainScale) {
        const top = [best.action];
        const second = bestRobberAlternatives(g, th, best.action);
        if (second) top.push(second);
        const victims = [...new Set(top.map((a) => (a as { victim?: string }).victim).filter((v): v is string => !!v))];
        if (victims.length >= 2) {
          const advice = await adviseThreat(ctx.jev, view, ctx.meId, victims);
          add(spend, advice);
          const pick = top.find((a) => (a as { victim?: string }).victim === advice.value);
          if (pick) action = pick;
        }
      }
      const victim = (action as { victim?: string }).victim;
      if (victim) mind.lastVictim = victim;
      return done(action, victim ? 'Robber onto the tile that costs the leaders most, and a card from them.' : 'Robber onto the busiest tile.');
    }
    case 'actions':
      return takeTurn(ctx, mind, th, g, plan, spend, dials, done);
    default:
      return done({ kind: 'endTurn' }, 'Nothing to do.');
  }
}

/** The runner-up robber placement with a different victim, for the advisor to weigh. */
function bestRobberAlternatives(g: ReturnType<typeof imagine>, th: Thinker, first: GameAction): GameAction | null {
  const victim = (first as { victim?: string }).victim;
  const others = g.players.filter((p) => p.id !== th.me && p.id !== victim && !p.resigned);
  let best: { a: GameAction; v: number } | null = null;
  for (const hex of g.board.hexes) {
    if (hex.id === g.robber) continue;
    for (const o of others) {
      if (!hex.vertices.some((v) => g.buildings[v]?.player === o.id)) continue;
      const a: GameAction = { kind: 'robber', hex: hex.id, victim: o.id };
      const next = tryMove(g, th.me, a);
      if (!next) continue;
      const v = value(next, th, false);
      if (!best || v > best.v) best = { a, v };
    }
  }
  return best?.a ?? null;
}

async function takeTurn(
  ctx: DecideContext,
  mind: Mind,
  th: Thinker,
  g: ReturnType<typeof imagine>,
  plan: BotPlan,
  spend: Spend,
  dials: (typeof DIALS)[BotLevel],
  done: (action: GameAction, explain: string, extra?: Partial<Decision>) => Decision,
): Promise<Decision> {
  const view = ctx.view;
  const now = ctx.now ?? Date.now();
  if (mind.offers.turn !== view.turn) mind.offers = { turn: view.turn, made: [] };

  // Its own offer is on the table: take the best answer, wait, or withdraw.
  if (view.trade && view.trade.player === ctx.meId) {
    if (!mind.offerSince || mind.offerSince.tradeId !== view.trade.id) mind.offerSince = { tradeId: view.trade.id, at: now };
    const managed = manageOffer(g, th, view.trade, now - mind.offerSince.at);
    if (!managed.action) return done({ kind: 'endTurn' }, 'Waiting for answers to the trade offer.', { hold: true });
    if (managed.action.kind === 'acceptProposal' && managed.verdict && managed.partner && ctx.humans?.includes(managed.partner) && dials.advisor) {
      const advice = await adviseTrade(ctx.jev, view, ctx.meId, managed.partner, managed.verdict, mind.profiles[managed.partner]);
      add(spend, advice);
      if (!advice.value) return done({ kind: 'cancelTrade' }, 'Thought better of that trade.');
    }
    return done(managed.action, managed.action.kind === 'cancelTrade' ? 'No good answer; keeping the cards.' : 'Taking the best answer to the offer.');
  }

  // A seat kept warm for someone who dropped out finishes the game they were
  // playing: their style is the long game, and nobody is asked for a new one.
  const inherited = ctx.standIn ? FROM_ARCHETYPE[STYLE_ARCHETYPE[ctx.standIn.style]] : undefined;
  if (inherited) {
    mind.strategy = inherited;
    mind.strategyTurn = view.turn;
    th.lean = { [ctx.meId]: inherited };
  }
  // The long game, chosen after the opening and revisited every few turns.
  else if (mind.strategy === undefined || (mind.strategyTurn ?? -99) + 4 <= view.turn) {
    const rolls = {} as Record<Strategy, number>;
    const know = th.know(g)(ctx.meId);
    for (const s of STRATEGIES) rolls[s] = race(g, ctx.meId, know, s).rolls;
    const advice = dials.advisor
      ? await adviseStrategy(ctx.jev, view, ctx.meId, rolls)
      : { value: (Object.entries(rolls) as [Strategy, number][]).sort((a, b) => a[1] - b[1])[0]![0], calls: 0, tokens: 0, costUsd: 0 };
    add(spend, advice);
    mind.strategy = advice.value;
    mind.strategyTurn = view.turn;
    th.lean = { [ctx.meId]: mind.strategy };
  }

  const best = planTurn(g, th);
  // A card or two short of something better: ask the table before settling for the bank.
  if (dials.offers && ctx.canOffer !== false && !view.trade) {
    const offer = makeOffer(g, th, mind.offers.made, best.value, mind.trading, mind.profiles);
    if (offer) {
      mind.offers.made.push(offer.key);
      mind.trading.made++;
      return done(offer.action, 'Offering a trade for the cards the plan is missing.');
    }
    if (dials.open && best.action.kind === 'endTurn') {
      const open = openOffer(g, th, mind.offers.made);
      if (open) {
        mind.offers.made.push(open.key);
        mind.trading.made++;
        return done(open.action, 'Offering spare cards for whatever the table has.');
      }
    }
  }
  // A lower level sometimes settles for a good move rather than the best one.
  let action = best.action;
  if (dials.slack > 0 && th.random() < 0.25 && best.value - best.baseline < dials.slack) action = { kind: 'endTurn' };
  return done(action, '');
}

/**
 * Someone else's trade offer is on the table. Answer it: accept, decline, or for
 * an open offer, propose. Returns null when this seat cannot take part.
 */
export async function respond(ctx: DecideContext): Promise<{ action: GameAction | null; mind: Mind; calls: number; tokens: number; costUsd: number }> {
  const mind = ctx.mind ?? newMind();
  const spend = zero();
  const view = ctx.view;
  const trade = view.trade;
  if (!trade || trade.player === ctx.meId || view.phase !== 'actions' || (view.notTrading ?? []).includes(ctx.meId))
    return { action: null, mind, ...spend };
  if (trade.declinedBy?.includes(ctx.meId) || trade.proposals?.some((p) => p.player === ctx.meId))
    return { action: null, mind, ...spend };
  // An open offer asks for a proposal, which is haggling: a bot that does not haggle declines it.
  if (trade.open && !DIALS[ctx.level ?? 'steady'].counter)
    return { action: { kind: 'declineTrade', tradeId: trade.id }, mind, ...spend };
  const random = ctx.random ?? seededRandom(hash(`${ctx.meId}:${view.turn}:trade:${trade.id}`));
  const g = imagine(view, ctx.meId, mind, random);
  const th = thinker({ ...ctx, positions: Math.min(ctx.positions ?? 300, 300) }, mind, random);
  const result = answer(g, th, trade);
  let action = result.action;
  if (
    result.verdict &&
    action.kind !== 'declineTrade' &&
    ctx.humans?.includes(result.partner) &&
    DIALS[ctx.level ?? 'steady'].advisor
  ) {
    const advice = await adviseTrade(ctx.jev, view, ctx.meId, result.partner, result.verdict, mind.profiles[result.partner]);
    add(spend, advice);
    if (!advice.value) action = { kind: 'declineTrade', tradeId: trade.id };
  }
  return { action, mind, ...spend };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export { standings, settle };
