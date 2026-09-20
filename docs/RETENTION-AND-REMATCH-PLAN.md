# Simple retention reporting and a better rematch

Revised 21 September 2026 after code review and owner feedback.
Implemented with participant-scoped results and a private snapshot report.
See [the reporting guide](RETENTION-REPORT.md) for the private report command.

## Priority

Improve the rematch interface first. Produce a small useful report from existing
records alongside that work. Do not build a new event pipeline, dashboard,
invite funnel, session recorder or extensive telemetry system for this release.

The outcome is straightforward: the group can finish, read its results and play
again without another room code, while we can see whether games finish and people
come back. No daily rewards, streaks, game-mechanics changes or broad visual redesign.

## Findings from review

- The existing return-to-lobby path preserves the room and settings, archives
  results, clears readiness and creates a fresh board. Reuse it.
- The results interruption is real at the code level: `returnToLobby` deletes
  the shared current game; the client mounts results only while that game is
  finished. One player's click therefore removes the state everyone else's
  results screen uses. Add a multi-client reproduction before changing it.
- Match start/end, initial-placement progress, duration and turns are already
  recorded or derivable. They do not need duplicate tracking events.
- Guests lose continuity after account expiry, clearing storage or switching
  device. Account retention is not the same as retention of real people.
- Storage is SQLite in Docker volume `catanova-game-data`, on the Azure VM.
  “Azure SQLite” was imprecise, not evidence of a different storage service.
- `deploy/single-vm/AZURE.md` records downloaded-backup checksum, integrity,
  foreign-key and table checks. Played-match recovery from that backup remains
  unverified; the separate reboot test does not prove it. Neither “no backup
  testing” nor “full recovery verified” is an accurate description.
- Archives currently receive a new key when the room is reset. New durable match
  IDs would need to be minted at start and carried into archives. That migration
  is not required merely to produce this first report.
- Deployment revision is an image label, not currently persisted match metadata.
  Broad release/version instrumentation is deferred, not assumed to be free.

## Workstream 1: rematch interface

### Results screen

Keep the current visual direction. Improve the actions and coordination rather
than redesigning the entire victory screen.

- Primary action: **Return to lobby**. Secondary action: **Back to hub**.
- Each person can continue reading the final standings and score breakdown while
  others return to the lobby. Another player's click does not dismiss their screen.
- If others have moved on, show a compact **Your group is in the lobby** message
  and keep Return to lobby available. Do not show a second competing dialog.
- A participant's Return to lobby enters the same shared lobby. It neither readies
  another human nor starts the next game automatically.

### Same lobby, next game

- Preserve the room link/code, settings, eligible players, avatars, colors and bots.
- Retain the existing readiness interaction: other humans choose Ready, the host
  chooses Start. The host does not need an additional ready step.
- Show readiness in the player area, with a short “Waiting for…” state when useful.
- Use a fresh board and the existing new-game turn-order shuffle.
- Players who are offline or have left do not silently become ready. Keep existing
  departure, bot and room-eligibility rules; handle host departure explicitly.
- Keep a small Previous results action in the lobby until the next match starts.
- Keep desktop and phone actions visible without extra stacked dialogs or scrolling.

### Implementation boundary

The reset stays server-authoritative and idempotent. Separate the client's results
presentation from the shared room phase. Retain a final-results summary immediately. Participant socket snapshots include the
archived summary while the room is in its lobby, so refreshing recovers the result.
A tab stores only its dismissal decision in session storage. Separate archived
retrieval is also available through the authenticated endpoint below. Local memory
alone is insufficient.

This is an explicit new read-only server API, available as
`GET /api/account/matches/:archiveId/results`, designed and tested as part of the
rematch work. Reuse archive IDs; authorize against recorded participants before
returning an allowlisted final-results DTO. Never return raw journal snapshots or
serialized database rows. Do not expose hidden hands, tokens or account IDs. Test
another account's archive ID, unauthenticated access and malformed IDs. Spectators
retain their existing visibility rules; this participant endpoint does not grant
them new historical access or readiness/reset privileges.

Concurrent clicks return everyone to one lobby, create one archive and do not reset
an already-started next round. A host cannot inadvertently start while another
human is still reading results and has not readied up.

## Workstream 2: one simple report

Generate a private HTML report with CSV export for a chosen date range, using a
consistent database snapshot. No new paid service, public endpoint or live-table
scans on gameplay requests. The report should answer four questions:

