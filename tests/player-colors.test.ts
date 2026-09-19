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
  seatColors,
} from '../packages/protocol/src/colors.js';
import { seatHexColors, playerHexColor, DEFAULT_SEAT_HEX } from '../apps/client/src/player-colors.js';
import { Lobby } from '../apps/client/src/Lobby.js';
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

test('the lobby offers every colour, marks yours, and locks the ones other people hold', () => {
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
  const swatches = html.match(/<button[^>]*class="seat-color"[^>]*>/g)!;
  assert.equal(swatches.length, PLAYER_COLOR_LIST.length, 'the whole palette is visible');
  const of = (label: string) => swatches.find((s) => s.includes(`aria-label="${label}"`))!;
  assert.match(of('Jade'), /aria-checked="true"/);
  assert.match(of('Jade'), /disabled=""/);
  // Somebody else has rose: drawn, named as taken, and not pressable.
  assert.match(of('Rose, taken'), /data-held="true"/);
  assert.match(of('Rose, taken'), /disabled=""/);
  assert.match(of('Coral'), /aria-checked="false"/);
  assert.ok(!of('Coral').includes('disabled=""'));
  // Only your own card offers the palette.
  assert.equal(html.match(/class="seat-colors"/g)!.length, 1);
});
