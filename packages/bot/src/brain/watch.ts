/**
 * Watching the table between decisions.
 *
 * The bot driver hands every consecutive pair of game states to `watch`, for each
 * bot at the table. The public facts go into the card counting; the moments go
 * back to the driver, which may turn one into a reaction; and what each opponent
 * did to this bot (robbed it, refused its offer, traded with it) goes into the
 * bot's record of how they play.
 */

import type { Game } from '../../../rules/src/game.js';
import { learn } from './belief.js';
import { drew } from './dice.js';
import { observe } from './facts.js';
import type { TableEvent } from './facts.js';
import { profileOf } from './mind.js';
import type { Mind } from './mind.js';
import { handSize, income } from './table.js';
import type { Table } from './table.js';

export function watch(mind: Mind, me: string, before: Game, after: Game): TableEvent[] {
  const { facts, events } = observe(before, after, me);
  // What a player not yet counted is guessed to hold: how many cards (public) in
  // proportion to what their buildings produce (public).
  const prior = (id: string) => ({
    count: handSize(before.players.find((p) => p.id === id)?.hand ?? after.players.find((p) => p.id === id)!.hand),
    income: income(before as unknown as Table, id),
  });
  for (const fact of facts) {
    if ('player' in fact && fact.player === me && fact.kind !== 'count') continue;
    learn(mind.belief, fact, prior);
  }
  const refused = (id: string) => {
    const p = profileOf(mind, id);
    p.declined++;
    p.refusals = (p.refusals ?? 0) + 1;
    p.refusedTurn = after.turn;
  };
  // The bot's own offer gone with no trade: everyone who did not take it refused it.
  if (before.trade?.player === me && !after.trade && !events.some((e) => e.kind === 'trade'))
    for (const p of after.players)
      if (p.id !== me && !before.trade.declinedBy?.includes(p.id) && !p.resigned) refused(p.id);
  for (const e of events) {
    if (e.kind === 'roll' && after.diceMode === 'balanced') mind.dice = drew(mind.dice, e.dice, e.first);
    if (e.kind === 'steal' && e.victim === me) profileOf(mind, e.thief).robbedMe++;
    if (e.kind === 'declined' && e.maker === me) refused(e.by);
    if (e.kind === 'trade' && e.players.includes(me)) {
      const partner = profileOf(mind, e.players.find((p) => p !== me)!);
      partner.accepted++;
      partner.refusals = 0;
      if (before.trade?.player === me) mind.trading.filled++;
    }
    if (e.kind === 'steal' && e.thief === me) mind.lastVictim = e.victim;
  }
  return events;
}
