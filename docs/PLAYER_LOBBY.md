# Player lobby

The signed-out landing page is unchanged. After account setup, Google users and guests enter a player lobby with their chosen avatar, wins, games played, recent matches and friends. Creating and joining rooms remain explicit actions. An invitation keeps its room preview and Join/Resume flow; a saved active session can still reconnect after a reload.

Profiles open on the player's record, with editing as a separate action. Game history lists outcomes, turns, dates and expandable player scores. Only an unfinished, non-resigned seat offers Return to game. You cannot use it to silently abandon another room.

## Saved records and privacy

- The game server derives records from accepted game snapshots and events. Clients cannot submit wins or results. Writes occur in the same SQLite transaction as the accepted action.
- Games played and wins count completed matches. Resigned players receive a completed loss when that match finishes. Unfinished games stay visible without increasing either total.
- `GET /api/account/games` verifies the Supabase caller, pages 20 matches at a time, and only returns matches owned by that account. Own hidden victory points remain private; opponent hidden points appear only after completion. Hands, development cards, deck order, authentication IDs and provider metadata are excluded.
- `match_records` and `match_participants` are rebuildable SQLite indexes. Existing saved matches backfill in batches of eight, yielding between transactions. An interrupted or timed-out backfill retains progress and returns a retryable error rather than partial totals. Unknown imported dates remain unknown.
- No new Supabase SQL or privileged key is required. Preserve the existing game volume and backups when deploying. Older seat-only local games cannot be assigned retrospectively to an account.
- A guest's history belongs to the same account ID after Google linking. The existing seven-day guest expiry and friends restrictions still apply.

## Friends and rooms

Friends open in a right-side modal drawer with separate request, search and removal flows. Search responses are invalidated on edits, closing and account changes. Relationship writes invalidate older reads so a stale refresh cannot restore a removed friend.

Signed-in foreground clients check in every 25 seconds; connected game sockets also update presence. Online status expires after 75 seconds without a check-in and is shown only to confirmed friends. Offline means no recent check-in, not an exact last-seen time. Failed refreshes clear cached presence. Presence is transient and resets after a server restart; it is not a durable player record.

Room lobbies show actual occupied portraits and compact invite controls rather than four mandatory-looking seats. Games still require two to four connected players. Only non-hosts mark Ready; the host starts. Timer settings are visible. Share, copy link and copy code remain separate controls; copy success replaces only the clicked icon.

## Design references and checks

The navigation separates profile/record, party actions and social activity. This draws on the clear team entry in [Brawl Stars friendly games](https://support.supercell.com/brawl-stars/en/articles/friendly-games-4.html) and the distinct navigation, lobby and social areas described in [VALORANT's interface update](https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-12-00/). Artwork, colors and components remain Catanova's own.

Layouts include narrow phone and short landscape breakpoints, flexible username widths, large touch controls, native dialog focus containment and reduced motion. Automated tests cover markup, eligibility, account isolation, result recovery, stale requests, presence expiry and multiplayer regression. They do not replace a physical-device or visual browser review.

## Release

This feature is reviewed on `feature/player-lobby/2026-09-11`. It does not configure automatic deployment. Merge into `main`, then deploy the reviewed commit using the [operator runbook](../deploy/single-vm/OPERATIONS.md#deploy-a-reviewed-update). The additive record indexes do not replace canonical game saves; a UI rollback need not remove them.
