import { roadSites, total } from '../../../packages/rules/src/game.js';
import type { Card, CardKind, GameView } from '../../../packages/rules/src/game.js';
import { findRuleset } from '../../../packages/rules/src/rulesets.js';
import { roadBuildingSites } from '../../../packages/rules/src/sea.js';
export const DEVELOPMENT_ART_INDEX: Record<CardKind, number> = {
  knight: 0,
  roadBuilding: 1,
  yearOfPlenty: 2,
  monopoly: 3,
  victoryPoint: 4,
};
export const CARD_LORE: Record<CardKind, { title: string; story: string; effect: string }> = {
  knight: {
    title: 'The harbor watch',
    story: 'A watchman lifts his lantern. Somewhere in the hills, the robber thinks better of staying.',
    effect:
      'Move the robber and steal one random resource from an adjacent opponent. Counts toward Largest Army.',
  },
  roadBuilding: {
    title: 'A path through the wilds',
    story: 'Your trailblazers return with muddy boots and a route nobody else could see.',
    effect: 'Build up to two legal roads without spending resources.',
  },
  yearOfPlenty: {
    title: 'The generous season',
    story: 'The market awnings rise. For once, the island has exactly what you need.',
    effect: 'Choose two available resource cards from the bank. They may be the same type.',
  },
  monopoly: {
    title: 'The merchant’s charter',
    story: 'One wax seal, one well-timed bargain. Every crate of your chosen cargo is yours.',
    effect: 'Choose one resource. Every other player gives you all their cards of that type.',
  },
  victoryPoint: {
    title: 'A place in the legends',
    story: 'Long after the last sail leaves the harbor, the island will remember what you built.',
    effect: 'Adds one hidden victory point automatically. Reveal it when you win; this card is never played.',
  },
};
/**
 * What Open Sea's cards do differently (docs/RULEBOOK-OPEN-SEA.md, section 13): a Knight moves the robber or the
 * pirate, and Road Building places roads or ships.
 */
const SEA_EFFECTS: Partial<Record<CardKind, string>> = {
  knight:
    'Move the robber or the pirate, and steal one random resource from a player beside it. Counts toward Largest Army.',
  roadBuilding: 'Build up to two legal roads or ships, in any mix, without spending resources.',
};
/** What a card does, in the game's own mode. */
export const cardEffect = (kind: CardKind, game: Pick<GameView, 'ruleset'>) =>
  (findRuleset(game.ruleset)?.sea && SEA_EFFECTS[kind]) || CARD_LORE[kind].effect;
export function cardLockReason(card: Card, game: GameView, me: string): string | null {
  if (card.kind === 'victoryPoint') return 'Already counts toward your victory points.';
  if (game.winner) return 'The game has ended.';
  if (game.legal.playableCards.includes(card.id)) {
    // Open Sea's Road Building needs one legal road or ship, each by its own rule and from its own supply.
    if (card.kind === 'roadBuilding' && findRuleset(game.ruleset)?.sea) {
      const sites = roadBuildingSites(game, me);
      if (!sites.roads.length && !sites.ships.length)
        return 'You need a road or ship to place and a legal place for it.';
    } else if (
      card.kind === 'roadBuilding' &&
      ((game.players.find((p) => p.id === me)?.pieces.roads ?? 15) >= 15 || !roadSites(game, me).length)
    )
      return 'You need an available road piece and a legal road connection.';
    if (card.kind === 'yearOfPlenty' && !total(game.bank)) return 'The bank has no resource cards to take.';
    return null;
  }
  if (card.boughtTurn === game.turn) return 'You can play this on your next turn.';
  if (game.players[game.active]?.id !== me) {
    // Big Table: a Partner plays theirs in their own phase, after the Lead's part.
    const seat = game.players.findIndex((p) => p.id === me);
    return game.pair?.partner === seat && game.pair.lead === game.active
      ? 'You can play this in your Partner’s phase.'
      : 'You can play this on your turn.';
  }
  if (game.phase === 'buildWindow') return 'No development card is played in a build window.';
  if (game.playedCard)
    return game.phase === 'partner' || game.returnPhase === 'partner'
      ? 'You have already played a development card this phase.'
      : 'You have already played a development card this turn.';
  return 'Finish the current action first.';
}
export const RESOURCE_DESCRIPTION = {
  wood: 'Timber for roads and settlements.',
  brick: 'Clay for roads and settlements.',
  sheep: 'Sheep for settlements and development cards.',
  wheat: 'Hay for settlements, cities, and development cards.',
  ore: 'Rock for cities and development cards.',
};
