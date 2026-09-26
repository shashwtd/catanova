import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Store } from '../apps/server/src/store.js';
import { newSession } from '../apps/client/src/connection.js';
import { parseClientMessage } from '../packages/protocol/src/index.js';
import {
  DEFAULT_SEAT_COLORS,
  PLAYER_COLOR_LIST,
  PLAYER_COLORS,
  availableColors,
  isPlayerColor,
  seatColors,
} from '../packages/protocol/src/colors.js';
import {
  seatHexColors,
  seatColorMap,
  playerHexColor,
  DEFAULT_SEAT_HEX,
} from '../apps/client/src/player-colors.js';
import { ColorChoice, Lobby } from '../apps/client/src/Lobby.js';
import { PlayerRail } from '../apps/client/src/PlayerRail.js';
import { Board } from '../apps/client/src/Board.js';
import { createGame, gameView } from '../packages/rules/src/game.js';
import type { RoomState } from '../packages/protocol/src/index.js';
import { defaultProfile } from '../packages/protocol/src/profile.js';

test('an untouched table keeps the four colours it always had', () => {
  assert.deepEqual(seatColors([{}, {}, {}, {}]), [...DEFAULT_SEAT_COLORS]);
  assert.deepEqual(seatHexColors([{}, {}, {}, {}]), [...DEFAULT_SEAT_HEX]);
  // No seats at all still answers, for a preview with nothing to ask.
  assert.deepEqual(seatHexColors(undefined), [...DEFAULT_SEAT_HEX]);
});

test('a chosen colour wins, and the seats around it move out of the way', () => {
  // Seat two asks for coral, which seat one would otherwise have had.
  assert.deepEqual(seatColors([{}, { color: 'coral' }, {}, {}]), ['sky', 'coral', 'violet', 'amber']);
  // Every seat chooses: nothing is inferred.
  assert.deepEqual(seatColors([{ color: 'jade' }, { color: 'rose' }, { color: 'slate' }]), [
    'jade',
    'rose',
    'slate',
  ]);
  // A colour outside the palette is not a choice.
  assert.deepEqual(seatColors([{ color: 'chartreuse' }, {}]), ['coral', 'sky']);
});

test('two seats can never end up the same colour, whatever the stored data says', () => {
  // An old save, or a race the server somehow let through: the earlier seat
  // keeps it and the later one is moved, rather than both drawing coral roads.
  const resolved = seatColors([{ color: 'jade' }, { color: 'jade' }, { color: 'jade' }, {}]);
  assert.equal(resolved[0], 'jade');
  assert.equal(new Set(resolved).size, 4, resolved.join(','));
  for (const seats of [
    [{ color: 'amber' }, {}, {}, {}],
    [{}, {}, { color: 'coral' }, { color: 'sky' }],
    [{ color: 'bronze' }, { color: 'slate' }, {}, {}],
  ])
    assert.equal(new Set(seatColors(seats)).size, seats.length);
});

/** `seatColors` as it was before five and six seats, kept to prove small tables did not move. */
function seatColorsBeforeBigTables(seats: readonly { color?: string | null }[]) {
  const taken = new Set<string>();
  const chosen = seats.map((seat) => {
    if (!isPlayerColor(seat.color) || taken.has(seat.color)) return null;
    taken.add(seat.color);
    return seat.color;
  });
  const spare = [...DEFAULT_SEAT_COLORS, ...PLAYER_COLOR_LIST].filter((color) => !taken.has(color));
  let next = 0;
  return chosen.map((color) => color ?? spare[next++] ?? PLAYER_COLOR_LIST[0]);
}
/** Every table of `size` seats where each seat asked for nothing, nonsense, or one of the palette. */
function* tables(size: number, answers: readonly ({ color?: string | null } | undefined)[]) {
  const seats = Array.from({ length: size }, () => 0);
  while (true) {
    yield seats.map((answer) => answers[answer] ?? {});
    let place = size - 1;
    while (place >= 0 && seats[place] === answers.length - 1) seats[place--] = 0;
    if (place < 0) return;
    seats[place]!++;
  }
}
const ANSWERS = [
  undefined,
  { color: null },
  { color: 'chartreuse' },
  ...PLAYER_COLOR_LIST.map((color) => ({ color })),
];

