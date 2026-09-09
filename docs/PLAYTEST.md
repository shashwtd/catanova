# First playable build

This is an early local playtest for **two to four invited people**. It is not a hosted production service. The same process serves the browser game and `/ws`; every accepted game action is saved before it is acknowledged.

## Open a table

Use Node 24 LTS or Node 26:

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:3000`. Choose **Create room**, then enter your name. Meet in the lobby, select a fantasy avatar, and share the invitation from the invite block or an empty seat’s plus icon. **Join room** is a separate form. An invite opens `/room/CODE`, shows that room’s roster, and asks the friend to join. A saved seat in another room never overrides the invitation. Everyone except the host marks **Ready**; the host starts once all two to four are connected and the other players are ready. The host can set the optional turn timer through Settings. A settings change asks the other players to ready up again. The board appears after Start. Turn order is randomized. Additional players cannot join a started match. Existing account owners can resume.

For a single-machine connectivity playtest, open the URL in two to four **independently opened tabs** and join the same room. Refreshing a tab resumes its own seat. Duplicating a tab may copy its session storage; that resumes the existing seat instead of creating a new player. A seat opened elsewhere closes the old connection.

`127.0.0.1` links only work on the server machine. For friends on other devices, use an HTTPS reverse proxy/tunnel to this process, or the eventual hosted deployment. The current client uses secure-context APIs such as `crypto.randomUUID()` for command IDs. An ordinary HTTP LAN address is not supported. No public game server has been deployed yet.

## Playing

The board exposes legal starting corners and roads. After setup, affordable legal sites show a piece preview on hover or keyboard focus; a build-tool choice filters the sites. Click a site to keep its preview, review its cost, then press **Build** to commit. Cancel or Escape dismisses the preview. Setup pieces and free roads also require confirmation. There is no undo after a confirmed move is accepted. Resource production and card counts animate only after the server accepts state.

During your action phase, open **Trade** and click resource cards to choose what you give and receive; the small minus control removes a selected card. Bank/port trades use the same resource artwork and show your applicable rate. A fixed player offer can be accepted by an opponent who can pay. Alternatively, choose **? Open to offers**: opponents use the incoming-offer notice to propose, change or withdraw a return, and the active player chooses which proposal to accept. Both sides must give at least one resource, with no resource type on both sides. Cards are not reserved during negotiation. The server rechecks both hands and the live offer before completing both transfers together. Updating or withdrawing an offer, or taking another action, invalidates its old replies. There is no in-game chat.

The bottom shelf holds compact resource cards with a single clean border, identified by color, artwork and count, with accessible resource names and no hand-card tooltips. The development hand stays beside them, ending in a separate plus-marked **Buy** slot with Sheep, Hay and Rock price icons. Identical development cards share a stack, with a playable copy chosen first. Select a card, review its effect, and press its labeled Play button. Development-card details explain the story and rules; held cards explain why they cannot be played yet.

The square development **Buy** tile matches **Trade** in size. **Trade** sits to the left of the larger square **Roll/End** control. Trade opens only during your action phase; Roll/End is available only on your turn. Opponents reply through incoming-offer notices. Player portraits carry assigned-color outlines, larger names, a light VP plaque, card counts, award badges and the current-turn marker with an optional countdown. A static red distressed overlay and centered Wi-Fi-off symbol identify disconnected players. Game and construction tools sit at top left; settings and leave sit at bottom left; profile and invite controls remain in the lobby. Scroll or pinch to zoom within 85–220%, or drag to pan the flat island and wood table together. With the board focused, `+` and `-` zoom and `0` resets the view. Fullscreen switches to an exit icon while active; there is no Fit button.

Cards bought this turn wait until a later turn, except Victory Point cards, which count automatically. Longest Road, Largest Army, and own-turn victory are computed by the server. A finished table remains saved; create a new room for another game.

## Effects and controls

Dice tumble to the saved server result, pause for reading, then move to the dock above the turn control. Resource-producing tiles glow, miniature resources travel to the hand or player profiles, and local hand counts change on arrival. Receiving profiles briefly show resource icons and +N receipts; private transfers show only a card back and count. Spending sends miniatures toward the new piece. Local actions pause while the dice result is being presented. The server state remains authoritative and saving a move never waits for animation. Rapid snapshots are combined into a bounded pending presentation.

Roads, settlements and cities use brighter coral, cyan, lilac and gold on the flat painted island. The continuous sea band follows the island and fades into the table at its outer edge; mirrored material repeats reduce texture seams. A cloud curtain introduces a newly started game. Buttons use original SVG icons and simple borders; the thin rope-and-wood frame is reserved for portraits. Cards have a uniform border and a small whole-card hover lift. Positive resource cards keep their hover sound with reduced motion; empty cards have neither hover movement nor sound. Browsers require a click or keypress before audio. Settings contain volume and the optional turn timer; zero volume and hidden tabs stop sound, while system reduced motion quiets spatial effects.

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
- Move history groups accepted actions by turn, using action/resource icons and an **Earlier turns** control without displaying revision numbers. A game created before the ledger was added only retains its surviving old journal entries plus new events. The public journal omits stolen resource identities and discarded mixes. Exact bank counts are available for resource selection, so bank changes can reveal discarded resources; this remains an information-policy difference to review. Opponent hands and deck order are never sent.
- Rooms accept two to four invited players. Three/four-player ordinary play is the base compatibility target. Two-player rooms use the same 19-hex board, bank, piece supply, costs, normal turns and ten-point goal, with snake setup **1–2–2–1**. This is a Catanova house option with no neutral players or official two-player variant mechanics; its balance needs full human playtests.
- No solo mode or public matchmaking is provided. Expansions, official two-player variants, bots, rematch controls, chat and spectating are not implemented.
- The interface includes responsive layout, keyboard-accessible board targets, a native modal for rules, and reduced-motion support. Device/browser visual QA and full human games are still needed.

## Development

`npm run dev` builds the client and watches server sources. For client hot reload, keep that process running and run `npm run dev:client` separately, then open `http://127.0.0.1:5173`. Its proxy forwards WebSockets and API requests to the game server. Use `.env.example`'s origins if a reverse proxy changes the browser origin.

`npm run check` runs TypeScript, rules/property scenarios, two- and four-client gameplay/restart tests, abrupt process crash and socket recovery tests, and the production build. `npm run probe` remains a small transport smoke test, using separate counter-only rooms. It cannot increment a started game.

Each port has two wooden entrances, corresponding to the two coastal settlement corners that receive its benefit. The four **? 3:1** harbors trade three of any one resource for one other resource; the five **2:1** harbors each specialize in a resource. Question marks mean general trade, not unknown future rewards.
