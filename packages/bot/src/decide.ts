/**
 * One turn of bot thinking.
 *
 * The shape of this file is a ladder, cheapest rung first. Most Catan turns
 * have nothing to decide: no resources, nothing affordable, no card worth
 * playing. Those end the turn here without spending a decision at all. Only
 * when there is a real choice does anything reach Jev, and then every question
 * for the turn goes in one request, because a request answers its questions in
 * parallel for almost nothing while a second round trip costs real time.
 *
 * When the plan has gone stale its questions ride along in that same request,
 * so thinking ahead is free rather than a separate call.
 *
 * Every rung has a deterministic fallback. If the decision service is slow or
 * unreachable the bot still moves, because a stalled seat ruins a real game for
 * everyone else at the table.
 */

import { COSTS, RESOURCES, RESOURCE_NAMES } from '../../rules/src/index.js';
import { CARD_NAMES } from '../../rules/src/game.js';
import type { Resource } from '../../rules/src/index.js';
import type { Board } from '../../rules/src/board.js';
import { roadSites } from '../../rules/src/game.js';
import type { CardKind, GameAction, GameView, Hand } from '../../rules/src/game.js';
import { choice, noul, JevUnavailable } from './jev.js';
import type { JevClient, Question } from './jev.js';
import {
  affordable,
  bankTrade,
  cornerFacts,
  discardChoice,
  handOf,
  needsAndSurplus,
  rankCorners,
  rankRoads,
  rankRobberHexes,
  robberTargets,
  leaderOf,
  handTotal,
} from './heuristics.js';
import { ARCHETYPES, describe, initialPlan, planIsStale } from './plan.js';
import type { Archetype, BotPlan, Focus, Threat } from './plan.js';
import type { BotLevel } from '../../protocol/src/bots.js';

/** How many options of each kind are ever shown to the model. Shortlists keep
 *  the state small and stop the few good moves being buried in the many legal
 *  ones. Raising these costs tokens and rarely changes the answer. */
const LIMIT = { openingCorners: 24, corners: 12, roads: 8, robberHexes: 6 } as const;

export type Decision = {
  action: GameAction;
  plan: BotPlan;
  /** Jev requests spent on this decision: 0 for anything settled by the rules. */
  calls: number;
  tokens: number;
  costUsd: number;
  /** What the bot would tell you it is doing, rendered from typed fields. */
  explain: string;
  degraded?: boolean;
};

export type DecideContext = {
  view: GameView;
  board: Board;
  meId: string;
  plan: BotPlan;
  jev: JevClient | null;
  /**
   * Difficulty. Both bots play the same rules with the same plan; the level
   * decides how much attention they pay to whoever is winning. See `contests`.
   */
  level?: BotLevel;
};

/** What each card does, so that "play a development card" is a choice the bot
 *  can actually weigh rather than a word. */
const CARD_USE: Record<string, string> = {
  knight: 'move the robber off my land or onto somebody else, and count toward largest army',
  roadBuilding: 'two roads for free: reach a corner now, or extend the longest road',
  yearOfPlenty: 'take any two resources from the bank, enough to finish a purchase this turn',
  monopoly: 'take every card of one resource from every other player',
};

/** The cards in hand that could be played right now, counted by kind. */
function playableKinds(ctx: DecideContext): Record<string, number> {
  const mine = ctx.view.players.find((p) => p.id === ctx.meId)?.cards ?? [];
  const out: Record<string, number> = {};
  for (const id of ctx.view.legal.playableCards) {
    const kind = mine.find((c) => c.id === id)?.kind;
    if (kind) out[kind] = (out[kind] ?? 0) + 1;
  }
  return out;
}

/**
 * The cards that would actually do something if played.
 *
 * `legal.playableCards` means "the rules let you play this now", which is not
 * the same as "this will work": Road Building is refused outright when there is
 * nowhere to put a road, and Year of Plenty needs something left in the bank.
 * Offering either of those as a move produced a rejected action, and offering a
 * card that does nothing is bad play even when the rules allow it.
 */
