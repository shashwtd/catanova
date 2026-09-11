# Lobby settings and turn clock

The host can enable a turn timer before a game starts. The five slider stops are **40, 65, 90, 115, and 140 seconds**; enabling the slider initially selects 90 seconds. The timer is off by default. These are optional house rules layered over the unchanged base-game rules.

Only the host can change these settings. Every change is saved, broadcast to the room, and resets the other players' readiness. Ready messages sent against older settings are rejected, so a delayed message cannot consent to an unseen change. The host's **Start** button is their consent; the host does not need a separate Ready step. Every other player must be ready and every seat must be connected before starting. Settings lock when the game starts.

## What happens when time runs out

Setup settlements and roads are untimed. The first normal turn starts its countdown when setup finishes. Rolling, trading, buying, playing a development card, and reconnecting while someone else remains in the game do not restart that countdown.

At expiry, the server finishes the current turn using legal defaults:

- Roll the dice if the player has not rolled.
- Move a pending robber to a randomly chosen different tile, choosing a legal adjacent victim if needed.
- Complete any remaining free roads from a Road Building card the player already chose to play, using random legal sites.
- End the turn and withdraw any outstanding trade offer.

The timer never buys a piece, spends resources on an optional action, accepts a trade, plays an unchosen development card, or forfeits a player's seat. The ordinary rules still decide awards and victory during these actions. Random choices use the server's private randomness, and every accepted automatic action appears in move history with a timer explanation.

## A seven and shared discards

Rolling seven pauses the active player's clock while discards are outstanding. Each player who must discard gets their **own full configured duration** to choose cards. One player's submitted discard cannot shorten or restart another player's deadline.

On a discard deadline, the server randomly discards the required number of resource cards from that player's actual hand, without replacement. Card identities remain private; the public history records the discarded count. Once everyone has discarded, the active player's remaining time resumes. If that player's turn had already expired before the seven was rolled automatically, the server completes the robber move and ends the turn as soon as discards finish.

## Persistence and synchronization

The game server owns all deadlines. Room snapshots and ping replies include its current epoch timestamp; clients estimate the offset and render a countdown locally. Clients do not send timeout decisions or decide whether a turn has expired.

The deadline and paused/discard deadlines are stored in SQLite. Each game action saves the game state, clock update, event history, and command receipt in the same transaction. A storage failure cannot acknowledge a successful move or advance just the clock. Automatic actions use the same rule validation and commit path as manual moves. Their history entries carry `automatic: true`.

The server checks due clocks approximately every half second, in bounded batches, while at least one remaining player is connected. It also checks the deadline before accepting a manual action, closing the race between a click at expiry and the next scheduler tick. If that action was already saved, its receipt remains safe to replay; an unsaved stale action gets the latest room state.

A refresh or another device keeps the saved turn deadline while another player is present. When every remaining player disconnects, automatic progression pauses immediately; reconnect deadlines continue. If someone returns within their grace, the current turn and any required discard clocks restart with their full configured duration. The saved game retains its last committed choices, so a saved roll never needs rolling again. The server never fast-forwards turns to simulate elapsed downtime.

On server restart, previously connected seats get a new three-minute recovery grace from startup. Already disconnected seats keep their original deadlines, so restarting cannot extend them. Older saves using the former paused-grace behavior receive a one-time migration grace. This migration changes presence metadata only; even a long-running legacy game retains its turn count, board, resources and journal.

SQLite still needs a persistent volume and backups; this clock does not provide protection against losing the host's entire disk. Timer settings remain saved when a game pauses.

## Reconnect grace and resignation

In a started game, a disconnected player has **three minutes to return**, separately from the optional turn timer. The deadline appears beside their profile. Reconnecting before it expires restores their seat; it does not reset their ongoing turn clock. Intentional **Leave** immediately resigns the player and permanently releases their seat; it cannot be resumed. Closing a tab or losing connectivity uses the reconnect grace instead. Lobby players never auto-resign.

At expiry, the server resigns the absent player. Their roads, settlements and cities stay on the island and continue to occupy their sites. Their resource cards return to the bank; unused development cards are retired, not returned to the deck. Their buildings stop producing resources, they cannot trade or receive stolen cards, and they no longer qualify for either award. Future turns and setup slots skip them. With two or more remaining players the match continues; a sole connected survivor wins explicitly **by resignation**, without claiming a ten-point victory. An absent sole survivor has until their own deadline to return; absence never awards them a win. A player who returns after resignation may watch but cannot reclaim play in that match.

Required discards belonging to a resigned player disappear when their whole resource hand returns to the bank. Other players still finish their own discards. If the resigned player owed the robber move, the next remaining player moves it before rolling for their own fresh turn. Any unfinished free-road placements from the departed player are abandoned. Existing pieces are never removed to make these transitions possible.

If everyone disconnects, only automatic play pauses. Every player keeps their continuous three-minute absence deadline. Once every remaining player has expired, the game closes as **Abandoned**, with no winner. It stays visible in history with an end date and cannot resume, but does not count toward wins or games played. A returning player never renews anyone else’s deadline. A connected resigned spectator cannot keep a game progressing while all remaining players are offline. Multiple departures that expire together commit in one transaction; their iteration order cannot select a winner. Leaving an already finished game preserves its original result.

## Validation

`tests/turn-clock.test.ts` exercises accepted durations, host ownership, readiness resets, command reuse, exact revision conflicts, active and discarded-player deadlines, restart recovery, action/receipt rollback, automatic seven/robber/free-road transitions, manual deadline races, and live WebSocket broadcasts. `tests/disconnect-resignation.test.ts` adds real socket disconnects, reconnect cancellation, all-offline closure without autoplay, continuous deadlines across returns/restarts, one-time legacy migration, batch and manual resignation rollback/retry, permanent Leave, preserved pieces, conserved resources, and setup/discard/robber handling.
