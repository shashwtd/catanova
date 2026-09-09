#!/usr/bin/env node
/**
 * Isolated runtime check, Node 24+, no dependencies or Docker/cloud mutations.
 * node verify-recovery.mjs prepare /proof/recovery.json
 * Restart the disposable test container (or VM), preserving its test data volume.
 * node verify-recovery.mjs verify /proof/recovery.json
 * Endpoint is deliberately fixed to loopback port 3001; authenticated servers are refused.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const origin = 'http://127.0.0.1:3001';
const endpoint = 'ws://127.0.0.1:3001/ws';
const peers = [];
const hardTimeout = setTimeout(() => {
  console.error('FAIL: isolated recovery check exceeded 60 seconds');
  process.exit(1);
}, 60_000).unref();

async function until(check, label, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
    await delay(20);
  }
}

async function requireLocalServer() {
  const deadline = Date.now() + 30_000;
  while (true) {
    let response;
    try {
      response = await fetch(`${origin}/api/config`, { signal: AbortSignal.timeout(2000) });
    } catch {
      if (Date.now() >= deadline) throw new Error('Isolated server did not start on loopback port 3001');
      await delay(250);
      continue;
    }
    assert.equal(response.status, 200, 'Isolated config endpoint must be healthy');
    const config = await response.json();
    assert.equal(config.mode, 'local', 'Refusing to modify an authenticated server');
    assert.equal(config.auth, null, 'Refusing a server connected to Supabase');
    return;
  }
}

async function connect(session, mode, roomId) {
  const socket = new WebSocket(endpoint);
  const peer = { socket, session, state: null, playerId: null, messages: [], failure: null };
  peers.push(peer);
  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(String(event.data));
      if (message.type === 'welcome') peer.playerId = message.playerId;
      if (message.type === 'welcome' || message.type === 'state') peer.state = message.state;
      if (message.type === 'error') peer.failure = new Error(`Protocol error: ${message.code}`);
      peer.messages.push(message);
    } catch {
      peer.failure = new Error('Invalid protocol response');
    }
  });
  socket.addEventListener('error', () => {
    peer.failure = new Error('Isolated WebSocket failed');
  });
  socket.addEventListener('close', () => {
    peer.failure ??= new Error('Isolated WebSocket closed unexpectedly');
  });
  await until(() => {
    if (peer.failure) throw peer.failure;
    return socket.readyState === WebSocket.OPEN;
  }, 'WebSocket opens');
  peer.send = (message) => socket.send(JSON.stringify(message));
  peer.take = async (type, commandId) => {
    const matches = (message) => message.type === type && (!commandId || message.commandId === commandId);
    await until(() => {
      if (peer.failure) throw peer.failure;
      return peer.messages.some(matches);
    }, `server ${type}`);
    return peer.messages.splice(peer.messages.findIndex(matches), 1)[0];
  };
  peer.send({ type: mode, version: 1, ...session, ...(roomId ? { roomId } : {}) });
  const welcome = await peer.take('welcome');
  assert.equal(welcome.version, 1);
  return peer;
}

async function settle(revision, participants) {
  await until(
    () =>
      participants.every((peer) => {
        if (peer.failure) throw peer.failure;
        return peer.state?.revision === revision;
      }),
    `both clients receive revision ${revision}`,
  );
}

async function command(peer, payload, participants) {
  const message = {
    commandId: `recovery-${randomUUID()}`,
    expectedRevision: peer.state.revision,
    ...payload,
  };
  peer.send(message);
  const receipt = await peer.take('ack', message.commandId);
  assert.equal(receipt.duplicate, false, 'Fresh command must apply exactly once');
  assert.equal(receipt.revision, message.expectedRevision + 1);
  await settle(receipt.revision, participants);
  return { message, receipt };
}

async function history(peer) {
  peer.send({ type: 'history' });
  const result = await peer.take('history');
  assert.equal(result.hasMore, false, 'Tiny test history should fit one page');
  return result.entries;
}

async function prepare(path) {
  const session = (name) => ({ token: randomBytes(32).toString('hex'), name });
  const host = await connect(session('Recovery host'), 'create');
  const roomId = host.state.roomId;
  const friend = await connect(session('Recovery friend'), 'join', roomId);
  const participants = [host, friend];
  await until(() => participants.every((peer) => peer.state?.players.length === 2), 'two isolated seats');
  assert.equal(host.state.settings.turnTimerSeconds, null, 'Recovery fixture must have no automatic timer');
  await command(friend, { type: 'lobby', ready: true }, participants);
  await command(host, { type: 'action', action: { kind: 'start' } }, participants);
  const actor = participants.find(
    (peer) => peer.playerId === host.state.game.players[host.state.game.active].id,
  );
  assert.ok(actor, 'The shuffled first player must be one of the two test seats');
  assert.equal(actor.state.game.phase, 'setupSettlement');
  const vertex = actor.state.game.legal.settlements[0];
  assert.ok(Number.isInteger(vertex), 'A legal setup settlement must exist');
  await command(actor, { type: 'action', action: { kind: 'settlement', vertex } }, participants);
  assert.equal(actor.state.game.phase, 'setupRoad');
  const edge = actor.state.game.legal.roads[0];
  assert.ok(Number.isInteger(edge), 'A legal setup road must exist');
  const accepted = await command(actor, { type: 'action', action: { kind: 'road', edge } }, participants);
  assert.equal(Object.keys(actor.state.game.buildings).length, 1);
  assert.equal(Object.keys(actor.state.game.roads).length, 1);
  const fixture = {
    kind: 'catanova-isolated-recovery-v1',
    endpoint,
    roomId,
    participants: participants.map((peer) => ({
      session: peer.session,
      playerId: peer.playerId,
      game: peer.state.game,
    })),
    accepted: { playerId: actor.playerId, ...accepted },
    history: await history(actor),
  };
  // Exclusive create refuses to overwrite a prior test's seat/recovery evidence.
  await writeFile(path, JSON.stringify(fixture), { mode: 0o600, flag: 'wx' });
  console.log(
    JSON.stringify({
      result: 'PREPARED',
      players: 2,
      houses: 1,
      roads: 1,
      revision: accepted.receipt.revision,
    }),
  );
  console.log('Restart the isolated test container (or VM), retain its test volumes, then run verify.');
}

async function verify(path) {
  const fixture = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(fixture.kind, 'catanova-isolated-recovery-v1');
  assert.equal(fixture.endpoint, endpoint);
  assert.equal(fixture.participants.length, 2);
  const participants = [];
  for (const saved of fixture.participants) {
    const peer = await connect(saved.session, 'resume', fixture.roomId);
    assert.equal(peer.playerId, saved.playerId, 'Restart must retain the original seat');
    assert.equal(peer.state.roomId, fixture.roomId);
    assert.equal(peer.state.players.length, 2, 'Resume must not create another seat');
    assert.equal(peer.state.revision, fixture.accepted.receipt.revision);
    assert.deepEqual(peer.state.game, saved.game, 'Every piece and player-specific game view must survive');
    participants.push(peer);
  }
  const actor = participants.find((peer) => peer.playerId === fixture.accepted.playerId);
  assert.ok(actor);
  assert.deepEqual(await history(actor), fixture.history, 'Accepted move history must survive');
  actor.send(fixture.accepted.message);
  const duplicate = await actor.take('ack', fixture.accepted.message.commandId);
  assert.equal(duplicate.duplicate, true, 'Accepted command receipt must survive restart');
  assert.equal(duplicate.revision, fixture.accepted.receipt.revision);
  assert.equal(duplicate.counter, fixture.accepted.receipt.counter);
  // Explicit sync creates a request/response barrier after retry processing.
  for (const [index, peer] of participants.entries()) {
    peer.messages = peer.messages.filter((message) => message.type !== 'state');
    peer.send({ type: 'sync' });
    const snapshot = (await peer.take('state')).state;
    assert.equal(snapshot.revision, fixture.accepted.receipt.revision, 'Retry cannot create a new revision');
    assert.deepEqual(snapshot.game, fixture.participants[index].game, 'Retry cannot add or remove pieces');
  }
  assert.deepEqual(await history(actor), fixture.history, 'Retry cannot append a duplicate move');
  console.log(
    JSON.stringify({
      result: 'PASS',
      players: 2,
      houses: 1,
      roads: 1,
      revision: duplicate.revision,
      duplicateReceipt: true,
      historyUnchanged: true,
    }),
  );
}

try {
  const [phase, path, ...extra] = process.argv.slice(2);
  assert.ok(
    ['prepare', 'verify'].includes(phase) && path && isAbsolute(path) && !extra.length,
    'Usage: node verify-recovery.mjs prepare|verify /absolute/private-fixture.json',
  );
  await requireLocalServer();
  if (phase === 'prepare') await prepare(path);
  else await verify(path);
} catch (error) {
  console.error('FAIL: ' + (error instanceof Error ? error.message : 'recovery check failed'));
  process.exitCode = 1;
} finally {
  clearTimeout(hardTimeout);
  peers.forEach((peer) => peer.socket.close());
}
