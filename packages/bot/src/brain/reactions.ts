/**
 * When a bot throws a reaction across the table.
 *
 * Bots never chat, since research found a talkative bot reads as a threat and
 * gets ganged up on, but faces are another matter: a bot that laughs when your
 * seven eats half your hand is part of the fun. Games are long and the end
 * screen is brief, so the personality lives in the middle of the game. A bot is
 * a little toxic, in the way friends at a table are: it gloats when it robs
 * you, laughs at your discards, rolls its eyes when you turn down its offer,
 * honks a clown at yours, and smirks when it takes an award off you. When it is
 * the one hurt, it sulks or rages.
 *
 * It is still a player, not a slot machine: at least twelve seconds between
 * reactions, twenty-four in a game at most, and in any stretch of play only the one
 * moment that matters most to it, and only one bot at a table.
 */

import type { ReactionName } from '../../../protocol/src/reactions.js';
import type { TableEvent } from './facts.js';
import type { Mind } from './mind.js';

export const REACTION_GAP_MS = 12_000;
export const REACTIONS_PER_GAME = 24;

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
        if (e.player === me) add(100, 0.95, ['nice', 'smug', 'laugh'], ['laugh', 'laugh', 'smug'], ['smug', 'nice']);
        else add(90, 0.5, ['dead'], ['angry'], ['eyeroll']);
        break;
      case 'monopoly': {
        const fromMe = e.taken[me] ?? 0;
        if (fromMe >= 3) add(60, 0.8, ['shock', 'angry'], ['dead'], ['angry', 'angry']);
        else if (fromMe > 0) add(30, 0.45, ['eyeroll'], ['angry']);
        const total = Object.values(e.taken).reduce((a, b) => a + b, 0);
        if (e.player === me && total >= 3) add(58, 0.85, ['evil', 'laugh'], ['laugh', 'laugh'], ['smug', 'evil']);
        break;
      }
      case 'steal':
        if (e.victim === me) {
          const again = mind.profiles[e.thief]?.robbedMe ?? 0;
          if (again >= 1) add(50, 0.75, ['angry', 'angry'], ['suspicious', 'angry'], ['angry', 'eyeroll']);
          else add(45, 0.55, ['angry'], ['sad'], ['suspicious']);
        } else if (e.thief === me) add(40, 0.6, ['evil'], ['laugh'], ['smug'], ['evil', 'laugh']);
        break;
      case 'discard':
        if (e.player === me && e.count >= 4) add(48, 0.6, ['dead'], ['sad', 'sad'], ['angry']);
        else if (e.player === me) add(20, 0.3, ['sad'], ['eyeroll']);
        else if (e.count >= 4) add(38, 0.6, ['laugh'], ['laugh', 'laugh'], ['wink']);
        else add(15, 0.18, ['laugh']);
        break;
      case 'award':
        if (e.to === me && e.from) add(47, 0.75, ['smug'], ['laugh', 'smug'], ['nice']);
        else if (e.to === me) add(40, 0.55, ['nice'], ['smug']);
        else if (e.from === me) add(42, 0.6, ['shock'], ['angry'], ['suspicious']);
        break;
      case 'points':
        if (e.player !== me && e.points >= context.target - 1) add(35, 0.45, ['suspicious'], ['shock']);
        else if (e.player === me && e.points >= context.target - 2) add(30, 0.35, ['evil'], ['smug']);
        break;
      case 'robber':
        if (e.player !== me && e.blocks.includes(me)) add(25, 0.35, ['eyeroll'], ['suspicious'], ['angry']);
        else if (e.player === me && e.blocks.length) add(22, 0.3, ['evil'], ['smug']);
        break;
      case 'declined':
        // Its offer turned down: a roll of the eyes, sometimes the clown.
        if (e.maker === me) add(20, 0.25, ['eyeroll'], ['wink'], ['pleading']);
        // It turned down somebody else's offer: honk.
        else if (e.by === me) add(14, 0.18, ['wink'], ['laugh'], ['eyeroll']);
        break;
      case 'offer':
        if (e.player === me) add(10, 0.15, ['pleading']);
        break;
      case 'build':
        if (e.player === me && e.what === 'city') add(18, 0.25, ['smug'], ['nice']);
        else if (e.player === me && e.what === 'settlement') add(12, 0.12, ['smug']);
        break;
      case 'roll':
        if (e.player === me && e.total === 7) add(28, 0.45, ['evil'], ['evil', 'laugh']);
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