function usableCards(ctx: DecideContext): string[] {
  const { view, meId } = ctx;
  const mine = view.players.find((p) => p.id === meId)?.cards ?? [];
  const bankHas = RESOURCES.reduce((n, r) => n + view.bank[r], 0);
  const roadRoom =
    (view.players.find((p) => p.id === meId)?.pieces.roads ?? 0) < 15 && roadSites(view, meId).length > 0;
  return view.legal.playableCards.filter((id) => {
    const kind = mine.find((c) => c.id === id)?.kind;
    if (kind === 'roadBuilding') return roadRoom;
    if (kind === 'yearOfPlenty') return bankHas > 0;
    return true;
  });
}

/**
 * The card to play when nobody is there to judge it.
 *
 * Knights first: they are never wasted, they move the robber and they build
 * toward largest army. Then Road Building, which is two roads for nothing.
 * Year of Plenty and Monopoly want a plan behind them, so they come last.
 */
const CARD_ORDER = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly'];
function bestCardToPlay(ctx: DecideContext, playable: readonly string[]): string | undefined {
  const mine = ctx.view.players.find((p) => p.id === ctx.meId)?.cards ?? [];
  const rank = (id: string) => {
    const kind = mine.find((c) => c.id === id)?.kind ?? '';
    const at = CARD_ORDER.indexOf(kind);
    return at === -1 ? CARD_ORDER.length : at;
  };
  return [...playable].sort((a, b) => rank(a) - rank(b))[0];
}

/**
 * A knight worth playing before the dice.
 *
 * If the robber is sitting on a hex this bot builds on, every turn it waits is
 * a turn of its own production thrown away — and the knight is free. This is a
 * fact about the board, so it is decided here rather than asked about.
 */
function knightBeforeRoll(ctx: DecideContext): string | null {
  if (!contests(ctx.level).clearsItsOwnLand) return null;
  const mine = ctx.view.players.find((p) => p.id === ctx.meId)?.cards ?? [];
  const knight = ctx.view.legal.playableCards.find((id) => mine.find((c) => c.id === id)?.kind === 'knight');
  if (!knight) return null;
  const blocked = ctx.board.hexes[ctx.view.robber];
  const onMine = blocked?.vertices.some((v) => ctx.view.buildings[v]?.player === ctx.meId);
  return onMine ? knight : null;
}

/**
 * What a level actually changes.
 *
 * A sharp bot contests the leader: its robber is drawn to the leader's tiles
 * and prefers to rob the leader when it lands, and it starts treating a leader
 * as a threat while they are still three points out, which pulls its plan
 * towards blocking sooner. A steady bot plays its own game: the robber goes
 * wherever the most production is, whoever owns it, and nobody counts as a
 * threat until they are one point from winning.
 *
 * Both are arithmetic, decided here rather than asked about, so the difference
 * holds even when the decision service is unreachable.
 */
function contests(level: BotLevel | undefined) {
  const contesting = level === 'sharp' || level === 'champ';
  const champ = level === 'champ';
  return {
    /** How much more a robber tile is worth for belonging to the leader. */
    leaderWeight: contesting ? 2 : 1,
    /** How close the leader gets before the bot starts obstructing. */
    threatWithin: champ ? 4 : contesting ? 3 : 1,
    /** Whether a contested road or army counts as a threat on its own. */
    mindsAwards: contesting,
    /** Whether the robber goes for the leader rather than whoever is there. */
    huntsLeader: contesting,
    /** Turns a plan survives before it is thought through again. A champ is
     *  asked to think often, which is what lets it answer a road being cut
     *  off by going after something else instead of pushing at the block. */
    planLife: champ ? 2 : 4,
    /** How many corners and roads the model is shown. Longer lists play
     *  better and cost more, which is the trade a champion is worth. */
    shortlist: champ ? { corners: 16, roads: 12 } : { corners: LIMIT.corners, roads: LIMIT.roads },
    /** Whether passing stays on the table while anything useful is affordable. */
    spendsEveryTurn: champ,
    /** Whether the state carries the award standings and the gap to the win.
     *  Every number in it is on the other players' portraits already. */
    readsTheTable: champ,
    /** Whether a knight is spent before the dice to get the robber off its
     *  own production rather than waiting for a turn it suits better. */
    clearsItsOwnLand: champ,
  };
}

const FOCUS_COST: Record<Focus, keyof typeof COSTS | null> = {
  settlement: 'settlement',
  city: 'city',
  road: 'road',
  card: 'developmentCard',
  save: null,
};

