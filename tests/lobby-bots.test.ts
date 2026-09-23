import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, STANDIN_AFTER_MS } from '../apps/server/src/store.js';
import { newSession } from '../apps/client/src/connection.js';
import { roomHostId } from '../packages/protocol/src/room-host.js';

test('a bot never becomes host: the longest-seated person runs the lobby', () => {
  const store = new Store(':memory:', { trackPresence: true });
  try {
    const a = newSession('Ann'),
      b = newSession('Ben');
    const ann = store.enter('create', a.token, a.name);
    store.lobby(
      ann,
      'add-bot-first',
      store.snapshot(ann.room_id).revision,
      false,
      undefined,
      undefined,
      true,
    );
    const ben = store.enter('join', b.token, b.name, ann.room_id);
    store.setConnected(ann, true);
    store.setConnected(ben, true);
    store.leave(ann, 'host-leaves', store.snapshot(ann.room_id).revision);
    const players = store.snapshot(ann.room_id).players;
    assert.ok(players[0]!.bot, 'the bot now holds the earliest seat');
    assert.equal(roomHostId(players), ben.id);
    const revision = () => store.snapshot(ann.room_id).revision;
    store.configureSettings(ben, 'ben-settings', revision(), { turnTimerSeconds: 90 });
    store.lobby(ben, 'ben-adds-bot', revision(), false, undefined, undefined, true);
    const bot = store.snapshot(ann.room_id).players.find((p) => p.bot)!;
    store.lobby(ben, 'ben-removes-bot', revision(), false, undefined, bot.id);
    store.action(ben, 'ben-starts', revision(), { kind: 'start' });
    assert.ok(store.loadGame(ann.room_id));
  } finally {
    store.close();
  }
});

test('changing the room settings keeps bots ready, so Start is still possible', () => {
  const store = new Store(':memory:', { trackPresence: true });
  try {
    const a = newSession('Ann'),
      b = newSession('Ben');
    const ann = store.enter('create', a.token, a.name);
    for (const id of ['one', 'two'])
      store.lobby(
        ann,
        `add-bot-${id}`,
        store.snapshot(ann.room_id).revision,
        false,
        undefined,
        undefined,
        true,
      );
    const ben = store.enter('join', b.token, b.name, ann.room_id);
    store.setConnected(ann, true);
    store.setConnected(ben, true);
    store.lobby(ben, 'ben-ready', store.snapshot(ann.room_id).revision, true);
    store.configureSettings(ann, 'new-timer', store.snapshot(ann.room_id).revision, { turnTimerSeconds: 65 });
    const players = store.snapshot(ann.room_id).players;
    assert.ok(
      players.filter((p) => p.bot).every((p) => p.ready),
      'bots have nothing to confirm',
    );
    assert.equal(players.find((p) => p.id === ben.id)!.ready, false, 'people review the new settings');
    store.lobby(ben, 'ben-ready-again', store.snapshot(ann.room_id).revision, true);
    store.action(ann, 'start-after-settings', store.snapshot(ann.room_id).revision, { kind: 'start' });
    assert.ok(store.loadGame(ann.room_id));
  } finally {
    store.close();
  }
});

test('a failed lobby write leaves the bot bookkeeping as the database has it', () => {
  let now = 1_000_000;
  const store = new Store(':memory:', { now: () => now, trackPresence: true });
  try {
    const a = newSession('Ann');
    const ann = store.enter('create', a.token, a.name);
    store.lobby(ann, 'add-bot', store.snapshot(ann.room_id).revision, false, undefined, undefined, true);
    const bot = store.snapshot(ann.room_id).players.find((p) => p.bot)!;
    store.db.exec(
      "CREATE TEMP TRIGGER fail_receipt BEFORE INSERT ON lobby_receipts BEGIN SELECT RAISE(ABORT,'disk I/O error'); END",
    );
    assert.throws(() =>
      store.lobby(ann, 'kick-bot', store.snapshot(ann.room_id).revision, false, undefined, bot.id),
    );
    assert.throws(() =>
      store.lobby(ann, 'add-second', store.snapshot(ann.room_id).revision, false, undefined, undefined, true),
    );
    store.db.exec('DROP TRIGGER fail_receipt');
    store.setConnected(ann, true);
    store.action(ann, 'start', store.snapshot(ann.room_id).revision, { kind: 'start' });
    // Still a bot: it never gets a person's absence deadline or a stand-in of its own.
    assert.equal(store.snapshot(ann.room_id).players.find((p) => p.id === bot.id)!.resignAt, undefined);
    now += STANDIN_AFTER_MS;
    store.expireRoom(ann.room_id);
    assert.deepEqual(store.standInIds(ann.room_id), []);
    assert.equal(store.snapshot(ann.room_id).players.length, 2);
  } finally {
    store.close();
  }
});
