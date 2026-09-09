import type { RoomState } from '../../../packages/protocol/src/index.js';
import { RESOURCES, RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { emptyHand } from '../../../packages/rules/src/game.js';
import type { GameView, Hand } from '../../../packages/rules/src/game.js';
import type { SoundCue } from './sound.js';
export type FlightIntent = {
  resource: Resource | 'any';
  amount: number;
  from: string;
  to: string;
  spending?: boolean;
};
export type FeedbackEvent = {
  id: string;
  dice?: readonly [number, number];
  notices: string[];
  sounds: SoundCue[];
  flights: FlightIntent[];
  glowHexes: number[];
  sites: string[];
  hand: Hand;
  changed: Resource[];
};
const bank = '[data-effect-bank]';
const card = (r: Resource) => `[data-resource-card="${r}"]`;
const resourceText = (hand: Hand) =>
  RESOURCES.filter((r) => hand[r])
    .map((r) => `${hand[r]} ${RESOURCE_NAMES[r]}`)
    .join(', ');
/** Trade sounds use canonical public evidence, including equal-count trades invisible to observers' hands. */
function traded(before: GameView, next: GameView, lines: string[]): boolean {
  if (
    before.phase !== 'actions' ||
    next.phase !== 'actions' ||
    before.turn !== next.turn ||
    before.active !== next.active ||
    before.robber !== next.robber ||
    next.players.some((p) => p.cardCount !== before.players.find((q) => q.id === p.id)?.cardCount)
  )
    return false;
  const actor = before.players[before.active]!;
  if (before.trade?.player === actor.id && !next.trade) {
    const offer = before.trade;
    if (
      before.players.some(
        (p) =>
          p.id !== actor.id &&
          lines.includes(
            `${actor.name} traded ${resourceText(offer.give)} to ${p.name} for ${resourceText(offer.want)}.`,
          ),
      )
    )
      return true;
  }
  const given = RESOURCES.filter((r) => next.bank[r] > before.bank[r]);
  const taken = RESOURCES.filter((r) => next.bank[r] < before.bank[r]);
  if (given.length !== 1 || taken.length !== 1) return false;
  const give = given[0]!,
    take = taken[0]!,
    rate = next.bank[give] - before.bank[give];
  return (
    [2, 3, 4].includes(rate) &&
    before.bank[take] - next.bank[take] === 1 &&
    lines.includes(
      `${actor.name} traded ${rate} ${RESOURCE_NAMES[give]} for 1 ${RESOURCE_NAMES[take]} at ${rate}:1.`,
    )
  );
}
/** Presentation is derived only from installed, committed snapshots, never from click intent. */
export function deriveFeedback(
  previous: RoomState | null,
  next: RoomState,
  me: string,
): FeedbackEvent | null {
  if (!previous?.game || !next.game || previous.roomId !== next.roomId || next.revision <= previous.revision)
    return null;
  const before = previous.game,
    g = next.game;
  const old = before.players.find((p) => p.id === me)?.hand,
    hand = g.players.find((p) => p.id === me)?.hand;
  if (!old || !hand) return null;
  const lines = g.log.filter((e) => e.id > (before.log.at(-1)?.id ?? -1)).map((e) => e.text);
  const rollPrefix = before.players[before.active]!.name + ' rolled ';
  const timedRoll = lines.find((line) => line.startsWith(rollPrefix));
  const faces = timedRoll ? /^([1-6]) \+ ([1-6]) = (\d+)\.$/.exec(timedRoll.slice(rollPrefix.length)) : null;
  const dice =
    g.dice && (!before.dice || before.turn !== g.turn)
      ? g.dice
      : faces && Number(faces[1]) + Number(faces[2]) === Number(faces[3])
        ? ([Number(faces[1]), Number(faces[2])] as const)
        : undefined;
  const event: FeedbackEvent = {
    id: `${next.roomId}:${next.revision}`,
    dice,
    notices: [],
    sounds: [],
    flights: [],
    glowHexes: [],
    sites: [],
    hand: { ...hand },
    changed: RESOURCES.filter((r) => old[r] !== hand[r]),
  };
  const gain = emptyHand();
  for (const r of RESOURCES) gain[r] = Math.max(0, hand[r] - old[r]);
  for (const [id, building] of Object.entries(g.buildings))
    if (before.buildings[Number(id)]?.kind !== building.kind) {
      event.sites.push(`[data-building-id="${id}"]`);
      event.sounds.push(building.kind);
    }
  for (const id of Object.keys(g.roads))
    if (!before.roads[Number(id)]) {
      event.sites.push(`[data-road-id="${id}"]`);
      event.sounds.push('road');
    }
  if (dice) {
    event.sounds.push('dice');
    for (const hex of g.board.hexes) {
      if (hex.number !== dice[0] + dice[1] || hex.id === g.robber || hex.terrain === 'desert') continue;
      const units = hex.vertices.reduce(
        (sum, v) => sum + (g.buildings[v]?.player === me ? (g.buildings[v]!.kind === 'city' ? 2 : 1) : 0),
        0,
      );
      const amount = Math.min(units, gain[hex.terrain]);
      if (amount) {
        event.glowHexes.push(hex.id);
        event.flights.push({
          resource: hex.terrain,
          amount,
          from: `[data-effect-hex="${hex.id}"]`,
          to: card(hex.terrain),
        });
        gain[hex.terrain] -= amount;
      }
    }
  }
  for (const r of RESOURCES) {
    if (gain[r])
      event.flights.push({
        resource: r,
        amount: gain[r],
        from: g.robber !== before.robber ? `[data-effect-hex="${g.robber}"]` : bank,
        to: card(r),
      });
    if (hand[r] < old[r])
      event.flights.push({
        resource: r,
        amount: old[r] - hand[r],
        from: card(r),
        to: event.sites[0] ?? (before.robber !== g.robber ? `[data-effect-hex="${g.robber}"]` : bank),
        spending: true,
      });
  }
  // Other hands remain private: show a card back and public count, never infer theft identities.
  for (const p of g.players)
    if (p.id !== me) {
      const delta =
        p.resourceCount - (before.players.find((q) => q.id === p.id)?.resourceCount ?? p.resourceCount);
      if (delta > 0)
        event.flights.push({
          resource: 'any',
          amount: delta,
          from: bank,
          to: `[data-player-profile="${p.id}"]`,
        });
    }
  if (event.flights.some((f) => !f.spending && f.resource !== 'any')) event.sounds.push('gain');
  if (event.flights.some((f) => f.spending)) event.sounds.push('spend');
  if (before.robber !== g.robber) event.sounds.push('robber');
  const knight = g.players.some(
    (p) => p.knights > (before.players.find((q) => q.id === p.id)?.knights ?? p.knights),
  );
  if (knight) event.sounds.push('knight');
  else if (
    g.players.some(
      (p) => p.cardCount !== (before.players.find((q) => q.id === p.id)?.cardCount ?? p.cardCount),
    )
  )
    event.sounds.push('development');
  if (!dice && !event.sites.length && traded(before, g, lines)) event.sounds.push('trade');
  if (g.winner && !before.winner) event.sounds.push('win');
  else if (
    (g.longestRoad && g.longestRoad !== before.longestRoad) ||
    (g.largestArmy && g.largestArmy !== before.largestArmy)
  )
    event.sounds.push('award');
  if (g.turn !== before.turn && g.players[g.active]?.id === me) event.sounds.push('turn');
  event.notices = lines
    .filter((s) => !s.endsWith("'s turn."))
    .map((s) => s.replace(/ on edge \d+| at corner \d+/g, ''));
  if (!event.notices.length && g.turn !== before.turn)
    event.notices = [`${g.players[g.active]!.name}'s turn`];
  event.sounds = [...new Set(event.sounds)];
  event.flights = event.flights.slice(0, 16);
  return event;
}