test('tables of up to four resolve exactly as they did before five and six seats', () => {
  let checked = 0;
  for (let size = 0; size <= 4; size++)
    for (const seats of tables(size, ANSWERS)) {
      assert.deepEqual(seatColors(seats), seatColorsBeforeBigTables(seats), JSON.stringify(seats));
      checked++;
    }
  assert.equal(checked, 1 + 11 + 11 ** 2 + 11 ** 3 + 11 ** 4);
});

test('a fifth and sixth seat get jade and rose, and no table of six repeats a colour', () => {
  // The old list came round to coral and sky again.
  assert.deepEqual(seatColors([{}, {}, {}, {}, {}, {}]), [...DEFAULT_SEAT_COLORS, 'jade', 'rose']);
  assert.deepEqual(seatColors([{}, {}, {}, {}, {}]), [...DEFAULT_SEAT_COLORS, 'jade']);
  // A seat that chose jade takes it off the spare list, so the sixth seat gets rose.
  assert.deepEqual(seatColors([{ color: 'jade' }, {}, {}, {}, {}, {}]), [
    'jade',
    'coral',
    'sky',
    'violet',
    'amber',
    'rose',
  ]);
  for (const size of [5, 6])
    for (const seats of tables(size, [undefined, { color: 'chartreuse' }, ...ANSWERS.slice(3)])) {
      const resolved = seatColors(seats);
      assert.equal(new Set(resolved).size, size, JSON.stringify(seats));
      // Whoever asked first for a colour still has it.
      seats.forEach((seat, i) => {
        if (seat.color && seats.findIndex((s) => s.color === seat.color) === i && isPlayerColor(seat.color))
          assert.equal(resolved[i], seat.color);
      });
    }
});

test('the palette on offer is everything nobody else is holding', () => {
  const seats = [{ id: 'a', color: 'coral' }, { id: 'b', color: 'jade' }, { id: 'c' }];
  // Your own colour stays on the list: it is the one showing as chosen.
  assert.ok(availableColors(seats, 'a').includes('coral'));
  assert.ok(!availableColors(seats, 'a').includes('jade'));
  assert.deepEqual(
    availableColors(seats, 'c'),
    PLAYER_COLOR_LIST.filter((c) => c !== 'coral' && c !== 'jade'),
  );
});

test('the server settles the race: a colour somebody holds is refused', () => {
  const store = new Store(':memory:');
  try {
    const a = store.enter('create', newSession('A').token, 'A');
    const b = store.enter('join', newSession('B').token, 'B', a.room_id);
    const revision = () => store.snapshot(a.room_id).revision;
    store.lobby(a, 'a-picks-jade', revision(), false, undefined, undefined, undefined, 'jade');
    assert.equal(store.snapshot(a.room_id).players[0]!.color, 'jade');
    assert.throws(
      () => store.lobby(b, 'b-picks-jade', revision(), false, undefined, undefined, undefined, 'jade'),
      /already has that colour/,
    );
    const at = revision();
    store.lobby(b, 'b-picks-rose', at, false, undefined, undefined, undefined, 'rose');
    const seats = store.snapshot(a.room_id).players;
    assert.deepEqual(
      seats.map((p) => p.color),
      ['jade', 'rose'],
    );
    // It survives a restart, because a colour you chose is not a session thing.
    assert.equal(playerHexColor(seats, b.id), PLAYER_COLORS.rose);
    // A repeat of the same command is the same command, not a second pick.
    assert.equal(
      store.lobby(b, 'b-picks-rose', at, false, undefined, undefined, undefined, 'rose').duplicate,
      true,
    );
  } finally {
    store.close();
  }
});

test('the wire refuses a colour that is not one of ours, or one smuggled in with another request', () => {
  const base = { type: 'lobby', commandId: 'abcdefgh', expectedRevision: 0, ready: false };
  assert.deepEqual(parseClientMessage(JSON.stringify({ ...base, color: 'jade' })), {
    type: 'lobby',
    commandId: 'abcdefgh',
    expectedRevision: 0,
    ready: false,
    color: 'jade',
  });
  for (const bad of ['', 'JADE', 'rebeccapurple', 42, null, {}])
    assert.throws(() => parseClientMessage(JSON.stringify({ ...base, color: bad })), /colour/i);
  // One lobby message does one thing.
  assert.throws(
    () => parseClientMessage(JSON.stringify({ ...base, color: 'jade', addBot: true })),
    /colour/i,
  );
  assert.throws(
    () => parseClientMessage(JSON.stringify({ ...base, color: 'jade', kickPlayerId: 'x' })),
    /colour/i,
  );
});

