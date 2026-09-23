# Contributing

Use Node 24 LTS, run `npm ci`, and then `npm run check` while you work. Before merging, run the full gate, [`npm run ci`](#the-merge-gate-npm-run-ci). Keep generated output, local databases, credentials, and third-party reference PDFs out of commits.

Submit focused pull requests with the problem, resulting behavior, and relevant validation. If the change touches multiplayer, explain what happens during retries, reconnects, concurrent actions, and server failure. Accepted state must be saved before acknowledgment. Never send another player's private data to a client and merely hide it in the interface.

For rule changes, cite a primary source and update `docs/RULE_SOURCES.md`. Keep intended rules separate from implementation status. Add executable rule scenarios as the engine is built. Changes that affect outcomes or legal choices must identify the ruleset version; old saved games must not silently change rules.

Keep the rules package independent of rendering, databases, sockets, and wall-clock time. Record random outcomes so a game can be replayed. Use stable resource identifiers `wood`, `brick`, `sheep`, `wheat`, and `ore` in saved data. Use `RESOURCE_NAMES` for the player-facing labels Timber, Clay, Sheep, Hay and Rock. Run `npm run format` on source changes.

Submit only original or appropriately licensed contributions. Record the source, creator, modifications, and license of assets. Generated artwork needs its generation provenance and any third-party references recorded. Do not commit official CATAN artwork, copied manual text, or credentials. The repository's original code and documentation use the MIT license.

## The merge gate: `npm run ci`

GitHub Actions has not run for this repository since **20 September 2026** (the account is locked over a billing issue), so nothing checks a pull request automatically. Run **`npm run ci` before merging and before every deploy**. It runs, on your machine, everything [the workflow](.github/workflows/ci.yml) ran:

- `npm ci --dry-run` against a scratch copy of the manifests, which fails exactly when `package.json` and `package-lock.json` disagree, then an exact comparison of the installed `node_modules` with the lockfile. Your `node_modules` is never deleted; a stale, missing or extra package fails the gate with `run npm ci`.
- Typecheck, tests and the production build (`npm run check`), then `npm audit --omit=dev --audit-level=high`.
- `bash -n deploy/single-vm/bootstrap.sh`, every Python test suite under `deploy/single-vm` (the workflow ran only the backup folder's), and the production Compose validation with the workflow's placeholder values.

Every step runs even after a failure, then a summary lists each step as `PASS`, `FAIL` or `SKIP` with its time. The command exits nonzero if anything failed. Variables that change the build or the bots, such as `GA_MEASUREMENT_ID` and `TYPESAFE_API_KEY`, are removed first, as on a clean runner. The audit needs network access. Without Docker, the Compose check is reported as skipped; the deploy runbook validates Compose on the VM again.

On a machine with Docker, `npm run ci -- --docker` also builds the image, starts it with `docker compose up --build --wait`, runs `npm run probe` against it and removes it with `docker compose down -v`. It uses the separate Compose project `catanova-ci`, so your own local volume is untouched. The summary says when this part did not run.

Run the gate from a clean checkout of the exact commit you will merge or deploy; the summary warns when uncommitted changes are included. `npm run ci` is not `npm ci`, which is npm's clean install. The workflow also tested Node 26; the gate uses whichever Node you run, and production images use Node 24.
