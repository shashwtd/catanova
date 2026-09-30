/**
 * Jev as an advisor.
 *
 * The engine plays every move by itself. Jev is asked only when the engine's own
 * numbers cannot separate the choices and the choice matters: which long game to
 * play when two plans race to ten points at about the same speed, whether a close
 * trade with a person is wise, and which of two near-equal robber targets is the
 * real threat. There is no quota: a game where nothing is close asks nothing, and
 * a tense one asks more.
 *
 * Jev always sees the engine's shortlist with its numbers, never raw state and
 * never anything hidden, and players only as "me" and "opponent 1" to "opponent
 * 3". Its answer shifts the engine's choice and never overrides a clear one. If
 * the service is slow or down the engine's own answer stands.
 */

import type { GameView } from '../../../rules/src/game.js';
import { choice, noul, JevUnavailable } from '../jev.js';
import type { JevClient } from '../jev.js';
import { seatLabel } from '../heuristics.js';
import type { Strategy } from './race.js';
import type { Verdict } from './trade.js';
import type { Profile } from './mind.js';

export type Advice<T> = { value: T; calls: number; tokens: number; costUsd: number; asked: boolean };

const STRATEGY_TEXT: Record<Strategy, string> = {
  cities: 'Upgrade to cities on rock and hay, then win on city points',
  expansion: 'Build roads and new settlements to claim corners and production',
  development: 'Buy development cards for knights, largest army and hidden points',
  road: 'Build a long road for longest road while expanding',
};

const table = (view: GameView, meId: string) =>
  view.players.map((p) => ({
    who: seatLabel(view, meId, p.id),
    points: p.points,
    cards_in_hand: p.resourceCount,
    development_cards: p.cardCount,
    knights: p.knights,
    road: p.roadLength,
  }));

const none = <T>(value: T): Advice<T> => ({ value, calls: 0, tokens: 0, costUsd: 0, asked: false });

/**
 * The long game, when two plans are close. `rolls` is the engine's estimate of
 * rolls to ten points under each plan; the fastest wins outright unless the next
 * one is within a tenth of it.
 */
export async function adviseStrategy(
  jev: JevClient | null,
  view: GameView,
  meId: string,
  rolls: Record<Strategy, number>,
): Promise<Advice<Strategy>> {
  const ranked = (Object.entries(rolls) as [Strategy, number][]).sort((a, b) => a[1] - b[1]);
  const best = ranked[0]![0];
  const close = ranked.filter(([, r]) => r <= ranked[0]![1] * 1.1);
  if (!jev || close.length < 2) return none(best);
  try {
    const ev = await jev.evaluate(
      {
        question: 'Which long-term plan should this Catan player follow?',
        table: table(view, meId),
        target: view.victoryPoints ?? 10,
        note: 'Each plan comes with the engine estimate of dice rolls needed to reach the target. The plans listed are close.',
      },
      {
        plan: choice(
          'Which plan gives the best chance of winning from here, considering the other players?',
          Object.fromEntries(
            close.map(([s, r]) => [s, { plan: STRATEGY_TEXT[s], estimated_rolls_to_win: Math.round(r) }]),
          ),
        ),
      },
    );
    const a = ev.answers.plan;
    const picked = a?.type === 'choice' && close.some(([s]) => s === a.choice) ? (a.choice as Strategy) : best;
    return { value: picked, calls: 1, tokens: ev.inputTokens, costUsd: ev.costUsd, asked: true };
  } catch (error) {
    if (!(error instanceof JevUnavailable)) throw error;
    return none(best);
  }
}

/**
 * A close trade with a person. The engine already found it good for the bot;
 * Jev is asked whether, given how that person has been playing, it is wise.
 */
export async function adviseTrade(
  jev: JevClient | null,
  view: GameView,
  meId: string,
  partner: string,
  verdict: Verdict,
  profile: Profile | undefined,
): Promise<Advice<boolean>> {
  if (!jev || !verdict.marginal) return none(verdict.ok);
  try {
    const ev = await jev.evaluate(
      {
        question: 'A Catan bot is considering a trade with a human player.',
        table: table(view, meId),
        partner: seatLabel(view, meId, partner),
        engine: {
          my_gain_in_win_chance_points: +(verdict.mine * 100).toFixed(2),
          their_gain_in_win_chance_points: +(verdict.theirs * 100).toFixed(2),
        },
        partner_history: profile ?? {},
      },
      {
        wise: noul('Is making this trade with them wise for me, given the table and how they have been playing?', {
          true: 'The trade helps me more than it helps them, and they are not about to win',
          false: 'The trade feeds a dangerous player or gives away more than it gets',
        }),
      },
    );
    const a = ev.answers.wise;
    const yes = a?.type === 'noul' ? a.probability >= 0.45 : verdict.ok;
    return { value: yes, calls: 1, tokens: ev.inputTokens, costUsd: ev.costUsd, asked: true };
  } catch (error) {
    if (!(error instanceof JevUnavailable)) throw error;
    return none(verdict.ok);
  }
}

/** Two robber placements the engine scores about the same, hitting different people: who is the real threat? */
export async function adviseThreat(
  jev: JevClient | null,
  view: GameView,
  meId: string,
  victims: string[],
): Promise<Advice<string | null>> {
  if (!jev || victims.length < 2) return none(null);
  try {
    const ev = await jev.evaluate(
      { question: 'Who is the bigger threat to win this game of Catan?', table: table(view, meId) },
      {
        threat: choice(
          'Which of these players is the bigger threat to win?',
          Object.fromEntries(victims.map((v) => [seatLabel(view, meId, v), { player: seatLabel(view, meId, v) }])),
        ),
      },
    );
    const a = ev.answers.threat;
    const picked = a?.type === 'choice' ? (victims.find((v) => seatLabel(view, meId, v) === a.choice) ?? null) : null;
    return { value: picked, calls: 1, tokens: ev.inputTokens, costUsd: ev.costUsd, asked: true };
  } catch (error) {
    if (!(error instanceof JevUnavailable)) throw error;
    return none(null);
  }
}
