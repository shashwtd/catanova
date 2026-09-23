import test from 'node:test';
import assert from 'node:assert/strict';
import { AwardPresentationQueue, deriveFeedback } from '../apps/client/src/feedback.js';
import type { AwardCelebration, FeedbackEvent } from '../apps/client/src/feedback.js';
import {
  celebrationsShown,
  dicePresentationGame,
  FeedbackPresenter,
  PIECE_FLASH_MS,
  PresentationBuffer,
} from '../apps/client/src/useFeedback.js';
import type { PresentationClock, PresentationView } from '../apps/client/src/useFeedback.js';
import { DICE_READABLE_MS } from '../apps/client/src/DiceThrow.js';
import type { SoundCue } from '../apps/client/src/sound.js';
import type { RoomState } from '../packages/protocol/src/index.js';
import { activePlayer, applyAction, createGame, gameView } from '../packages/rules/src/game.js';
import type { Game, GameAction, GameView } from '../packages/rules/src/game.js';

const seats = ['Alice', 'Bob', 'Cara'].map((name, i) => ({ id: `p${i}`, name }));
// Cara watches Alice and Bob take their turns, as a player waiting on bots does.
const viewer = 'p2';

/** Browser timer order: by due time, then by scheduling order. */
class VirtualClock implements PresentationClock {
  private time = 0;
  private scheduled = 0;
  private timers: { at: number; order: number; run: () => void }[] = [];
  /** React renders once per task, so the table is drawn after each timer. */
  constructor(private readonly afterEach: () => void) {}
  now() {
    return this.time;
  }
  setTimeout(run: () => void, delay: number) {
    const timer = { at: this.time + Math.max(0, delay), order: this.scheduled++, run };
    this.timers.push(timer);
    return timer;
  }
  clearTimeout(timer: unknown) {
    this.timers = this.timers.filter((t) => t !== timer);
  }
  advance(until: number) {
    for (;;) {
      const due = this.timers
        .filter((t) => t.at <= until)
        .sort((a, b) => a.at - b.at || a.order - b.order)[0];
      if (!due) break;
      this.timers.splice(this.timers.indexOf(due), 1);
      this.time = due.at;
      due.run();
      this.afterEach();
    }
    this.time = until;
  }
}

function opening(): Game {
  let game = createGame(seats, 82, () => 0.34);
  while (!game.turn) {
    const player = activePlayer(game),
      legal = gameView(game, player.id).legal;
    game = applyAction(
      game,
      player.id,
      game.phase === 'setupSettlement'
        ? { kind: 'settlement', vertex: legal.settlements[0]! }
        : { kind: 'road', edge: legal.roads[0]! },
      () => 0.34,
    );
  }
  return game;
}
/** Classic dice that land on `total`. */
const rolling = (total: number) => {
  const first = Math.max(1, total - 6),
    faces = [first, total - first];
  let n = 0;
  return () => (faces[n++ % 2]! - 0.5) / 6;
};
/** A total that pays the viewer, so the first throw has resource flights to wait for. */
const payingTotal = (game: Game) =>
  game.board.hexes.find(
    (h) => h.number && h.id !== game.robber && h.vertices.some((v) => game.buildings[v]?.player === viewer),
  )!.number;

/** Server snapshots as the viewer receives them. */
function server(game: Game) {
  let revision = 20;
  const snap = (): RoomState => ({
    roomId: 'ABCDEFG2',
    revision: revision++,
    counter: 0,
    players: seats.map((s) => ({ ...s, connected: true })),
    game: gameView(game, viewer),
  });
  const first = snap();
  return {
    first,
    act(action: GameAction, random = () => 0.34) {
      game = applyAction(game, activePlayer(game).id, action, random);
      return snap();
    },
    get game() {
      return game;
    },
  };
}