/**
 * A plan is only worth following while it can still happen. A bot saving for a
 * settlement on a board with no legal corner left will hoard timber and clay
 * for the rest of the game, which is the main way these games used to stall.
 * Achievability is a fact about the board, so it is corrected here rather than
 * asked about.
 */
function effectiveFocus(plan: BotPlan, view: GameView): Focus {
  const { legal, deckCount } = view;
  const reachable = legal.settlements.length > 0 || legal.roads.length > 0;
  if (plan.focus === 'settlement' && !reachable) return deckCount > 0 ? 'card' : 'city';
  if (
    plan.focus === 'city' &&
    !legal.cities.length &&
    !view.players.some((p) => p.hand && p.pieces.settlements > 0)
  )
    return deckCount > 0 ? 'card' : 'settlement';
  if (plan.focus === 'card' && deckCount === 0) return legal.cities.length ? 'city' : 'settlement';
  if (plan.focus === 'save') return legal.cities.length ? 'city' : 'settlement';
  return plan.focus;
}

const none = (plan: BotPlan, action: GameAction, explain: string): Decision => ({
  action,
  plan,
  calls: 0,
  tokens: 0,
  costUsd: 0,
  explain,
});

/** What the model sees. Small on purpose: a state full of board geometry the
 *  question does not need measurably drags the answer around. */
function summarise(ctx: DecideContext) {
  const { view, meId, plan, board } = ctx;
  const me = view.players.find((p) => p.id === meId);
  const hand = handOf(view);
  const leader = leaderOf(view, meId);
  const named = (id: string | null) => view.players.find((p) => p.id === id)?.name ?? 'nobody';
  const best = (field: 'roadLength' | 'knights') =>
    view.players.reduce((n, p) => Math.max(n, p[field] ?? 0), 0);
  return {
    me: {
      name: me?.name ?? 'bot',
      points: me?.points ?? 0,
      hand: Object.fromEntries(
        RESOURCES.filter((r) => hand[r]).map((r) => [RESOURCE_NAMES[r].toLowerCase(), hand[r]]),
      ),
      settlements: me?.pieces.settlements ?? 0,
      cities: me?.pieces.cities ?? 0,
      roads: me?.pieces.roads ?? 0,
      // Without this a bot was asked whether to play a development card
      // without being told which ones it was holding, so it almost never did.
      playable_cards: playableKinds(ctx),
    },
    opponents: view.players
      .filter((p) => p.id !== meId)
      .map((p) => ({ name: p.name, points: p.points, cards: p.resourceCount, knights: p.knights })),
    target_to_win: view.victoryPoints ?? 10,
    leader: leader ? `${leader.name} on ${leader.points}` : 'nobody yet',
    my_plan: {
      strategy: plan.archetype,
      saving_for: plan.focus,
      still_needs: plan.needs,
      threat: plan.threat,
    },
    turn: view.turn,
    ...(plan.targetSite !== null ? { target_corner: cornerFacts(board, plan.targetSite) } : {}),
    // Two points each, and the two things a game is most often won on late.
    // This is the same standings table the portraits show every player.
    ...(contests(ctx.level).readsTheTable
      ? {
          awards: {
            longest_road: `${named(view.longestRoad)} holds it; longest run on the board is ${best('roadLength')}, mine is ${me?.roadLength ?? 0}`,
            largest_army: `${named(view.largestArmy)} holds it; most knights played is ${best('knights')}, mine is ${me?.knights ?? 0}`,
          },
          points_still_needed: (view.victoryPoints ?? 10) - (me?.points ?? 0),
        }
      : {}),
  };
}

/** The plan questions. Added to whatever call is already happening. */
function planQuestions(ctx: DecideContext): Record<string, Question> {
  return {
    plan_strategy: choice(
      'Which long game suits this position best?',
      ARCHETYPES as unknown as Record<string, string>,
    ),
    plan_focus: choice('What should the next few turns of resources be saved for?', {
      settlement: 'a new settlement, to claim another corner and another point',
      city: 'upgrading a settlement to a city, doubling its production and worth a point',
      road: 'another road, to reach a corner or take longest road',
      card: 'a development card, for knights, hidden points or a surprise',
      save: 'hold resources and decide later',
    }),
  };
}

