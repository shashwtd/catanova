/**
 * When a bot throws a reaction across the table.
 *
 * Bots never chat, since research found a talkative bot reads as a threat and
 * gets ganged up on, but faces are another matter: a bot that laughs when your
 * seven eats half your hand is part of the fun. Games are long and the end
 * screen is brief, so the personality lives in the middle of the game, and it
 * is a little toxic: now and then it gloats when it robs you, laughs at a big
 * discard, smirks when it takes an award off you, and rages at someone who keeps
 * robbing it.
 *
 * Restraint is what makes it land: a face only for a moment worth one, never
 * for routine play, at least forty-five seconds apart, eight a game at most, one
 * face at a time, and one bot at a table. Players found a face every few turns
 * cringe, so most games now see a handful.
 */

import type { ReactionName } from '../../../protocol/src/reactions.js';
import type { TableEvent } from './facts.js';
import type { Mind } from './mind.js';

export const REACTION_GAP_MS = 45_000;
export const REACTIONS_PER_GAME = 8;

type Moment = { weight: number; chance: number; faces: ReactionName[][] };

/**
 * The faces to throw, or null. `faces` lists alternatives; one is chosen at
 * random, and each alternative can be several faces in a row.
 */
export function reactTo(
  events: readonly TableEvent[],
  me: string,
  mind: Mind,
  context: { now: number; random: () => number; target: number; handBefore?: number },
): ReactionName[] | null {
  if (context.now - mind.reacted.at < REACTION_GAP_MS || mind.reacted.count >= REACTIONS_PER_GAME) {
    // A win always gets its moment.
    if (!events.some((e) => e.kind === 'win')) return null;
  }
  const moments: Moment[] = [];
  const add = (weight: number, chance: number, ...faces: ReactionName[][]) => moments.push({ weight, chance, faces });
  for (const e of events) {
    switch (e.kind) {
      case 'win':
        if (e.player === me) add(100, 0.9, ['laugh', 'smug'], ['nice', 'smug'], ['smug']);
        else add(90, 0.3, ['dead'], ['eyeroll']);
        break;
      case 'monopoly': {
        const fromMe = e.taken[me] ?? 0;
        if (fromMe >= 3) add(60, 0.5, ['shock'], ['angry'], ['dead']);
        const total = Object.values(e.taken).reduce((a, b) => a + b, 0);
        if (e.player === me && total >= 4) add(58, 0.6, ['evil'], ['laugh']);
        break;
      }
      case 'steal':
        if (e.victim === me && (mind.profiles[e.thief]?.robbedMe ?? 0) >= 2) add(50, 0.45, ['angry'], ['suspicious']);
        else if (e.victim === me) add(30, 0.15, ['angry'], ['eyeroll']);
        else if (e.thief === me) add(35, 0.25, ['evil'], ['laugh'], ['smug']);
        break;
      case 'discard':
        if (e.player === me && e.count >= 4) add(40, 0.35, ['dead'], ['sad']);
        else if (e.player !== me && e.count >= 4) add(38, 0.35, ['laugh']);
        break;
      case 'award':
        if (e.to === me && e.from) add(45, 0.5, ['smug'], ['laugh']);
        else if (e.from === me) add(42, 0.35, ['shock'], ['angry']);
        break;
      case 'points':
        if (e.player !== me && e.points >= context.target - 1) add(35, 0.3, ['suspicious']);
        break;
      default:
        break;
    }
  }
  if (!moments.length) return null;
  const top = moments.reduce((a, b) => (b.weight > a.weight ? b : a));
  if (context.random() >= top.chance) return null;
  const faces = top.faces[Math.floor(context.random() * top.faces.length)] ?? top.faces[0]!;
  return faces;
}

/** Remember a reaction was thrown. */
export function reacted(mind: Mind, now: number) {
  mind.reacted = { at: now, count: mind.reacted.count + 1 };
}