type Frame = {
  at: number;
  board: GameView;
  event: FeedbackEvent | null;
  busy: boolean;
  celebrations: readonly AwardCelebration[];
};
/** Runs the real presenter against a timeline of arrivals, recording what the table draws. */
function watch(first: RoomState, arrivals: [at: number, snapshot: RoomState][], until = 15000) {
  const frames: Frame[] = [],
    sounds: { at: number; cue: SoundCue }[] = [];
  const awards = new AwardPresentationQueue();
  let live = first,
    view: PresentationView | null = null,
    earned: readonly AwardCelebration[] = [];
  const draw = () =>
    frames.push({
      at: clock.now(),
      board: dicePresentationGame(live, view?.board ?? null)!,
      event: view?.event ?? null,
      busy: view?.busy ?? false,
      celebrations: celebrationsShown(earned, view?.board ?? null),
    });
  const clock = new VirtualClock(draw);
  const presenter = new FeedbackPresenter(
    {
      view: (next) => {
        view = next;
      },
      sound: (cue) => sounds.push({ at: clock.now(), cue }),
      reducedMotion: () => false,
    },
    clock,
  );
  presenter.observe(null, first, viewer);
  draw();
  for (const [at, next] of arrivals) {
    clock.advance(at);
    // main.tsx installs the room and hands it to feedback in the same task.
    const previous = live;
    live = next;
    earned = awards.observe(previous, next);
    presenter.offer(previous, next, viewer);
    draw();
  }
  clock.advance(until);
  return { frames, sounds };
}
const pieces = (game: GameView) => [
  ...Object.keys(game.roads).map((id) => `road:${id}`),
  ...Object.keys(game.buildings).map((id) => `building:${id}`),
];
function assertNeverRollsBack(frames: Frame[]) {
  const shown = new Set<string>(),
    robber: number[] = [];
  for (const { at, board } of frames) {
    const now = new Set(pieces(board));
    for (const piece of shown) assert.ok(now.has(piece), `${piece} disappeared at ${at} ms`);
    for (const piece of now) shown.add(piece);
    if (robber.at(-1) !== board.robber) {
      assert.ok(!robber.includes(board.robber), `the robber moved back to ${board.robber} at ${at} ms`);
      robber.push(board.robber);
    }
  }
  return robber;
}

test('a roll queued behind a build is thrown from the snapshot right before it, never an older one', () => {
  const game = opening();
  game.players[0]!.hand.wood++;
  game.players[0]!.hand.brick++;
  game.bank.wood--;
  game.bank.brick--;
  const table = server(game);
  const rolled = table.act({ kind: 'roll' }, rolling(payingTotal(table.game)));
  const built = table.act({ kind: 'road', edge: gameView(table.game, 'p0').legal.roads[0]! });
  const ended = table.act({ kind: 'endTurn' });
  const nextRoll = table.act({ kind: 'roll' }, rolling(5));
  const buffer = new PresentationBuffer();
  buffer.begin(rolled, 3400);
  assert.equal(buffer.offer(rolled, built, viewer, 1000), null);
  assert.equal(buffer.offer(built, ended, viewer, 1500), null);
  assert.equal(buffer.offer(ended, nextRoll, viewer, 2000), null);
  assert.ok(buffer.rollWaiting, 'a queued roll keeps its result out of view');
  const before = buffer.take()!;
  assert.equal(before.previous, rolled);
  assert.equal(before.next, ended, 'the road and the turn change play before the next throw');
  assert.ok(before.settled);
  buffer.begin(before.next, 3520);
  const roll = buffer.take()!;
  assert.equal(roll.previous, ended, 'the board is held at the snapshot right before the roll');
  assert.equal(roll.next, nextRoll);
  assert.deepEqual(deriveFeedback(roll.previous, roll.next, viewer)!.dice, nextRoll.game!.dice);
  assert.equal(buffer.take(), null);
  const later = table.act({ kind: 'endTurn' });
  buffer.begin(rolled, 3400);
  buffer.offer(built, nextRoll, viewer, 1000);
  buffer.offer(nextRoll, later, viewer, 2000);
  assert.equal(buffer.take()!.next, built, 'what came before the throw, alone');
  assert.equal(buffer.take()!.next, nextRoll, 'then the throw, alone');
  assert.equal(buffer.take()!.next, later, 'then what followed it');
});