function readPlan(
  ctx: DecideContext,
  answers: Record<string, any>,
  threat: Threat,
  targetSite: number | null,
): BotPlan {
  const archetype = (answers.plan_strategy?.choice ?? ctx.plan.archetype) as Archetype;
  const focus = (answers.plan_focus?.choice ?? ctx.plan.focus) as Focus;
  const cost = FOCUS_COST[effectiveFocus({ ...ctx.plan, focus }, ctx.view)];
  const { needs, surplus } = needsAndSurplus(handOf(ctx.view), cost);
  return {
    ...ctx.plan,
    archetype,
    focus,
    targetSite,
    needs,
    surplus,
    threat,
    updatedTurn: ctx.view.turn,
    decisions: ctx.plan.decisions + 1,
  };
}

/** Who is close enough to winning that the bot should start obstructing. */
function threatOf(ctx: DecideContext): Threat {
  const { view, meId } = ctx;
  const { threatWithin, mindsAwards } = contests(ctx.level);
  const leader = leaderOf(view, meId);
  const goal = view.victoryPoints ?? 10;
  if (leader && leader.points >= goal - threatWithin) return 'leader-close';
  if (!mindsAwards) return 'none';
  if (view.longestRoad && view.longestRoad !== meId) return 'road-contested';
  if (view.largestArmy && view.largestArmy !== meId) return 'army-contested';
  return 'none';
}

export async function decide(ctx: DecideContext): Promise<Decision> {
  const { view, board, meId, jev } = ctx;
  const legal = view.legal;
  const hand = handOf(view);
  const plan = ctx.plan ?? initialPlan(view.turn);

  // --- rungs the rules already decide -------------------------------------
  if (view.phase === 'roll') {
    const knight = knightBeforeRoll(ctx);
    if (knight)
      return none(plan, playCard(ctx, plan, knight), 'Knight first: the robber is on my own production.');
    return none(plan, { kind: 'roll' }, 'Rolling.');
  }

  if (view.phase === 'discard') {
    const count = Math.floor(handTotal(hand) / 2);
    const keep = plan.needs.length
      ? plan.needs
      : (RESOURCES.filter((r) => hand[r] > 0).slice(0, 2) as Resource[]);
    return none(
      plan,
      { kind: 'discard', resources: discardChoice(hand, keep, count) },
      `Discarding ${count}, keeping what the plan needs.`,
    );
  }

  if (view.phase === 'setupRoad') {
    const options = legal.roads;
    if (options.length <= 1)
      return none(plan, { kind: 'road', edge: options[0] ?? 0 }, 'Only one road fits.');
    const best = rankRoads(board, options, plan.targetSite, 1)[0]!;
    return none(plan, { kind: 'road', edge: best }, 'Pointing the first road at the better corners.');
  }

  if (view.phase === 'freeRoads') {
    const best = rankRoads(board, legal.roads, plan.targetSite, 1)[0];
    if (best === undefined) return none(plan, { kind: 'endTurn' }, 'No road to build.');
    return none(plan, { kind: 'road', edge: best }, 'Taking a free road toward the target corner.');
  }

  // --- rungs that need judgement ------------------------------------------
  try {
    if (view.phase === 'setupSettlement') return await openingPlacement(ctx, plan);
    if (view.phase === 'robber') return await placeRobber(ctx, plan);
    if (view.phase === 'actions') return await takeTurn(ctx, plan);
  } catch (error) {
    if (!(error instanceof JevUnavailable)) throw error;
    return { ...degradedMove(ctx, plan), degraded: true };
  }

  return none(plan, { kind: 'endTurn' }, 'Nothing to do.');
}

/** The opening corner, which is the single most consequential decision of the
 *  game, so it gets the widest shortlist. */
async function openingPlacement(ctx: DecideContext, plan: BotPlan): Promise<Decision> {
  const { board, view, jev } = ctx;
  const options = rankCorners(board, view.legal.settlements, LIMIT.openingCorners);
  const criteria = Object.fromEntries(options.map((id) => [String(id), cornerFacts(board, id)]));
  const fallback = () => ({
    ...none(plan, { kind: 'settlement', vertex: options[0]! }, 'Taking the strongest corner by production.'),
    degraded: true,
  });
  if (!jev) return fallback();

  const ev = await jev.evaluate(
    {
      ...summarise(ctx),
      note: 'pips are how often a number rolls out of 36; 6 and 8 are the best at 5 each. Three different resources on one corner is usually worth more than raw production.',
    },
    { site: choice('Which corner is the strongest opening settlement?', criteria), ...planQuestions(ctx) },
  );
  const picked = Number(ev.answers.site?.type === 'choice' ? ev.answers.site.choice : options[0]);
  const vertex = options.includes(picked) ? picked : options[0]!;
  const next = readPlan(ctx, ev.answers, threatOf(ctx), vertex);
  return {
    action: { kind: 'settlement', vertex },
    plan: next,
    calls: 1,
    tokens: ev.inputTokens,
    costUsd: ev.costUsd,
    explain: `Opening on ${cornerFacts(board, vertex).produces.join(', ')}. ${describe(next, board)}`,
  };
}

