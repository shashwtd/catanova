/**
 * When a bot throws a reaction across the table.
 *
 * Bots never chat, since research found a talkative bot reads as a threat and
 * gets ganged up on, but a face at the right moment makes a table feel alive. A
 * bot reacts to what happens to it and around it: robbed, hit by a Monopoly, a
 * seven that eats half its hand, an award taken or lost, a rival on the brink, a
 * win. Most moments get one face, some of the time. The big ones get a burst.
 *
 * It stays occasional: a bot waits at least twenty seconds between reactions,
 * throws at most fifteen in a game, and only the moment that matters most to it
 * in any stretch of play is considered.
 */

import type { ReactionName } from '../../../protocol/src/reactions.js';
import type { TableEvent } from './facts.js';
import type { Mind } from './mind.js';

export const REACTION_GAP_MS = 20_000;
export const REACTIONS_PER_GAME = 15;

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
        if (e.player === me) add(100, 0.9, ['nice', 'smug', 'nice'], ['nice', 'nice'], ['smug', 'laugh']);
        else add(90, 0.45, ['dead'], ['sad'], ['shock']);
        break;
      case 'monopoly': {
        const fromMe = e.taken[me] ?? 0;
        if (fromMe >= 3) add(60, 0.65, ['shock', 'angry'], ['dead'], ['angry', 'angry']);
        else if (fromMe > 0) add(30, 0.3, ['eyeroll'], ['angry']);
        const total = Object.values(e.taken).reduce((a, b) => a + b, 0);
        if (e.player === me && total >= 4) add(55, 0.6, ['evil', 'laugh'], ['smug'], ['evil']);
        break;
      }
      case 'steal':
        if (e.victim === me) {
          const again = mind.profiles[e.thief]?.robbedMe ?? 0;
          if (again >= 1) add(50, 0.6, ['angry', 'angry'], ['suspicious', 'angry']);
          else add(45, 0.4, ['angry'], ['sad'], ['eyeroll']);
        } else if (e.thief === me) add(20, 0.18, ['evil'], ['smug']);
        break;
      case 'discard':
        if (e.player === me && e.count >= 4) add(48, 0.5, ['dead'], ['sad', 'sad']);
        else if (e.player === me) add(20, 0.2, ['sad']);
        else if (e.count >= 5) add(15, 0.15, ['laugh']);
        break;
      case 'award':
        if (e.to === me) add(40, 0.35, ['nice'], ['smug']);
        else if (e.from === me) add(42, 0.45, ['shock'], ['angry']);
        break;
      case 'points':
        if (e.player !== me && e.points >= context.target - 1) add(35, 0.3, ['suspicious'], ['shock']);
        break;
      case 'robber':
        if (e.player !== me && e.blocks.includes(me)) add(18, 0.15, ['eyeroll'], ['suspicious']);
        break;
      case 'declined':
        if (e.maker === me) add(10, 0.08, ['eyeroll']);
        break;
      case 'build':
        if (e.player === me && e.what === 'city') add(8, 0.06, ['smug']);
        break;
      case 'roll':
        if (e.player === me && e.total === 7) add(12, 0.1, ['evil']);
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
