# Roadmap

## Present: rules and connectivity

- [x] Name: Catanova; one repository with MIT-licensed original code and documentation.
- [x] Independently written base-game rulebook with an edition/source ledger.
- [x] Familiar resource names and shared game constants.
- [x] Four-seat rooms, private resumable seat credentials, and room isolation.
- [x] Durable test action, state revisions, unique command receipts, and stale-action rejection.
- [x] Automatic client reconnect and current-state synchronization.
- [x] Real-socket integration tests and abrupt-process-death recovery test.
- [x] Docker/Compose recipe and CI definitions.
- [x] Azure/Supabase architecture and cost estimate.
- [ ] Resolve exceptional card-effect questions in the source ledger.
- [ ] Implement and visually verify the documented board/port setup fixtures.

## Next: executable rules

Implement hex/edge/intersection topology, setup, turn phases, production, discards/robber/theft, building, bank/player trades, development cards, road/army scoring, and victory. Add scenario tests alongside each rule, deterministic replay with logged randomness, and resource/piece conservation checks. Reference `RULE_SOURCES.md` IDs in test names or fixtures. Keep every new match pinned to a ruleset version.

## Then: one playable private game

Implement the lobby, invite links, board, placement previews, hand, trade offers/counteroffers, action log, and endgame. Filter hidden information on the server before it is transmitted. Add reload recovery with private session storage and recovery of uncertain pending actions. Play complete games with three and four people.

## Hosted recovery and visual polish

Add the production Postgres adapter, migrations, safe deploy/restart recovery, invite/account controls, and expiration policies. Deploy a controlled test instance after selecting region, credits, and budget. Run real internet connectivity, failure, and load tests. Establish the visual reference sheet and test a small animated board with final-quality terrain, pieces, audio, and motion settings.

## Public playable release

Resolve remaining compatibility questions, validate the complete ruleset, test supported devices and network failures, establish monitoring/backups, document self-hosting, and review naming/assets before promoting the finished game. Public source publication is an earlier milestone and does not imply the hosted game is ready.

Expansions, ranked matchmaking, advanced bots, spectators, replay sharing, and native apps follow when the complete base game is dependable.
