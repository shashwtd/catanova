# Lobby settings and turn clock

The host can enable a turn timer before a game starts. The five slider stops are **40, 65, 90, 115, and 140 seconds**; enabling the slider initially selects 90 seconds. The timer is off by default. These are optional house rules layered over the unchanged base-game rules.

Only the host can change these settings. Every change is saved, broadcast to the room, and resets the other players' readiness. Ready messages sent against older settings are rejected, so a delayed message cannot consent to an unseen change. The host's **Start** button is their consent; the host does not need a separate Ready step. Every other player must be ready and every seat must be connected before starting. Settings lock when the game starts.

## What happens when time runs out

Setup settlements and roads are untimed. The first normal turn starts its countdown when setup finishes. Rolling, trading, buying, playing a development card, and reconnecting do not restart that countdown.

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

The server checks due clocks approximately every half second, in bounded batches, including rooms whose players are disconnected. It also checks the deadline before accepting a manual action, closing the race between a click at expiry and the next scheduler tick. If that action was already saved, its receipt remains safe to replay; an unsaved stale action gets the latest room state.

A refresh, another device, or a server restart keeps the saved deadline. After a long server outage, an expired current turn completes, then the next player receives a fresh full countdown. The server does not fast-forward many turns to simulate all elapsed downtime. If it crashes between required automatic choices, it resumes from the last committed choice without rerolling an already saved roll.

SQLite still needs a persistent volume and backups; this clock does not provide protection against losing the host's entire disk. An enabled timer remains enabled for the current game, including when all players disconnect.

## Validation

`tests/turn-clock.test.ts` exercises accepted durations, host ownership, readiness resets, command reuse, exact revision conflicts, active and discarded-player deadlines, restart recovery, action/receipt rollback, automatic seven/robber/free-road transitions, manual deadline races, and live WebSocket broadcasts. Resource inventories remain conserved during timeout choices.
