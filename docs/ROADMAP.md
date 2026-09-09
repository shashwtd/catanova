# Roadmap

## Present: first playable local game

- [x] Public Catanova repository, MIT license, independent rulebook and source ledger.
- [x] Timber, Clay, Sheep, Hay and Rock; textured original terrain, environment and resource atlases.
- [x] Reproducible balanced islands with inventory, geometry and fairness tests across 500 seeds.
- [x] Three/four-player lobbies, direct invite previews, explicit Create/Join, lobby leave and host transfer.
- [x] Shuffled turn order and snake setup.
- [x] Dice production, bank shortages, sevens/discards, robber and private theft.
- [x] Roads, settlements, cities, piece limits and distance/connectivity rules.
- [x] Bank/port exchanges and public player offers/acceptance.
- [x] Development deck, card timing/effects, road/army awards and own-turn victory.
- [x] React interface, clickable legal sites, private hands, journal and endgame.
- [x] Saved games, revision checks, atomic command receipts and per-player projections.
- [x] Reconnect, tab-refresh outbox recovery, restart and process-crash tests.
- [x] One browser/server distribution, Docker/Compose and CI.
- [x] Azure/Supabase architecture and cost estimate.

## Next: human playtests and rule conformance

- [ ] Play full games with three and four people; record usability and rule discrepancies.
- [ ] Test desktop/mobile browsers, touch placement, accessibility and slow devices.
- [ ] Resolve the two provisional rare-card decisions in the source ledger.
- [ ] Turn every applicable source-ledger row into a reviewed fixture, including more award tie/split and piece-exhaustion cases.
- [ ] Add classic spiral and fixed beginner presets, with verified port fixtures.
- [ ] Decide whether to add trade counteroffers, chat, placement confirmation and rematch controls based on playtests.
- [ ] Measure action, reconnect and frame-time distributions; add a repeatable network/load harness.

## Hosted games

Implement and test the production Postgres adapter, schema migrations, server ownership/fencing, deployment draining, invitation/account policy, expiration and recovery. Add telemetry without private hands or tokens. Choose regions and budgets using available Azure/Supabase credits, then deploy a controlled internet playtest. Test sleeping devices, mobile networks, database failure and backup restoration separately from normal restart.

## Visual and audio polish

Keep terrain instantly readable and playful. Improve pieces, resource arrivals, dice and interaction feedback using the current art direction. Add original sound with volume/mute controls. Measure the new static WebGL terrain layer and its SVG fallback across devices. Optimize the generated PNG delivery pack for slow connections. Keep the renderer free of continuous idle animation.

## Public playable release

Complete compatibility review, full human games, supported-device checks, internet failure/load testing, operational monitoring/backups, self-hosting validation and naming/asset review before a stable release. Public GitHub source is already available; production hosting is a separate milestone.

Expansions, two-player variants, ranked matchmaking, bots, spectators, replay sharing and native apps follow a dependable base game.
