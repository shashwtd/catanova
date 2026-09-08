# Contributing

Use Node 24 LTS, run `npm ci`, and then `npm run check`. Keep generated output, local databases, credentials, and third-party reference PDFs out of commits.

Submit focused pull requests with the problem, resulting behavior, and relevant validation. If the change touches multiplayer, explain what happens during retries, reconnects, concurrent actions, and server failure. Accepted state must be saved before acknowledgment. Never send another player's private data to a client and merely hide it in the interface.

For rule changes, cite a primary source and update `docs/RULE_SOURCES.md`. Keep intended rules separate from implementation status. Add executable rule scenarios as the engine is built. Changes that affect outcomes or legal choices must identify the ruleset version; old saved games must not silently change rules.

Keep the rules package independent of rendering, databases, sockets, and wall-clock time. Record random outcomes so a game can be replayed. Use stable resource identifiers `wood`, `brick`, `sheep`, `wheat`, and `ore` in saved data. Use `RESOURCE_NAMES` for the player-facing labels Timber, Clay, Sheep, Hay and Rock. Run `npm run format` on source changes.

Submit only original or appropriately licensed contributions. Record the source, creator, modifications, and license of assets. Generated artwork needs its generation provenance and any third-party references recorded. Do not commit official CATAN artwork, copied manual text, or credentials. The repository's original code and documentation use the MIT license.
