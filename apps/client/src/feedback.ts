import type { RoomState } from '../../../packages/protocol/src/index.js';
import { RESOURCES, RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { emptyHand, total } from '../../../packages/rules/src/game.js';
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
  gains: { playerId: string; resource: Resource | 'any'; amount: number }[];
};
const bank = '[data-effect-bank]';
const card = (r: Resource) => `[data-resource-card="${r}"]`;
const resourceText = (hand: Hand) =>
  RESOURCES.filter((r) => hand[r])
    .map((r) => `${hand[r]} ${RESOURCE_NAMES[r]}`)
    .join(', ');
function rollFaces(line: string, playerName: string): readonly [number, number] | null {
  const prefix = playerName + ' rolled ';
  if (!line.startsWith(prefix)) return null;
  const match = /^([1-6]) \+ ([1-6]) = (\d+)\.$/.exec(line.slice(prefix.length));
  return match && Number(match[1]) + Number(match[2]) === Number(match[3])
    ? [Number(match[1]), Number(match[2])]
    : null;
}
/** Production is public board information. Verify every bank/count delta before labeling another player's gains. */
export function publicProduction(
  before: GameView,
  next: GameView,
  dice: readonly [number, number],
): Map<string, Hand> | null {
  const sum = dice[0] + dice[1];
  if (sum === 7 || before.robber !== next.robber) return null;
  const owed = new Map(before.players.map((p) => [p.id, emptyHand()]));
  for (const hex of before.board.hexes)
    if (hex.number === sum && hex.id !== before.robber && hex.terrain !== 'desert')
      for (const vertex of hex.vertices) {
        const building = before.buildings[vertex];
        if (building) {
          const payment = owed.get(building.player);
          if (!payment) return null;
          payment[hex.terrain] += building.kind === 'city' ? 2 : 1;
        }
      }
  const paid = new Map(before.players.map((p) => [p.id, emptyHand()]));
  for (const resource of RESOURCES) {
    const recipients = [...owed].filter(([, hand]) => hand[resource] > 0),
      needed = recipients.reduce((n, [, hand]) => n + hand[resource], 0);
    if (needed > before.bank[resource] && recipients.length > 1) continue;
    for (const [id, hand] of recipients)
      paid.get(id)![resource] = Math.min(hand[resource], before.bank[resource]);
  }
  if (
    RESOURCES.some(
      (resource) =>
        next.bank[resource] !==
        before.bank[resource] - [...paid.values()].reduce((n, hand) => n + hand[resource], 0),
    )
  )
    return null;
  for (const player of before.players) {
    const after = next.players.find((p) => p.id === player.id),
      payment = paid.get(player.id)!;
    if (!after || after.resourceCount - player.resourceCount !== total(payment)) return null;
    if (
      player.hand &&
      after.hand &&
      RESOURCES.some((resource) => after.hand![resource] - player.hand![resource] !== payment[resource])
    )
      return null;
  }
  return paid;
}
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
      offer.open &&
      (offer.proposals ?? []).some((proposal) => {
        const other = before.players.find((p) => p.id === proposal.player && p.id !== actor.id);
        return (
          other &&
          lines.includes(
            `${actor.name} traded ${resourceText(offer.give)} to ${other.name} for ${resourceText(proposal.give)}.`,
          )
        );
      })
    )
      return true;
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
  const faces = lines.flatMap((line) => {
    const result = rollFaces(line, before.players[before.active]!.name);
    return result ? [result] : [];
  })[0];
  const dice = g.dice && (!before.dice || before.turn !== g.turn) ? g.dice : faces;
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
    gains: [],
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
  const production = dice ? publicProduction(before, g, dice) : null;
  if (dice) {
    event.sounds.push('dice');
    const remaining = production
      ? new Map([...production].map(([id, hand]) => [id, { ...hand }]))
      : new Map<string, Hand>();
    for (const hex of before.board.hexes) {
      if (hex.number !== dice[0] + dice[1] || hex.id === before.robber || hex.terrain === 'desert') continue;
      for (const [id, payment] of remaining) {
        const units = hex.vertices.reduce(
          (n, v) =>
            n + (before.buildings[v]?.player === id ? (before.buildings[v]!.kind === 'city' ? 2 : 1) : 0),
          0,
        );
        const amount = Math.min(units, payment[hex.terrain]);
        if (!amount) continue;
        event.glowHexes.push(hex.id);
        event.flights.push({
          resource: hex.terrain,
          amount,
          from: `[data-effect-hex="${hex.id}"]`,
          to: id === me ? card(hex.terrain) : `[data-player-profile="${id}"]`,
        });
        payment[hex.terrain] -= amount;
        if (id === me) gain[hex.terrain] -= amount;
      }
    }
  }
  if (production) {
    for (const [id, payment] of production)
      for (const resource of RESOURCES)
        if (payment[resource]) event.gains.push({ playerId: id, resource, amount: payment[resource] });
  } else {
    for (const resource of RESOURCES)
      if (hand[resource] > old[resource])
        event.gains.push({ playerId: me, resource, amount: hand[resource] - old[resource] });
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
      if (delta > 0 && !production) {
        event.flights.push({
          resource: 'any',
          amount: delta,
          from: bank,
          to: `[data-player-profile="${p.id}"]`,
        });
        event.gains.push({ playerId: p.id, resource: 'any', amount: delta });
      }
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
    .filter((s) => !s.endsWith("'s turn.") && !before.players.some((player) => rollFaces(s, player.name)))
    .map((s) => s.replace(/ on edge \d+| at corner \d+/g, ''));
  if (!event.notices.length && g.turn !== before.turn)
    event.notices = [`${g.players[g.active]!.name}'s turn`];
  event.sounds = [...new Set(event.sounds)];
  event.glowHexes = [...new Set(event.glowHexes)];
  event.flights = event.flights.slice(0, 16);
  return event;
}