test('queued moves and a queued roll play once, in order, with the board never rolling back', () => {
  const game = opening();
  game.players[0]!.hand.wood++;
  game.players[0]!.hand.brick++;
  game.bank.wood--;
  game.bank.brick--;
  const table = server(game);
  const rolled = table.act({ kind: 'roll' }, rolling(payingTotal(table.game)));
  const edge = gameView(table.game, 'p0').legal.roads[0]!;
  const built = table.act({ kind: 'road', edge });
  const ended = table.act({ kind: 'endTurn' });
  const nextRoll = table.act({ kind: 'roll' }, rolling(5));
  // The recorded failure: a build, a turn change and the next roll all arrive
  // while the first roll's production is still flying.
  const { frames, sounds } = watch(table.first, [
    [0, rolled],
    [2500, built],
    [2900, ended],
    [3200, nextRoll],
  ]);
  assertNeverRollsBack(frames);
  const appeared = frames.find((frame) => frame.board.roads[edge])!;
  assert.ok(appeared.at > 2500, 'a queued road waits for its own presentation');
  assert.ok(
    appeared.event?.sites.includes(`[data-road-id="${edge}"]`) && !appeared.event.dice,
    'the road flashes as it appears, not behind a held board',
  );
  const cue = sounds.find((sound) => sound.cue === 'road')!;
  assert.ok(
    cue.at >= appeared.at && cue.at - appeared.at <= 150,
    `road sound ${cue.at - appeared.at} ms late`,
  );
  const secondThrow = deriveFeedback(ended, nextRoll, viewer)!.diceId;
  const thrown = frames.find((frame) => frame.event?.diceId === secondThrow)!;
  assert.ok(thrown.at - appeared.at >= PIECE_FLASH_MS, 'the next throw waits until the road has lit');
  for (const frame of frames.filter((f) => f.at >= thrown.at && f.at < thrown.at + DICE_READABLE_MS))
    assert.equal(frame.board, ended.game, 'the next roll is read over the board as it was just before it');
  const final = frames.at(-1)!;
  assert.deepEqual(final.board.dice, nextRoll.game!.dice);
  assert.equal(final.busy, false);
  assert.equal(sounds.filter((sound) => sound.cue === 'dice').length, 2, 'each roll is thrown once');
});

test('a queued seven moves the robber once, after its faces are readable, with its sound', () => {
  const table = server(opening());
  const rolled = table.act({ kind: 'roll' }, rolling(payingTotal(table.game)));
  const ended = table.act({ kind: 'endTurn' });
  const seven = table.act({ kind: 'roll' }, rolling(7));
  assert.equal(table.game.phase, 'robber');
  const mover = activePlayer(table.game).id,
    start = table.game.robber;
  const hex = table.game.board.hexes.find(
    (h) =>
      h.id !== start &&
      h.vertices.every((v) => !table.game.buildings[v] || table.game.buildings[v]!.player === mover),
  )!.id;
  const moved = table.act({ kind: 'robber', hex });
  const { frames, sounds } = watch(table.first, [
    [0, rolled],
    [1200, ended],
    [1800, seven],
    [2600, moved],
  ]);
  assert.deepEqual(assertNeverRollsBack(frames), [start, hex], 'the robber moves exactly once');
  const sevenThrow = deriveFeedback(ended, seven, viewer)!.diceId;
  const throwAt = frames.find((frame) => frame.event?.diceId === sevenThrow)!.at;
  const movedAt = frames.find((frame) => frame.board.robber === hex)!.at;
  assert.ok(movedAt >= throwAt + DICE_READABLE_MS, 'the robber waits for the seven to be read');
  const cue = sounds.find((sound) => sound.cue === 'robber')!;
  assert.ok(cue.at >= movedAt && cue.at - movedAt <= 150, `robber sound ${cue.at - movedAt} ms late`);
  // The robber and discard controls follow the live room, so they stay hidden until then.
  for (const frame of frames.filter((f) => f.at >= 1800 && f.at < throwAt + DICE_READABLE_MS))
    assert.ok(frame.busy, `the queued seven was actionable at ${frame.at} ms`);
});

test('an award earned by a queued road is celebrated as that road appears, not before', () => {
  const game = opening();
  game.players[0]!.hand.wood++;
  game.players[0]!.hand.brick++;
  game.bank.wood--;
  game.bank.brick--;
  const table = server(game);
  const rolled = table.act({ kind: 'roll' }, rolling(payingTotal(table.game)));
  const edge = gameView(table.game, 'p0').legal.roads[0]!;
  const built = table.act({ kind: 'road', edge });
  const ended = table.act({ kind: 'endTurn' });
  for (const snapshot of [built, ended]) snapshot.game!.longestRoad = 'p0';
  const { frames } = watch(table.first, [
    [0, rolled],
    [1000, built],
    [1500, ended],
  ]);
  const road = frames.findIndex((frame) => frame.board.roads[edge]);
  const award = frames.findIndex((frame) => frame.celebrations.length);
  assert.ok(frames[road]!.at > 1000, 'the road waited behind the roll');
  assert.equal(award, road, 'Longest Road is announced in the frame its road appears');
  assert.equal(frames.at(-1)!.celebrations[0]!.revision, built.revision);
});
