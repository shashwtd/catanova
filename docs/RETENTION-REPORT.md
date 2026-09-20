# Private retention report

This is one offline command, not a dashboard or new browser tracking. Gameplay and
match storage stay in SQLite; Supabase accounts remain the identity source. No
Supabase SQL changes, GA4 configuration or paid service are required.

## Run it

1. Download a consistent backup using the existing [backup procedure](../deploy/single-vm/backup/README.md#restore-and-verify).
   Decompress it to a private directory. Never copy the main file of an open SQLite
   database without its WAL, and never point this command at the production volume.
2. Use the backup's actual capture time for `--as-of`. Choose a match-start date range
   with `from < to <= as-of`; timestamps must be UTC ISO strings. These date filters
   do not change the rolling 24–48-hour return definition.
3. From the repository, with Node 24+ and dependencies installed:

```sh
npm run report:retention -- \
  --snapshot /private/path/snapshot.sqlite \
  --as-of 2026-09-21T12:00:00Z \
  --from 2026-09-07T00:00:00Z \
  --to 2026-09-21T12:00:00Z \
  --out /private/path/catanova-report
```

Open `retention.html` locally; `retention.csv` holds the same aggregate measures.
The command rejects WAL/SHM sidecars, validates integrity and foreign keys on an
isolated working copy, and uses read-only SQLite plus `query_only`. It never runs
Store migrations, backfills records, connects to production, or sends network
requests. SQLite's temporary sidecars stay in its disposable working directory.
It rejects an observation time earlier than the latest journal entry. Keep reports
private and outside the repository, even though they contain only aggregate counts.

## What it answers

- **Completion:** started matches split into points wins, resignation wins,
  abandonment, running, and unclassified finishes. Running is not failure.
- **Duration:** median elapsed start-to-finish minutes and turns per terminal
  outcome, with sample sizes. Elapsed time includes pauses and disconnections.
- **Group return:** a finished human multiplayer match followed within 30 minutes
  by another with at least two shared human accounts. The first qualifying next
  match counts once; same-room and new-room counts add up to the overall result.
  A full 30-minute observation window is required. The source match's start must
  be in the selected range; the next match can fall outside it.
- **Account return:** a proven human action in `[24h, 48h)` after that account's
  first observed match containing a proven human action. The anchor uses the
  entire snapshot, never only the selected date range or the latest match.
  Only anchors in the selected range with a full 48-hour window are included.

There are separate bot-mix and guest/permanent/unknown breakdowns. A stand-in move
or timer action never counts as a human return. Account type is fixed at the
anchor match, so later linking a guest account does not rewrite the cohort.

## Coverage and interpretation

The report joins current and archived match records to their recorded participants.
It derives a match key from the source room plus start-event revision, bounded by
that record's latest/final revision. A record's `revision` is **not** a start revision.
Legacy records without a start event retain separate legacy keys and explicit
unknown coverage. Unindexed saved games are reported as excluded; the report does
not mutate a snapshot to backfill them.

Before this change, invited bot and stand-in actions lacked reliable actor origin.
Do not treat a missing `automatic` flag as proof of a human move. Old account-action
provenance and account type at play remain unknown. New journal rows record private
`actor_kind`; start rows capture `participants` with bot status and verified account
type. These nullable, additive fields do not alter game state, public move history
or the journal's authoritative state hashes. Existing games keep working. Matches
already underway may have proven new actions but unknown starting account type.

Accounts are not people: guest expiry, storage clearing and a different device can
split one person into multiple identities. Linking preserves the existing account.
Historical gaps mean the first _observed_ human-played match may not be the real
first match. Read coverage alongside the return rate; zero eligible accounts means
no estimate, not zero-percent retention.

Moving repeat play from new rooms to the same room is convenience adoption. Read
the overall group-return rate as well as its two components; do not call their shift
proof that the rematch UI caused people to return.

Review after two weeks. With fewer than 20 completed human multiplayer matches,
treat the findings as directional and continue toward bigger maps and modes. Add
another measure only when a specific question cannot be answered here.

## Rematch storage and access

`Return to lobby` archives one allowlisted `MatchResults` DTO in `match_results` as
part of the existing reset transaction. It contains standings, final score parts,
awards and cosmetics; no private hand, token or account ID. It is returned only to
recorded seats in authenticated room snapshots and recorded accounts at
`GET /api/account/matches/:archiveId/results`. That endpoint uses the existing
account verification, guest expiry, history rate limit and no-store responses.

Each browser tab dismisses its own results. Other players keep theirs open with
“Your group is in the lobby.” Refresh in the lobby restores the summary; the
per-tab dismissal decision avoids reopening it after someone already returned.
“Previous results” is available until the next match starts. Opening it clears
that player's readiness first when needed. Humans choose Ready; the host chooses
Start game. Bots remain ready. This adds no 1v1 queue or automatic match start.

Historical archives from before this feature still appear in normal game history;
they do not gain a reconstructed full results screen. No authoritative journal
pruning or match-ID migration is part of this release.