async function placeRobber(ctx: DecideContext, plan: BotPlan): Promise<Decision> {
  const { board, view, meId, jev } = ctx;
  const { leaderWeight, huntsLeader } = contests(ctx.level);
  const hexes = rankRobberHexes(board, view, meId, LIMIT.robberHexes, leaderWeight);
  const first = hexes[0];
  if (first === undefined)
    return none(plan, { kind: 'robber', hex: view.robber }, 'Nowhere better to put the robber.');
  const pick = (hex: number) => {
    const victims = robberTargets(view, hex, meId);
    const leader = leaderOf(view, meId);
    const victim = (huntsLeader && victims.find((v) => v === leader?.id)) || victims[0];
    return { kind: 'robber', hex, ...(victim ? { victim } : {}) } as GameAction;
  };
  if (!jev || hexes.length === 1)
    return { ...none(plan, pick(first), 'Blocking the best tile available.'), degraded: !jev };

  const criteria = Object.fromEntries(
    hexes.map((id) => {
      const hex = board.hexes[id]!;
      const on = hex.vertices
        .map((v) => view.buildings[v])
        .filter(Boolean)
        .map((b) => `${view.players.find((p) => p.id === b!.player)?.name ?? '?'}'s ${b!.kind}`);
      return [
        String(id),
        {
          tile: `${RESOURCE_NAMES[hex.terrain as Resource] ?? 'desert'} on ${hex.number}`,
          blocks: on.length ? on : ['nobody'],
        },
      ];
    }),
  );
  // The question differs with the level too, because the two bots are weighing
  // genuinely different things and one prompt cannot stand for both.
  const ev = await jev.evaluate(summarise(ctx), {
    hex: choice(
      huntsLeader
        ? 'Where should the robber go to hurt the player most likely to win?'
        : 'Where should the robber go to block the most production?',
      criteria,
    ),
  });
  const answer = ev.answers.hex;
  const chosen =
    answer?.type === 'choice' && hexes.includes(Number(answer.choice)) ? Number(answer.choice) : first;
  return {
    action: pick(chosen),
    plan,
    calls: 1,
    tokens: ev.inputTokens,
    costUsd: ev.costUsd,
    explain: huntsLeader
      ? 'Robber onto the tile that costs the leader most.'
      : 'Robber onto the busiest tile that is not mine.',
  };
}

/** The main turn. One request covers what to do, where to do it, and, when the
 *  plan is stale, what the plan should become. */
