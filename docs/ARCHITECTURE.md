# Architecture

Decision: one npm-workspace repository, distinct client/server/rules boundaries, and one self-hostable application distribution. A hosted service can use an external database without making contributors operate a fleet of services.

## Boundaries

| Component | Owns | Must not own |
| --- | --- | --- |
| `apps/client` | Controls, rendering, sound, connection status, the local player's authorized view | Official dice, hidden opponent hands, accepted game state |
| `apps/server` | Seat identity, room membership, validating commands, random outcomes, durable commits, per-player projections | Rendering timelines |
| `packages/rules` | Pure legal-action checks and state transitions, scoring, board topology | Sockets, React, database calls, wall-clock reads |
| `packages/protocol` | Versioned message formats and bounded input validation | Database credentials or hidden state snapshots |

Planned renderer: React for lobby/trades/settings and PixiJS for the board. Neither is installed in this initial transport-only slice. The first playable board will decide asset dimensions, interaction affordances, and frame-time targets before a full art library is produced.

The first prototype uses `ws` so durability and retry semantics are explicit and easy to inspect. Colyseus remains a possible room-management layer; its automatic reconnect is not a replacement for durable receipts and saved games. Any future framework must preserve the protocol's behavior rather than rewrite the rules engine around its storage objects.

## Current connectivity proof

`create` and `join` reserve one of four seats. A 256-bit client-generated token is retained privately by the client before the first request. If a handshake response is lost, replaying the same handshake returns the existing seat instead of creating another one. `resume` requires that seat already to exist. Merely knowing its display name or player ID is insufficient.

The test room holds a counter and revision. An `increment` carries a unique command ID and the revision the player acted on. In one SQLite transaction the server checks the revision, changes the state, and inserts a receipt. Only then does it acknowledge and broadcast. A retried ID with the same payload returns its original result; the same ID with a changed payload is rejected. A stale new action is rejected and the latest snapshot is sent. The client does not automatically reinterpret stale intent against a new state.

Presence is transient and separate from the durable action revision. On resume, send a full current snapshot. Replacing a socket revokes the old socket before processing another action from it. The browser-compatible client reconnects with capped exponential backoff and jitter, retains its pending command while reconnecting, and retries it with its original ID. Starting a second connection with the same credentials stops the replaced connection's retry loop.

Seat tokens never appear in public snapshots or logs. There are no actual private hands in the probe yet; per-player game-state filtering must receive dedicated tests when hands are implemented.

## What persists, and what does not yet

Today SQLite stores rooms, seats, and command receipts. WAL plus `synchronous=FULL` is used, and tests cover process crashes. It is single-instance local storage. Disk loss, volume deletion, corrupt storage, regional outage, and restoring an old backup are different failure modes and are not covered by this guarantee.

Session credentials can be supplied back to `Connection` after a page reload using its `Session` object and `onSession` callback. The prototype has no UI or browser storage integration. Pending commands survive reconnection within the same client object; preserving an unresolved command across a full browser restart is future work. After reopening, inspect the authoritative state instead of generating a new ID for an uncertain old move.

The production Postgres adapter is not implemented yet. It must commit game state, authorized event records, randomness outcomes, and unique command receipts in one transaction, keyed by game and seat. It also needs schema/ruleset versioning and consistent replay. Only the application server may read hidden game rows. Supabase service credentials and a direct database connection never belong in the browser.

## Production command flow

1. Authenticate the seat, validate message shape, and locate the current game owner.
2. Serialize commands for that game. In a transaction, reject already-seen payload conflicts and stale state.
3. Run the pure rules transition using server-supplied random outcomes.
4. Save the new state, event sequence, random outcomes, and receipt atomically.
5. Commit. A database failure produces no success acknowledgment.
6. Send the receipt and a view filtered for each recipient. On reconnect, use the saved state to resynchronize.
7. Animate the accepted events locally. Effects may be skipped, shortened, or interrupted without changing the game.

Use database uniqueness and revision checks as a final guard even when the process already serializes actions. Room ownership and broadcasts must remain correct across process boundaries before enabling additional replicas. Sticky sessions alone route a particular client consistently; they do not ensure that every player in a room reaches one owner.

## Deployment shape

Local development should remain one install and one start command. The supplied Compose file runs the prototype with persistent local data. Once a UI exists, the build should bundle client assets into the server image, serving assets and WebSockets from the same origin. This keeps self-hosting simple and avoids cross-origin configuration for ordinary players.

For the initial hosted service, use one always-running Azure Container Apps replica plus nearby Supabase Postgres. The static assets may initially be served by that same container. Add a CDN when measured asset traffic justifies it. Do not enable arbitrary horizontal scaling while rooms live in one process.

One replica gives straightforward recovery, but it is not high availability. A restart creates a reconnect window. Before promising uninterrupted availability, implement fenced room ownership, coordinated routing, safe deployment draining, multi-instance recovery, and database recovery drills. Using another region for players or the database adds network delay; choose locations by measurement from the intended players.

## Online choices independent of board rules

Private games should preserve a disconnected player's seat and state. The initial plan has no automatic bot takeover, timed discard, forced end turn, or automatic forfeit. Such policies need explicit product design and visible room settings. The server must handle any future timer, record it, and recover it across restarts. Production will also need room expiration and deletion policies; current prototype rooms remain in the local database until it is deliberately removed.

## Measurements before release

Measure action acknowledgment p50/p95/p99, reconnect time, frame times on representative devices, active sockets, database commit latency, event-loop delay, memory, and save failures. Keep private hands and tokens out of telemetry. Test bad networks, sleeping devices, lost replies, abrupt crashes, version changes, and a failed database.

Use a load test to determine safe concurrent-room limits. A two-client localhost probe cannot justify a concurrency or cloud-latency claim. Every release gate and unimplemented component is tracked in [the roadmap](ROADMAP.md).