test('a card shows the colour it is, and the palette only when asked for', () => {
  const player = (id: string, name: string, color?: string) => ({
    id,
    name,
    connected: true,
    ready: false,
    profile: defaultProfile(name),
    ...(color ? { color } : {}),
  });
  const room = {
    roomId: 'room',
    revision: 1,
    counter: 0,
    players: [player('p0', 'You', 'jade'), player('p1', 'Other', 'rose')],
  } as RoomState;
  const html = renderToStaticMarkup(
    createElement(Lobby, {
      room,
      me: 'p0',
      busy: false,
      connected: true,
      onReady() {},
      onStart() {},
      onInvite() {},
      onLeave() {},
      onEdit() {},
      onSettings() {},
      onConfigure() {},
      onChooseColor() {},
    }),
  );
  // At rest the card says which colour you are and offers to change it. Eight
  // swatches permanently under a name is a paint chart.
  assert.match(html, /aria-label="Your colour: Jade\. Change it"/);
  assert.match(html, /aria-expanded="false"/);
  assert.ok(!html.includes('class="seat-color"'), 'the palette is not on the card until it is asked for');
  // Only your own card offers it at all.
  assert.equal(html.match(/seat-color-choice/g)!.length, 1);
});

test('the palette shows all eight, marks yours, and locks the ones other people hold', () => {
  const html = renderToStaticMarkup(
    createElement(ColorChoice, {
      mine: 'jade' as const,
      taken: new Set(['jade', 'rose'] as const),
      busy: false,
      onChoose() {},
      initialOpen: true,
    }),
  );
  const swatches = html.match(/<button[^>]*class="seat-color"[^>]*>/g)!;
  assert.equal(swatches.length, PLAYER_COLOR_LIST.length, 'the whole palette is visible once open');
  const of = (label: string) => swatches.find((s) => s.includes(`aria-label="${label}"`))!;
  assert.match(of('Jade'), /aria-checked="true"/);
  // Somebody else has rose: drawn, named as taken, and not pressable.
  assert.match(of('Rose, taken'), /data-held="true"/);
  assert.match(of('Rose, taken'), /disabled=""/);
  assert.match(of('Coral'), /aria-checked="false"/);
  assert.ok(!of('Coral').includes('disabled=""'));
});

test('the rail and the board agree about whose colour is whose, however the seats were shuffled', () => {
  // The game shuffles the seats when it starts, so the room's order and the
  // game's order are different lists of the same people. Anything that took a
  // colour from one and an index from the other painted roads in somebody
  // else's colour — and only sometimes, which is why it survived.
  const named = ['Ana', 'Bo', 'Cy', 'Dee'];
  const seats = named.map((name, i) => ({ id: `p${i}`, name }));
  const game = createGame(seats, 24, () => 0.34);
  game.phase = 'actions';
  game.turn = 3;
  // Deal every player a piece so the board has something of theirs to colour.
  game.board.vertices.slice(0, 4).forEach((vertex, i) => {
    game.buildings[vertex.id] = { player: `p${i}`, kind: 'settlement' };
  });
  // The room lists them in seat order with their chosen colours; the game
  // lists them in the reverse of that, standing in for the shuffle.
  const roomPlayers = seats.map((seat, i) => ({
    ...seat,
    connected: true,
    ready: true,
    profile: defaultProfile(seat.name),
    color: (['jade', 'bronze', 'sky', 'rose'] as const)[i]!,
  }));
  const view = gameView(game, 'p0');
  view.players.reverse();
  const room = { roomId: 'r', revision: 1, counter: 0, game: view, players: roomPlayers } as RoomState;

  const rail = renderToStaticMarkup(createElement(PlayerRail, { game: view, room, me: 'p0' }));
  const board = renderToStaticMarkup(
    createElement(Board, {
      board: game.board,
      game: view,
      me: 'p0',
      mode: null,
      disabled: true,
      onAction() {},
      onRobber() {},
      colors: seatColorMap(roomPlayers),
    }),
  );
  for (const seat of roomPlayers) {
    const expected = PLAYER_COLORS[seat.color];
    // The rail's portrait for this player.
    const card = rail.match(new RegExp(`data-player-profile="${seat.id}"[^>]*`))![0];
    assert.match(card, new RegExp(`--player-color:${expected}`), `${seat.name} in the rail`);
    // And their settlement on the island.
    const piece = board.match(new RegExp(`aria-label="${seat.name} · settlement"[^]*?fill="([^"]+)"`))!;
    assert.equal(piece[1], expected, `${seat.name} on the board`);
  }
});