async function takeTurn(ctx: DecideContext, plan: BotPlan): Promise<Decision> {
  const { board, view, meId, jev } = ctx;
  const legal = view.legal;
  const hand = handOf(view);
  const can = affordable(hand);

  const { shortlist, planLife, spendsEveryTurn } = contests(ctx.level);
  const corners = rankCorners(board, legal.settlements, shortlist.corners);
  const cities = legal.cities.slice(0, shortlist.corners);
  const roads = rankRoads(board, legal.roads, plan.targetSite, shortlist.roads);
  const playable = usableCards(ctx);

  const moves: Record<string, string> = {};
  if (corners.length) moves.settlement = 'build a settlement on a new corner: one point and more production';
  if (cities.length) moves.city = 'upgrade a settlement to a city: one point and double production';
  if (roads.length && can.includes('road')) moves.road = 'build a road toward a corner or for longest road';
  if (legal.canBuyCard) moves.card = 'buy a development card';
  const trade = bankTrade(hand, legal.rates, plan.needs, view.bank);
  if (trade)
    moves.trade = `trade ${RESOURCE_NAMES[trade.give].toLowerCase()} to the bank for the ${RESOURCE_NAMES[trade.receive].toLowerCase()} the plan needs`;
  const kinds = playableKinds(ctx);
  if (playable.length)
    moves.playCard = `play a development card: ${Object.keys(kinds)
      .map((kind) => CARD_NAMES[kind as CardKind] ?? kind)
      .join(' or ')}`;
  // Passing while a point is sitting there affordable is how a bot loses a
  // game it was winning. A champion goes further: if anything useful can be
  // bought, the turn is not over.
  const scoring = (corners.length && can.includes('settlement')) || (cities.length && can.includes('city'));
  const useful =
    scoring ||
    (spendsEveryTurn &&
      ((roads.length && can.includes('road')) || (legal.canBuyCard && can.includes('developmentCard'))));
  if (!useful) moves.endTurn = 'do nothing this turn and keep the resources';

  // Nothing worth asking about.
  if (!Object.keys(moves).length)
    return none(plan, { kind: 'endTurn' }, 'Nothing affordable; holding resources.');
  if (Object.keys(moves).length === 1 && moves.endTurn)
    return none(plan, { kind: 'endTurn' }, 'Nothing affordable; holding resources.');
  // One real option and no plan to revisit is not worth a decision either.
  if (Object.keys(moves).length === 2 && moves.trade && !plan.needs.length)
    return none(plan, { kind: 'endTurn' }, 'Only a trade available and nothing to save for.');

  const targetTaken = plan.targetSite !== null && !!view.buildings[plan.targetSite];
  const threat = threatOf(ctx);
  const stale = planIsStale(plan, { turn: view.turn, targetTaken, threat, everyFewTurns: planLife });

  const fallback = (): Decision => {
    // A card held to the end of the game was worth nothing. With no decision
    // service to ask, playing one beats passing on the turn, and the strongest
    // of them is picked here rather than the first that came out of the deck.
    const card = playable.length ? bestCardToPlay(ctx, playable) : undefined;
    const action: GameAction =
      cities.length && can.includes('city')
        ? { kind: 'city', vertex: cities[0]! }
        : corners.length && can.includes('settlement')
          ? { kind: 'settlement', vertex: corners[0]! }
          : roads.length && can.includes('road')
            ? { kind: 'road', edge: roads[0]! }
            : trade
              ? { kind: 'bankTrade', give: trade.give, receive: trade.receive }
              : legal.canBuyCard
                ? { kind: 'buyCard' }
                : card
                  ? playCard(ctx, plan, card)
                  : { kind: 'endTurn' };
    return { ...none(plan, action, 'Playing the plan without the decision service.'), degraded: true };
  };
  if (!jev) return fallback();

  const questions: Record<string, Question> = {
    move: choice('What is the best move right now?', moves),
    ...(corners.length
      ? {
          where_settlement: choice(
            'If a settlement is built, which corner?',
            Object.fromEntries(corners.map((id) => [String(id), cornerFacts(board, id)])),
          ),
        }
      : {}),
    ...(cities.length
      ? {
          where_city: choice(
            'If a city is built, which settlement should be upgraded?',
            Object.fromEntries(cities.map((id) => [String(id), cornerFacts(board, id)])),
          ),
        }
      : {}),
    ...(roads.length
      ? {
          where_road: choice(
            'If a road is built, which edge?',
            Object.fromEntries(
              roads.map((id) => {
                const e = board.edges[id]!;
                return [
                  String(id),
                  {
                    between_corners: [e.a + 1, e.b + 1],
                    toward: plan.targetSite !== null ? `corner ${plan.targetSite + 1}` : 'open board',
                  },
                ];
              }),
            ),
          ),
        }
      : {}),
    ...(playable.length
      ? {
          which_card: choice(
            'If a card is played, which one?',
            Object.fromEntries(
              playable.map((id) => {
                const kind = (view.players.find((p) => p.id === meId)?.cards ?? []).find(
                  (c) => c.id === id,
                )?.kind;
                return [
                  id,
                  {
                    card: kind ? (CARD_NAMES[kind] ?? kind) : 'card',
                    does: (kind && CARD_USE[kind]) ?? 'a one-off effect',
                  },
                ];
              }),
            ),
          ),
        }
      : {}),
    ...(stale ? planQuestions(ctx) : {}),
  };

  const ev = await jev.evaluate(summarise(ctx), questions);
  const move = ev.answers.move?.type === 'choice' ? ev.answers.move.choice : 'endTurn';
  const pickFrom = (key: string, options: number[]): number | undefined => {
    const a = ev.answers[key];
    const value = a?.type === 'choice' ? Number(a.choice) : NaN;
    return options.includes(value) ? value : options[0];
  };

  let action: GameAction = { kind: 'endTurn' };
  if (move === 'settlement' && corners.length)
    action = { kind: 'settlement', vertex: pickFrom('where_settlement', corners)! };
  else if (move === 'city' && cities.length)
    action = { kind: 'city', vertex: pickFrom('where_city', cities)! };
  else if (move === 'road' && roads.length) action = { kind: 'road', edge: pickFrom('where_road', roads)! };
  else if (move === 'card' && legal.canBuyCard) action = { kind: 'buyCard' };
  else if (move === 'trade' && trade)
    action = { kind: 'bankTrade', give: trade.give, receive: trade.receive };
  else if (move === 'playCard' && playable.length)
    action = playCard(
      ctx,
      plan,
      ev.answers.which_card?.type === 'choice' ? ev.answers.which_card.choice : playable[0]!,
    );

  const nextPlan = stale
    ? readPlan(ctx, ev.answers, threat, plan.targetSite ?? corners[0] ?? null)
    : {
        ...plan,
        decisions: plan.decisions + 1,
        needs: needsAndSurplus(hand, FOCUS_COST[effectiveFocus(plan, view)]).needs,
      };
  return {
    action,
    plan: nextPlan,
    calls: 1,
    tokens: ev.inputTokens,
    costUsd: ev.costUsd,
    explain: describe(nextPlan, board),
  };
}

