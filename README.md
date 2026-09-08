# Catanova

An open-source Catan-style game built around reliable multiplayer and a richly illustrated board.

Build settlements, trade wood and sheep, race for the longest road, and finish the game you started—even if your connection drops along the way.

**Status: rules and connectivity foundation.** Catanova is not playable yet. This repository contains an independently written base-game rulebook, shared game constants, a resumable WebSocket client, a small authoritative server, and automated failure-recovery tests. The board, trading interface, and complete rules engine are next.

## Start with the rules

- [Base-game rulebook](docs/RULEBOOK.md): three or four players; wood, brick, sheep, wheat, and ore.
- [Source and coverage ledger](docs/RULE_SOURCES.md): reference edition, clarifications, remaining questions, and implementation coverage.
- [Setup reference](docs/SETUP.md): fixed beginner board and variable setup.
- [Architecture](docs/ARCHITECTURE.md): one repository, separate responsibilities, one self-hostable distribution.
- [Hosting and costs](docs/HOSTING.md): Azure and Supabase options, assumptions, and launch requirements.
- [Roadmap](docs/ROADMAP.md): what is implemented and what comes next.

## Run the connectivity prototype

Use **Node.js 24 LTS** and npm. Node 26 is also tested. The prototype uses Node's built-in SQLite module, which is experimental on Node 24; it is a local prototype dependency, not the planned cloud database.

```sh
npm ci
npm run check
npm run build
npm start
```

In another terminal:

```sh
npm run probe
```

The probe creates a room, connects two independent clients, submits an increment command, and verifies that the other client receives the committed state. It prints a PASS result with the measured round trip and fanout time. **The counter is a transport test, not a game rule.** There is no browser game UI yet.

Health endpoint: `http://127.0.0.1:3000/healthz`. WebSocket endpoint: `ws://127.0.0.1:3000/ws`. Local data is stored in `data/probe.sqlite`, excluded from Git. Restarting the process preserves seats, state, and command receipts.

To test an externally hosted instance:

```sh
npm run probe -- wss://your-host.example/ws
```

This performs real network traffic and creates a small test room. A local pass does not establish internet latency, cloud availability, or capacity.

## One self-hostable distribution

```sh
docker compose up --build --wait
```

The included Compose configuration binds to localhost and mounts a named persistent volume. Run the same probe against it. Stop with `docker compose down`; adding `-v` **deletes the saved prototype data**.

To configure a normal Node process, copy `.env.example` to `.env` and use:

```sh
node --env-file=.env dist/apps/server/src/index.js
```

The server defaults to localhost. Set `HOST=0.0.0.0` when intentionally exposing it on a LAN or inside a container. `ALLOWED_ORIGINS` is an exact, comma-separated allowlist for future browser clients. Non-browser clients without an Origin header are allowed; this is not an authentication boundary. Use TLS at an ingress proxy for internet connections. See [hosting](docs/HOSTING.md) before running the prototype publicly.

## Project layout

```text
apps/
  client/       Browser-compatible connection and resume client; UI comes later
  server/       WebSocket rooms, command validation, durable prototype storage
packages/
  protocol/     Shared wire messages and input validation
  rules/        Base-game constants; pure game engine comes next
docs/           Rulebook, sources, setup, architecture, hosting, roadmap
scripts/        Two-client connectivity probe
tests/          Real sockets, restart, crash, authorization, and retry tests
```

Keep the client and server in the same repository so a protocol change can be reviewed and tested together. They are separate runtime boundaries: the server owns hidden information and validates actions. The intended production distribution will serve the built client and WebSocket endpoint from one application; the static client can move to a CDN later without splitting the repository.

## Reliability already exercised

The automated suite uses real localhost sockets and a real database. It checks room isolation, four-seat capacity, seat authentication, malformed input, stale commands, duplicate receipts, replaced connections, write failures, automatic client reconnection, and a child server killed with `SIGKILL`.

These checks cover the prototype. They do not certify the future rules engine, database disaster recovery, distributed failover, or production load. Single-instance SQLite is deliberately limited to local development and the connectivity proof; planned hosted matches use Postgres.

## Contributing and licensing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Original repository code and documentation are MIT-licensed; see [LICENSE](LICENSE). Future artwork, audio, and fonts must carry explicit provenance and license records. Contributors must not add official game artwork or copied rulebook passages.

Catanova is an independent, unofficial project. It is not affiliated with, endorsed by, or licensed by CATAN GmbH or CATAN Studio. CATAN is a trademark of its respective owners. The original game was designed by Klaus Teuber. The MIT license applies to our original contributions and grants no rights to third-party trademarks or assets. Public source availability does not establish legal clearance for the name or a finished release.
