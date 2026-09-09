# Catanova

An open-source Catan-style game for **three or four friends**, built around reliable multiplayer and a hand-painted island.

Trade **Timber, Clay, Sheep, Hay, and Rock**. Build settlements and cities. Race to ten points. Resume your seat when your connection drops.

**Status: first playable local build.** The browser game supports setup, dice and production, discards and the robber, building, bank/port and player trades, development cards, Longest Road, Largest Army, and victory. This is an early playtest, not a production service or a certified rules implementation. [Current scope and differences](docs/PLAYTEST.md).

## Play locally

Use **Node.js 24 LTS** or Node 26:

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:3000**. Choose **Create room** or **Join room**, then meet in the lobby. Pick a fantasy avatar and invite friends. The other players mark Ready; the host presses Start once all three or four seats are connected and everyone else is ready. The host can configure an optional turn timer in Settings. An invite opens that room’s roster and Join/Resume prompt. The board appears after Start. To test all four seats locally, open four independent tabs; a duplicated tab can inherit and resume the original seat.

Game tools and connection details sit at top left; room, invite and profile controls sit at bottom left. Players and awards are on the right. Resource cards sit above the bottom table edge, beside the dice, trade and development-card buttons. Scroll/pinch to zoom, drag to pan and gently tilt the board, or use the single Fit-view icon. Each harbor has two bridges to its eligible coastal corners.

Two thrown dice land on the accepted server result. Producing tiles glow and resource cards travel to your hand; building spends miniature cards with distinct material sounds. Development cards have illustrated stories, a compact spread, explicit Play controls, and explanations for cards held until next turn. Settings control sound, volume, effects and 3D pieces. [Feedback and performance](docs/GAME_FEEDBACK.md), [turn timer rules](docs/TURN_CLOCK.md).

The local URL works on this machine. Other devices need an HTTPS proxy/tunnel or the future hosted deployment. See [playtest instructions](docs/PLAYTEST.md) for recovery, controls, and development setup.

The same application serves the browser and WebSocket endpoint. No separate client deployment or paid cloud service is required for local play. SQLite uses Node's built-in module (experimental in Node 24) and saves into `data/probe.sqlite`, excluded from Git. A restart preserves accepted actions, the board, hands, deck, dice, phases and seats.

## A fairer starting island

The default **balanced-v1** preset keeps the standard resource and number supplies, with explicit bounds:

- No connected resource clusters larger than two tiles; every resource is spread across the island.
- No adjacent 6/8 tiles, and no intersection above 11 production pips.
- Each resource gets a reasonable share of production numbers.
- Nine separated ports with the familiar ratios.

Strong three-resource placements remain possible. Dice are independently random; there are no catch-up rolls. This is a named custom setup, separate from the official spiral/fixed presets. [Generation rules and tests](docs/MAP_GENERATION.md).

## One self-hostable distribution

```sh
docker compose up --build --wait
```

Open the same local URL. Compose binds to localhost and uses a named persistent volume. `docker compose down` stops it; adding `-v` **deletes saved games**.

For environment configuration, copy `.env.example` and start with:

```sh
node --env-file=.env dist/apps/server/src/index.js
```

Same-origin browser connections work automatically. `ALLOWED_ORIGINS` permits additional exact origins, useful during development.

**Google login through Supabase is integrated and requires project configuration.** Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, enable Google in that project, and configure its OAuth redirects. [Authentication setup](docs/AUTH.md). Authenticated seats and saved cosmetics belong to the verified account; opening the same invite on another device can recover that account’s seat.

With no auth configuration, local development uses the existing seat-token playtest mode, clearly labeled in the menu. Production refuses to start without authentication unless local playtesting is explicitly enabled. The loopback-only Compose example makes that choice explicit. Public guest accounts are **not enabled**; [the proposed guest policy](docs/GUEST_ACCESS.md) awaits approval.

The planned hosted service uses one always-on Azure application with nearby Supabase Postgres. The production database adapter is not implemented and no cloud instance is deployed. Budget estimates remain **about $45–55/month lean, or $65–80/month with more headroom**, before credits and taxes; assumptions and source links are in [hosting and costs](docs/HOSTING.md).

## Check the build

```sh
npm run check
npm run probe
```

`check` runs TypeScript, the test suite and the browser/server production build. `probe` needs a running server and creates a separate counter-only test room. The tests cover 500 map seeds, three/four-player setup, rule scenarios, resource conservation, real four-client gameplay, concurrent lobby readiness, account ownership, the Supabase verification contract, durable move history, invite previews, lobby departures, both harbor entrances, all 72 road orientations, bounded zoom/3D tilt, correct die faces, resource-effect timing, optional server-owned turn/discard deadlines, rejected rollback snapshots, hidden-state filtering, duplicate commands, lost replies, refresh/restart recovery, failed writes, and a child server killed with `SIGKILL`. They do not establish internet latency, supported-device performance, or cloud availability.

Use `npm run dev` for a build plus server watch. Add `npm run dev:client` in a second terminal for client hot reload at port 5173. `npm run format` formats source and documentation.

## Project layout

```text
apps/
  client/       React UI, static terrain, CSS 3D, sound/effects, recoverable connection
  server/       Same-origin HTTP/WebSocket server, private snapshots, SQLite saves
packages/
  protocol/     Shared messages and bounded input validation
  rules/        Pure rules engine, board topology, seeded balanced generation
docs/           Rulebook, source ledger, playtest, architecture, hosting, roadmap
scripts/        Connectivity probe
tests/          Rules, maps, four-client gameplay, recovery and HTTP checks
```

The client animates accepted state; the server owns randomness, hidden information and move validation. The rules engine stays independent of rendering and networking. One repository keeps those contracts reviewable together.

## Rules and contributing

- [Base-game rulebook](docs/RULEBOOK.md) and [source/compatibility ledger](docs/RULE_SOURCES.md).
- [Fixed and classic setup reference](docs/SETUP.md); these presets are not in the UI yet.
- [Architecture](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md), and [art provenance](docs/ART.md).
- [Contributing](CONTRIBUTING.md) and [security](SECURITY.md).

Original repository contributions are MIT-licensed; see [LICENSE](LICENSE). Terrain, environment, resource and avatar atlases are original AI-generated art, with their prompts and provenance recorded. Bundled fonts and interface icons retain their own licenses, listed in the art documentation. Do not contribute official game artwork or copied rulebook passages.

Catanova is an independent, unofficial project. It is not affiliated with, endorsed by, or licensed by CATAN GmbH or CATAN Studio. CATAN is a trademark of its respective owners. The original game was designed by Klaus Teuber. The MIT license applies to our contributions and grants no rights to third-party trademarks or assets. Public source availability does not establish legal clearance for the name or a finished release.
