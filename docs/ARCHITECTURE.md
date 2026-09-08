# Architecture

## One repository, one distribution

`packages/rules` owns pure game transitions and board generation. `packages/protocol` defines bounded, canonical network messages. `apps/server` authenticates seats, supplies private randomness, commits actions and sends authorized views. `apps/client` renders those views and submits player intent.

The first playable client uses React and a small SVG board with one original terrain atlas. This keeps 19 tiles and their accessible interaction targets simple; animations are finite and honor reduced motion. A PixiJS renderer remains an option if measured effects or device performance justify it. Rendering can change without rewriting rules.

The Node process serves the built client and `/ws` on the same origin. Local play needs one install/build/start flow, and Docker ships both. A CDN can be introduced later without creating separate repositories. React/Vite integration follows the [React client API](https://react.dev/reference/react-dom/client/createRoot) and [Vite build documentation](https://vite.dev/guide/build).

## Game authority and hidden information

The server chooses a public board seed, shuffled seat order, private shuffled development deck, dice and theft outcomes using cryptographic randomness. The public map seed cannot predict the private deck or rolls. `applyAction` clones an input game and returns an accepted next state; rejected actions cannot partially change it. Costs, piece limits, turn phases and scoring are enforced by this transition.

The database stores full authoritative state. `gameView` emits a separate snapshot for every recipient: their own hand/card identities, opponents' counts and visible points, public board, journal, trade and phase. It omits the deck order and opponents' hidden identities. Own hidden victory points count privately; final point totals are visible at victory. The public journal omits resource type stolen and discard mix. Bank counts are currently public for resource selection, so changes can reveal discarded resource mix; this information policy is tracked in the playtest notes. Authentication tokens never appear in snapshots.

## Sessions and command commitment

`create` and `join` reserve one of four seats; a game starts with three or four. The room creator starts the game, and new seats are rejected after start. Each seat has a 256-bit client-generated secret token, stored only as a SHA-256 hash on the server. Repeated handshakes with the same token return the same seat, including when the first response was lost. Resuming replaces and immediately revokes the prior socket.

Every action has a UUID command ID, expected room revision and canonical payload. A SQLite transaction checks the receipt and revision, validates the move, saves next state, increments the revision and writes a receipt. A replay with the same ID and payload returns the original result. Reusing an ID with different intent or submitting a stale new action is rejected. The server never silently reinterprets stale intent.

State and receipt commit **before acknowledgment**. The counter probe uses separate receipts and cannot run inside a started game. Cross-operation ID reuse is rejected. Transactions use WAL plus `synchronous=FULL`. All actions run serially in one server process.

The client writes the seat and unresolved command to tab session storage before sending them. Refresh/reconnect resends the same command; it does not create a second roll or charge. The explicit last-seat recovery button uses local storage. A closed tab or cleared storage can lose its outbox or credentials; account recovery is not implemented. Never share seat tokens as invites.

## Reconnection and storage limits

Presence is transient and separate from the durable revision. A heartbeat detects dead sockets; the client reconnects with bounded exponential backoff and jitter. On welcome it receives a fresh, filtered snapshot and replays any unresolved command. Reconnecting a seat does not reserve an extra place. There is no auto-forfeit, bot takeover or turn timer.

SQLite stores rooms, seats, full games and command receipts. Game snapshots carry a schema and ruleset version; unknown schema versions are rejected. It is a **single-process local store**, not a multi-replica cloud database. Tests cover failed writes, abrupt process death, real four-client play, lost replies and restarting after a saved roll. Disk loss, volume deletion, regional failure and restoring old backups are different guarantees.

The current snapshot journal is capped and is not a full replay/event ledger. Exact accepted random outcomes are preserved in state where relevant, but historical deterministic replay and schema migration tooling remain future work.

## Hosted deployment

Use one always-running Azure Container Apps instance with nearby Supabase Postgres for the initial hosted playtest. Serve client assets from that instance first. The Postgres adapter must atomically save state, private event records, chosen outcomes and receipts before responding. Database service credentials never belong in the client.

Postgres, cloud migrations and deployment draining are not implemented yet. Azure's ephemeral filesystem must not be mistaken for durable SQLite storage. One process restarting produces a reconnect window; it is not high availability. Before multiple replicas, implement exclusive room ownership with fencing, room-aware routing and coordinated broadcasts. Sticky sessions alone do not make all players in one room reach the same owner.

Measure acknowledgment p50/p95/p99, reconnect time, frame times, event-loop delay, memory, database commit latency and save failures. Keep private state out of logs. Test backup restore separately, and measure candidate Azure/Supabase region pairs from actual players. [Hosting assumptions](HOSTING.md) and [remaining work](ROADMAP.md) stay explicit.
