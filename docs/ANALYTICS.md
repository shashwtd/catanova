# Reporting on Catanova games

Gameplay lives in the Azure game server's SQLite database. Supabase owns authentication,
usernames and social data; it is not the dice or match-history database.

Website visits are a separate, much smaller record: Google Analytics 4 runs on the
public pages only, and only for visitors who choose **Accept all** in the consent
dialog. Google's tag is not loaded before that answer. See
[Measurement](art/RUNTIME.md#measurement) for how the loader keeps room codes out of it.

## What is recorded today

- `game_events`: each committed game action, actor seat, resulting state, revision,
  timestamp (`public_entry.at`), turn and automatic-action flag. Rolls include both
  dice and the game's dice mode. The event chain is retained across rematches.
- `match_records` and `match_participants`: current round's outcome, winner, scores,
  turns, timestamps and stable account IDs.
- `archived_matches` and `archived_participants`: completed rounds moved out of the
  current room record when players return to its lobby.
- `seats`: joins historical seat IDs to account IDs. Renaming an account does not
  change that identity. Game names remain historical.

The server writes events, match results and command receipts in the same transaction.
A retried command does not create another roll or another win. UI animations are not
counted as game events. There is currently no automatic deletion of the event journal.

## Example: roll frequencies by mode

Run reports against a read-only backup/export, not the live request path. This includes
all rounds and counts actual rolls, excluding setup, reconnection and other snapshots.
The optional dates are UTC ISO timestamps, matching `public_entry.at`.

```sql
SELECT
  coalesce(json_extract(state, '$.diceMode'), 'classic') AS dice_mode,
  coalesce(json_extract(public_entry, '$.automatic'), 0) AS automatic,
  json_extract(state, '$.dice[0]') + json_extract(state, '$.dice[1]') AS total,
  count(*) AS rolls
FROM game_events
WHERE json_extract(public_entry, '$.kind') = 'roll'
  -- AND json_extract(public_entry, '$.at') >= '2026-09-01T00:00:00.000Z'
  -- AND json_extract(public_entry, '$.at') <  '2026-10-01T00:00:00.000Z'
GROUP BY dice_mode, automatic, total
ORDER BY dice_mode, automatic, total;
```

The expected probabilities for two ordinary dice are
`1,2,3,4,5,6,5,4,3,2,1 / 36` for totals 2–12. Keep balanced, classic and legacy flat
games separate. Also separate automatic rolls when investigating player experience.
Balanced draws are not independent, so tests assuming independent dice samples are
not appropriate for that mode.

## Example: wins and completed games per account

```sql
WITH participants AS (
  SELECT p.user_id, p.outcome, p.points
  FROM match_participants p JOIN match_records m ON m.room_id=p.room_id
  WHERE m.finished_at IS NOT NULL
  UNION ALL
  SELECT p.user_id, p.outcome, p.points
  FROM archived_participants p JOIN archived_matches m ON m.room_id=p.room_id
  WHERE m.finished_at IS NOT NULL
)
SELECT user_id,
       count(*) AS completed_games,
       sum(outcome = 'won') AS wins,
       round(100.0 * sum(outcome = 'won') / count(*), 1) AS win_percent,
       round(avg(points), 2) AS average_points
FROM participants
WHERE outcome <> 'playing'
GROUP BY user_id
ORDER BY wins DESC, completed_games DESC;
```

This is a simple wins report, not a skill rating. Filter by room size, rules and sample
size before comparing players competitively. Resigned outcomes count once the whole
match has finished, matching the in-app games-played count.

## Limits and the next step at scale

- Older imported games may have only their final snapshot and recent log. Missing
  historical rolls cannot be reconstructed; don't count those snapshots as rolls.
- Events currently store full JSON snapshots, including hidden hands and development
  cards. Keep raw exports private. Public reporting should expose aggregates only.
- Dice mode is saved, but the server release/algorithm version is not recorded on every
  event. Record a rules version before comparing future balancing changes scientifically.
- Full snapshots use more disk than a compact analytics table. At larger volume, export
  new `(room_id, revision)` events incrementally into dedicated roll/match tables and
  run reports there. Don't add expensive all-history scans to gameplay requests.
- The current data supports game analysis, not page funnels or every hover/click.
  Those would need separate, deliberately scoped instrumentation.

No scraping of the public UI is needed for these reports, and no database schema change
is necessary to begin. Use the existing consistent database backup procedure for exports.