| Measure                 | Definition                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How many games finish?  | Started matches split into points wins, resignation wins, abandoned and still running. Show counts and rates; pending games are not failures.                                                                                                                                                                       |
| How long do games take? | Median recorded start-to-finish duration and turns, split by terminal outcome. Label it elapsed duration, not active human play time.                                                                                                                                                                               |
| Do groups play again?   | Finished human multiplayer matches followed within 30 minutes by another match with at least two of the same human accounts. Report the overall rate plus same-room and new-room counts, using the first qualifying subsequent match so each source match counts once. Exclude incomplete observation windows.      |
| Do players return?      | Human accounts with a recorded human action 24–48 hours after their first observed human-played match began. Fix that anchor once per account; report only cohorts whose full 48-hour window has elapsed. Label it 24–48-hour return, with numerator/denominator; it measures observed accounts, not unique people. |

Use current and archived match/participant tables together, excluding duplicates,
plus the game journal only for missing facts such as finish reason and round
boundaries. `match_records.revision` is the latest commit revision, not the start.
For a report-only stable key, derive the round's start-event revision from
`game_events` (its public entry has `kind = start`), bounded by that match's recorded
revision, and pair it with the source room. This is a journal lookup, not an existing
`start_revision` column. Archived rows supply `source_room_id` and their final
recorded revision; current rows supply their room ID and latest revision. Validate
round association and use existing legacy identifiers plus unknown coverage when
a start event is missing. No schema migration is needed just to rename records.

A move from new-room rematches to same-room rematches is convenience adoption,
not automatically more repeat play. Compare the overall repeat rate and its two
components before claiming improvement. These observational counts alone cannot
prove the UI caused a change. The 24–48-hour return window never slides forward
with a player's newest match; incomplete historical coverage is labelled as such.

Exclude invited bot seats from human retention. Separate games with invited bots
from human-only games where records support it. A former human's seat finishing
under a stand-in is not proof the human returned. For return counts require a
recorded human action where actor provenance is reliable; mark unknown coverage
rather than invent presence or intent. Do not turn a bot's automated turn into a
human visit. Exact stand-in duration and human attendance are out of scope.

Split guest and permanent-account retention when account type is known. Historical
match records do not establish guest status at the time of play: show unknown,
not a guessed classification from today's account. If needed for new matches,
capture only that small server-verified account-type field at start, with unknown
as the backward-compatible default. The implementation stores private actor origin
(`human`, `bot`, `timer`, `system`) with existing journal rows and a small roster
with account type/bot status on the start row. None of this is sent to GA4. Guest continuity can undercount returning
people; say so beside the report. Keep linked accounts on their retained identity.

Reports contain aggregate figures, no names, emails, room codes, tokens, private
hands or raw snapshots. Internal identity joins stay local to the reporting job.
Website GA4 remains separate. This release adds no browser tracking and no new
30-day deletion policy for the authoritative match journal.

## Deferred

Invite-seen/accepted funnels, join failure telemetry, reconnect/stand-in interval
tracking, FPS collection, automatic analytics exports, release attribution, broad
match metadata, stable UUID migrations and a permanent admin dashboard. Add one
only when a concrete question cannot be answered from the small report.

## Validation and delivery

Two coherent commits: the rematch experience and the reporting script/tests.
Do not block rematch UI on report expansion. If a small shared record change is
needed, keep it explicit and compatible rather than creating a telemetry framework.

- Reproduce two clients at results; one returns while the other keeps reading.
- Verify mobile layout, readiness, concurrent returns, previous-results retrieval,
  refresh/reconnect, host departure and attempts by unauthorized viewers.
- Finish two successive games in one room; preserve both histories and count each
  start/result once after retries and restart.
- Validate reports against fixtures including abandonment, bots/stand-ins, guests,
  incomplete date windows, same-room/new-room repeats, fixed return-window anchors
  and archived rounds. Unknown remains unknown.
- Restore a consistent backup into an isolated environment before using it as a
  report input; check integrity and never point reporting tools at writable
  production data. Exercise played-match recovery before any destructive storage
  migration; no such migration is proposed here.
- Run appropriate checks and take the normal production backup before deployment.

Review the report two weeks after release. If there are fewer than 20 completed
human multiplayer matches, treat the findings as directional and proceed with
expansion anyway. This is a planning checkpoint, not a significance threshold.

The release is done when rematch works across two clients and refresh/reconnect,
no known reproducible blockers remain in that flow, and report counts reconcile
with test fixtures and sampled saved games. Do not wait for a target retention
percentage or a larger audience before moving to bigger maps and more players.
