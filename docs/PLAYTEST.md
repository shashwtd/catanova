# First playable build

This is an early local playtest for **three or four people**. It is not a hosted production service. The same process serves the browser game and `/ws`; every accepted game action is saved before it is acknowledged.

## Open a table

Use Node 24 LTS or Node 26:

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:3000`. Choose **Create room**, then enter your name. Meet in the lobby, select a fantasy avatar, and share the invitation from the invite block or an empty seat’s plus icon. **Join room** is a separate form. An invite opens `/room/CODE`, shows that room’s roster, and asks the friend to join. A saved seat in another room never overrides the invitation. Everyone except the host marks **Ready**; the host starts once all three or four are connected and the other players are ready. The host can set the optional turn timer through Settings. A settings change asks the other players to ready up again. The board appears after Start. Turn order is randomized. Additional players cannot join a started match. Existing account owners can resume.

For a single-machine connectivity playtest, open the URL in four **independently opened tabs** and join the same room. Refreshing a tab resumes its own seat. Duplicating a tab may copy its session storage; that resumes the existing seat instead of creating a new player. A seat opened elsewhere closes the old connection.

`127.0.0.1` links only work on the server machine. For friends on other devices, use an HTTPS reverse proxy/tunnel to this process, or the eventual hosted deployment. Secure browser contexts are required for seat-token generation. An ordinary HTTP LAN address is insufficient. No public game server has been deployed yet.

## Playing

The board highlights legal starting corners and roads. After setup, roll dice, select a build type, and click a highlighted site. **Clicking a highlighted placement commits it immediately**; there is no undo. Resource production and card counts animate only after the server accepts state. Discards, robber victims, bank/port exchanges, and public trade offers have their own controls.

A trade offer states what the active player gives and wants. Any opponent with the requested cards can accept it, completing that exchange immediately. The active player's next non-offer action withdraws an open offer. There are no counteroffer messages or in-game chat yet; voice chat outside the game works well for negotiation.

The bottom shelf holds compact resource cards, identified by color, artwork and count, with accessible resource names and no hand-card tooltips. The illustrated development hand stays beside them, ending in a purchase card. Identical development cards share a stack, with a playable copy chosen first. Select a card, review its effect, and press its labeled Play button. Development-card hover, focus or touch details explain the story and rules; held cards explain why they cannot be played yet.

One square button switches from **Roll** to **End** after rolling, with **Trade** beside it. Player portraits on the right carry scores, resource/development-card counts, disconnected symbols, awards and the current-turn marker with an optional countdown. Game and construction tools sit at top left; settings and leave sit at bottom left during play; profile and invite controls remain in the lobby. Scroll or pinch to zoom within 85–220%, or drag to pan the flat island and wood table together. With the board focused, `+` and `-` zoom and `0` resets the view. There is no Fit button.

Cards bought this turn wait until a later turn, except Victory Point cards, which count automatically. Longest Road, Largest Army, and own-turn victory are computed by the server. A finished table remains saved; create a new room for another game.

## Effects and controls

Dice tumble to the saved server result, pause for reading, then move to the dock above the turn control. Resource-producing tiles glow, miniature resources travel to the hand or player profiles, and local hand counts change on arrival. Receiving profiles briefly show resource icons and +N receipts; private transfers show only a card back and count. Spending sends miniatures toward the new piece. Local actions pause while the dice result is being presented. The server state remains authoritative and saving a move never waits for animation. Rapid snapshots are combined into a bounded pending presentation.

Roads, settlements and cities are bright SVG pieces on a flat painted island, surrounded by a rugged continuous sea band. A cloud curtain introduces a newly started game. Original editable SVG icons and thin rope-and-wood portrait/control borders frame the interface. Sound effects use synthesized material taps, paper swishes and short musical tones. Browsers require a click or keypress before audio; muted settings and hidden tabs stop it. Settings contain the saved local volume and the host's optional turn timer. A volume of zero mutes sound. System reduced motion selects quieter effects automatically. Empty resource cards are muted and have no hover lift or sound.

[Implementation and performance limits](GAME_FEEDBACK.md). Audio balance, browser rendering, touchscreen handling and longer multiplayer sessions still require human device testing.

## Recovery behavior

Seat credentials and an unresolved command are stored privately in this tab's session storage **before transmission**. Refreshing the page retries the same command ID and payload. SQLite saves the board, exact dice result, hidden deck/hands, current phase, full private event, public history and command receipt together. The client clears its pending move only after receiving the corresponding committed snapshot. Stale or incomplete snapshots cannot erase permanent pieces from the last valid displayed board; new moves pause while the server state is checked. Reconnection returns a player-specific snapshot; another player's hand or future deck is never sent to you.

The last seat is also saved in local storage for the explicit **Resume game** button. The unresolved command is tab-scoped: closing a tab or clearing browser storage can lose that pending intent. Inspect the recovered state before manually repeating an uncertain action. Clearing storage loses local playtest credentials. With Google configured, signing into the same account and opening the invite recovers its seat on another device. [Configure authentication](AUTH.md).

The door icon leaves the room. Leaving before a game starts frees the seat and transfers hosting to the next remaining player. Leaving an active game keeps the seat and game saved for resumption. A network disconnection only changes presence and does not free a seat.

With the timer off (the default), the game waits for its player. If the host enabled the optional 40/65/90/115/140-second timer, expiry completes only mandatory actions and ends the turn with legal defaults. Discards have their own countdowns; the active turn pauses while they are pending. Deadlines survive reconnects and server restarts. There are no forfeits or optional purchases by a bot. [Full timer behavior](TURN_CLOCK.md). Process restart is covered; disk loss and cloud failover are separate work.

## Current scope and known differences

- Resources: **Timber, Clay, Sheep, Hay, Rock**.
- A named [balanced island preset](MAP_GENERATION.md) is the default. Classic spiral and fixed beginner boards are documented but not selectable in the app yet.
- The server randomizes seat order instead of showing ceremonial starting-player dice rolls.
- Two rare card situations use visible provisional decisions: Road Building requires a legal first road and uses the second whenever possible; Year of Plenty takes the bank's remaining card if only one exists and cannot be played into an empty bank. These await primary-source confirmation; see the [ledger](RULE_SOURCES.md).
- The history tab records every newly accepted game action, including setup placements, rolls, builds and trades, and loads older pages on request. A game created before the ledger was added only retains its surviving old journal entries plus new events. The public journal records trades, builds and played cards. It omits the stolen resource type and discarded resource mix. Exact bank counts are available to the client for resource selection, so bank changes can reveal discarded resources; this is an explicit current information-policy difference to review during conformance testing. Opponent hands and deck order are never sent.
- Three/four-player ordinary play is implemented. Expansions, two-player rules, bots, matchmaking, rematch controls, chat and spectating are not implemented. Supabase Google authentication is integrated but needs project/provider configuration; public guests are proposed and remain disabled.
- The interface includes responsive layout, keyboard-accessible board targets, a native modal for rules, and reduced-motion support. Device/browser visual QA and full human games are still needed.

## Development

`npm run dev` builds the client and watches server sources. For client hot reload, keep that process running and run `npm run dev:client` separately, then open `http://127.0.0.1:5173`. Its proxy forwards WebSockets and API requests to the game server. Use `.env.example`'s origins if a reverse proxy changes the browser origin.

`npm run check` runs TypeScript, rules/property scenarios, four-client gameplay/restart tests, abrupt process crash and socket recovery tests, and the production build. `npm run probe` remains a small transport smoke test, using separate counter-only rooms. It cannot increment a started game.

Each port has two wooden entrances, corresponding to the two coastal settlement corners that receive its benefit. The four **? 3:1** harbors trade three of any one resource for one other resource; the five **2:1** harbors each specialize in a resource. Question marks mean general trade, not unknown future rewards.