/** Card arguments are worked out here rather than asked: which two resources a
 *  Year of Plenty should fetch is just the plan's shopping list. */
function playCard(ctx: DecideContext, plan: BotPlan, cardId: string): GameAction {
  const me = ctx.view.players.find((p) => p.id === ctx.meId);
  const kind = (me?.cards ?? []).find((c) => c.id === cardId)?.kind;
  const wanted = plan.needs.length ? plan.needs : (['ore', 'wheat'] as Resource[]);
  if (kind === 'yearOfPlenty') {
    // The rules want exactly two, or whatever is left if the bank is down to
    // one, and never a resource it has run out of.
    const stock: Hand = { ...ctx.view.bank };
    const resources: Hand = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
    let take = Math.min(
      2,
      RESOURCES.reduce((n, r) => n + stock[r], 0),
    );
    for (const r of [...wanted, ...RESOURCES]) {
      if (!take) break;
      if (stock[r] <= 0) continue;
      stock[r] -= 1;
      resources[r] += 1;
      take -= 1;
    }
    return { kind: 'playCard', cardId, resources };
  }
  if (kind === 'monopoly') return { kind: 'playCard', cardId, resource: wanted[0] ?? 'ore' };
  return { kind: 'playCard', cardId };
}

/** Used when the decision service cannot be reached at all. */
function degradedMove(ctx: DecideContext, plan: BotPlan): Decision {
  const { board, view } = ctx;
  if (view.phase === 'setupSettlement') {
    const options = rankCorners(board, view.legal.settlements, 1);
    return none(
      plan,
      { kind: 'settlement', vertex: options[0] ?? view.legal.settlements[0] ?? 0 },
      'Strongest corner by production.',
    );
  }
  if (view.phase === 'robber') {
    const hex = rankRobberHexes(board, view, ctx.meId, 1, contests(ctx.level).leaderWeight)[0] ?? view.robber;
    const victim = robberTargets(view, hex, ctx.meId)[0];
    return none(plan, { kind: 'robber', hex, ...(victim ? { victim } : {}) }, 'Blocking the strongest tile.');
  }
  const can = affordable(handOf(view));
  if (view.legal.cities.length && can.includes('city'))
    return none(plan, { kind: 'city', vertex: view.legal.cities[0]! }, 'Upgrading to a city.');
  if (view.legal.settlements.length && can.includes('settlement'))
    return none(
      plan,
      { kind: 'settlement', vertex: rankCorners(board, view.legal.settlements, 1)[0]! },
      'Taking a corner.',
    );
  return none(plan, { kind: 'endTurn' }, 'Holding resources.');
}
