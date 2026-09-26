/**
 * Open Sea's gold fields (section 9 of docs/RULEBOOK-OPEN-SEA.md): the picks a roll or a starting settlement is
 * owed, the order they are made in, and the default the clock makes. Pure functions, as in sea.ts.
 *
 * A gold field takes no part in ordinary production. producedResource, which production is to ask what a hex
 * pays, gives it nothing, so the Classic shortage rule runs as before and nothing owed from gold counts toward it.
 * The picks come after, from whatever the bank then holds (section 9.2).
 */
import { RESOURCES, RESOURCE_NAMES } from './index.js';
import type { Resource } from './index.js';
import type { Building, Hand } from './game.js';
import { producedResource } from './sea.js';
import type { SeaBoard } from './sea.js';

/** Seconds each player owed gold has for all of their picks, in every room, timer or not (section 9.5). */
export const GOLD_PICK_SECONDS = 20;
/** A player owed gold and how many picks they are owed. */
export type GoldOwed = { player: string; picks: number };
type Seat = { id: string; resigned?: boolean };

const none = (): Hand => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
const cards = (hand: Hand) => RESOURCES.reduce((n, r) => n + hand[r], 0);
const resourceText = (hand: Hand) =>
  RESOURCES.filter((r) => hand[r])
    .map((r) => `${hand[r]} ${RESOURCE_NAMES[r]}`)
    .join(', ');

/**
 * What a second starting settlement collects (sections 5.5 and 9.3): a matching resource for each adjacent hex
 * that produces one, and a pick for each adjacent gold field. A desert or a sea hex gives nothing.
 */
export function startingResources(board: SeaBoard, vertex: number): { resources: Hand; goldPicks: number } {
  const resources = none();
  let goldPicks = 0;
  for (const h of board.vertices[vertex]!.hexes) {
    const hex = board.hexes[h]!,
      resource = producedResource(hex);
    if (resource) resources[resource]++;
    else if (hex.terrain === 'gold') goldPicks++;
  }
  return { resources, goldPicks };
}
/**
 * The picks a roll pays from gold fields (sections 9.1 and 9.2): each settlement on a gold field with that number
 * earns its owner 1, each city 2, unless the robber is on the field; resigned players' buildings pay nothing. The
 * players pick in turn order, starting with the player on turn, `active` being their seat. `bank` is the bank once
 * ordinary production is done: if it holds no cards, every pick lapses at once, so no game waits on a pick nobody
 * could make.
 */
export function goldOwedForRoll(
  g: {
    board: SeaBoard;
    buildings: Record<number, Building>;
    robber: number;
    players: readonly Seat[];
    active: number;
    bank: Hand;
  },
  roll: number,
): GoldOwed[] {
  if (!cards(g.bank)) return [];
  const owed = new Map<string, number>();
  for (const hex of g.board.hexes)
    if (hex.terrain === 'gold' && hex.number === roll && hex.id !== g.robber)
      for (const v of hex.vertices) {
        const building = g.buildings[v];
        if (building && !g.players.find((p) => p.id === building.player)?.resigned)
          owed.set(building.player, (owed.get(building.player) ?? 0) + (building.kind === 'city' ? 2 : 1));
      }
  const seats = g.players.length;
  return Array.from({ length: seats }, (_, i) => g.players[(g.active + i) % seats]!.id)
    .filter((id) => owed.has(id))
    .map((id) => ({ player: id, picks: owed.get(id)! }));
}
/** The types a pick may take: those the bank still holds, which is all the picker offers (sections 9.2 and 14). */
export const goldPickTypes = (bank: Hand): Resource[] => RESOURCES.filter((r) => bank[r] > 0);
/**
 * The picks still to make, in order (section 9.2): none for a player who is owed none or has resigned, and none at
 * all once the bank holds no cards, when every remaining pick lapses. A lapsed pick is not owed later.
 */
export function remainingGoldOwed(
  goldOwed: readonly GoldOwed[],
  bank: Hand,
  players: readonly Seat[],
): GoldOwed[] {
  if (!cards(bank)) return [];
  return goldOwed.filter((o) => o.picks > 0 && !players.find((p) => p.id === o.player)?.resigned);
}
/**
 * Why these picks are not allowed, or null (section 9.2). Only the first player owed gold picks, and they make all
 * their picks in one action, as with Year of Plenty: exactly as many cards as they are owed, or every card the bank
 * holds if that is fewer, each of a type the bank has. Picks cannot be declined or saved for later.
 */
export function goldPickIssue(
  g: { bank: Hand; goldOwed?: readonly GoldOwed[] },
  player: string,
  picks: Hand,
): string | null {
  const next = g.goldOwed?.[0];
  if (next?.player !== player) return 'It is not your turn to pick from a gold field';
  if (RESOURCES.some((r) => !Number.isInteger(picks[r]) || picks[r] < 0))
    return 'Choose whole resource counts';
  const due = Math.min(next.picks, cards(g.bank));
  if (cards(picks) !== due) return due === 1 ? 'Choose 1 resource' : `Choose ${due} resources`;
  if (RESOURCES.some((r) => picks[r] > g.bank[r])) return 'The bank does not have those resources';
  return null;
}
/**
 * Makes all of a player's gold picks, returning the bank, the players and the picks still owed. The next player
 * owed gold picks next, from the bank as it now stands, unless it is empty, when the remaining picks lapse (9.2).
 */
export function applyGoldPick<P extends Seat & { hand: Hand }>(
  g: { bank: Hand; goldOwed?: readonly GoldOwed[]; players: readonly P[] },
  player: string,
  picks: Hand,
): { bank: Hand; players: P[]; goldOwed: GoldOwed[] } {
  const issue = goldPickIssue(g, player, picks);
  if (issue) throw new Error(issue);
  const bank = { ...g.bank };
  const players = g.players.map((p) => {
    if (p.id !== player) return p;
    const hand = { ...p.hand };
    for (const r of RESOURCES) {
      hand[r] += picks[r];
      bank[r] -= picks[r];
    }
    return { ...p, hand };
  });
  return { bank, players, goldOwed: remainingGoldOwed(g.goldOwed!.slice(1), bank, players) };
}
/**
 * The pick the clock makes for a player whose 20 seconds ran out (section 9.5): the resource they hold fewest of
 * among those the bank still holds, ties going to the first of Timber, Clay, Sheep, Hay and Rock. None from an
 * empty bank.
 */
export function defaultGoldPick(hand: Hand, bank: Hand): Resource | null {
  let pick: Resource | null = null;
  for (const r of RESOURCES) if (bank[r] > 0 && (pick === null || hand[r] < hand[pick])) pick = r;
  return pick;
}
/** The clock's picks for every card still owed, taken one at a time, each counting the cards just taken (9.5). */
export function defaultGoldPicks(hand: Hand, bank: Hand, owed: number): Hand {
  const held = { ...hand },
    left = { ...bank },
    picks = none();
  for (let i = 0; i < owed; i++) {
    const r = defaultGoldPick(held, left);
    if (!r) break;
    held[r]++;
    left[r]--;
    picks[r]++;
  }
  return picks;
}
/** The move history's line for gold picks, which are public once made, as Year of Plenty's are (section 14). */
export const goldPickText = (name: string, picks: Hand) =>
  `${name} took ${resourceText(picks)} from the bank for gold.`;
