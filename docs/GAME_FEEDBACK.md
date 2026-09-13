# Game feedback and presentation

The client presents only accepted, player-filtered server snapshots. Rendering, sound and animation never choose a die result, change the rules, or hold up an acknowledgement. Durable game actions and the public move ledger remain the source of truth.

## Event flow

`Connection` rejects rollback or incomplete snapshots. `main.tsx` passes the installed snapshot into `useFeedback`, which compares it with the previous installed snapshot. Welcome/resume snapshots, duplicate revisions, hidden tabs and room changes update the hand immediately without replaying historic dice or rewards.

`deriveFeedback` uses piece IDs, actual hand differences, server dice and public counts to describe a finite effect. Exact known-player prefixes and canonical public action text disambiguate automatic rolls and trades. User-entered names cannot manufacture effects by containing words such as “played Knight”. Opponent hands remain filtered: outgoing public effects may show a card back and count, never a guessed resource type.

Two dice settle to the accepted result and pause so players can read the faces before production starts. The dice then move to a small dock above the turn control. Miniature resources fly from paying tiles to the local hand or receiving player profiles; each local resource count and card pulse update after its final arriving flight. Brief resource icons and +N receipts appear beside receiving profiles. Only known or public resource identities are shown; private transfers use a card back and total. Timing comes from the shared dice and feedback constants.

The actual game state already contains the new hand and determines legal actions. Local actions pause briefly while the dice result is being presented. The coordinator retains one pending snapshot range during an active presentation and combines rapid updates into that range; it does not build an unbounded effect queue. Every underlying action remains durably recorded and available in history. Tile glows, piece highlights and announcements are finite. Tab hiding cancels transient presentation and audio; returning shows the current hand without replaying background effects.

## Cards

The five resources appear as bright icon-and-number counters centered on the wooden shelf. They have no hover lift, tooltip or hover audio. Each count retains an accessible resource name and quantity; received resources briefly animate the changed number. Development cards remain illustrated cards.

Development cards sit inline beside the resource hand. A distinct plus/development **Buy** slot displays its Sheep, Hay and Rock price. Up to five illustrated stacks group identical cards and choose a playable copy first. Tooltips retain the story, effect and availability counts. Selecting a card opens a detail panel; a separate labeled Play button confirms it. Monopoly and Year of Plenty show resource choices there. Newly bought cards explain the next-turn restriction; victory points explain that they already count.

Trade sits to the left of Roll/Next, and these actions are enabled only in the local player's appropriate turn phase. Other players answer live offers through a separate notice. Player-colored portrait outlines match the board pieces. A light victory-point plaque sits beside each portrait, below a larger name; hand counts and the current action remain visible. Earned award medals sit at the upper right of the profile, outside its name row. Their tooltips show the longest continuous road and Knights-played standings; public progress is available without permanent extra counters on every profile. A queued, nonblocking celebration names a new award holder, their count, the minimum criterion, and any previous holder. Reconnects do not replay old celebrations. Disconnections add a static translucent red distressed overlay and Wi-Fi-off symbol, without flickering. [GameIcons.tsx](../apps/client/src/GameIcons.tsx) supplies original SVG controls, including a rulebook and separate fullscreen entry/exit symbols. Only portraits retain the thin rope-and-wood texture.

## Intent and history

Affordable legal build sites reveal a piece on hover or focus. Mandatory settlement/road placements and free roads show all legal destinations immediately; optional builds show persistent guides only after choosing an action. Clicking keeps a placement preview with its cost; **Build** submits it, while Cancel or Escape dismisses it. Setup and free-road placements use the same confirmation. A preview is checked again against the current room, turn, phase and legal sites before submission.

Trade and discard quantities use clickable resource cards with a minus control. Trade summaries consistently show **You give** and **You get** from the local player's perspective. Bank exchanges and the proposer’s final exchange require a review followed by confirmation. For a fixed offer, recipients choose **Yes, trade** or **No thanks**. Acceptance registers willingness without moving resources; the proposer chooses among the willing players. Acceptances stay committed until the offer ends, survive reconnect, and concurrent first replies to the same offer do not invalidate one another. An open **?** offer invites nonempty return proposals; the active player reviews one, and the server rechecks the reviewed proposal and both hands before transferring cards together. Nonactive players can decline an offer; declines persist through reconnect and close the offer when every other seated player declines. A new offer resets those responses. Neither path permits free gifts or stale acceptance. [Trading rules](RULEBOOK.md#7-trading).

During a seven, everyone sees the discard/move/steal sequence and the names and counts of players still discarding. Only obligated players get discard controls, with exact quota and hand validation. When moving the robber, the active player sees legal tiles, selects a destination, then confirms the victim or a move without a steal. Other players see who is moving it. These controls never expose opponents' private resources.

The browser title follows the authoritative phase, including another player's current action and local discard instructions. Only a local obligation to roll or move the robber temporarily changes the favicon. Required-action audio is deduplicated across presence updates and automatic reconnects; hidden tabs can play an already-unlocked attention cue without playing ordinary move effects.

[MoveHistory.tsx](../apps/client/src/MoveHistory.tsx) groups the durable public ledger by turn with action/resource icons and literal player names. Revision numbers remain internal pagination identifiers. Hidden resource and development-card identities are not added by the presentation.

## Sound

`SoundEngine` layers short CC0 recordings: dice tumble and wooden contacts timed to the visible bounces, three hammer taps for settlements, heavier wood/stone for cities, and paper/card handling for resources and trades. Pizzicato phrases distinguish your turn, awards and development cards. The 15 effects total 214,245 bytes and load from the app only after a user gesture. An immediate procedural fallback covers missing samples; completing a download never replays an old action. [Audio sources and preparation](audio/README.md).

An AudioContext starts only after a trusted pointer or keyboard gesture. Music is a separately controlled, opt-in lute/flute loop, downloaded only when enabled during a game. A native looping audio buffer avoids a continuous synthesis scheduler. Hiding the tab stops ordinary effects and pauses music; returning resumes the musical position. Only short, explicitly requested turn/action reminders may play in the background after audio has been unlocked. Muting effects preserves the separate music setting. The engine bounds concurrent sources, stops/disconnects nodes, suspends when idle, aborts downloads on hiding/teardown, and backs off failed downloads. Audio failure cannot block a game action. See [Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices) and [autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay).

## Bounded rendering cost

The flat terrain draws on loading, resize, board changes or graphics-context recovery. Roads and buildings use bright SVG shapes with light static shadows. A smoother coast-following sea boundary retains the island shape; mirrored UV repeats and atlas gutters reduce material seams. Panning and zooming move the island and tabletop together, and the short zoom glide stops at its target. Dice, trails, receipts and transitions have fixed durations. [Board, dice and camera details](3D_NOTES.md).

Settings expose separate effects and music volumes, plus the optional host-owned turn timer. Zero mutes the corresponding audio channel; music starts disabled. The host can change the timer before the game starts; it then locks for the match. The operating system's reduced-motion setting selects quieter presentation without another settings toggle. [Timer rules and persistence](TURN_CLOCK.md).

Automated checks cover authoritative-effect derivation, hidden-information boundaries, duplicate/reconnect suppression, arrival timing, die landing geometry, piece persistence, camera limits and audio budgets. These are not a thermal benchmark or a substitute for listening and visual testing on phones, tablets and laptops. Asset decoding and CSS compositing still cost memory and GPU time; zero heat on every device is not a supportable promise.

## Local presentation preview

At `/dev/lounge`, open **Preview → Game**. **Events & sounds** runs real presentation components for dice, development cards, awards and a win. The robber selector previews your discard, waiting for another player, or moving and stealing. **Two willing traders** and **Incoming trade** exercise both sides of trading locally. All scenarios use local sample state and never contact account or game APIs.

Player profiles always stay in turn order. A **#1** badge identifies the public point leader from three points onward; ties share the badge and private victory cards do not affect it. Award hover/focus/tap details list each player’s longest route or played Knight count. Development-card purchase payments fly to the purchase button.

### Dialog and interaction pass

Trading, incoming offers, help, settings and development-card confirmation share light parchment surfaces with dark ink. Trading uses the same side-by-side receive/pay component in editable and read-only states, separated by simple exchange arrows. Resource choices have colored card faces, prominent selected quantities and a corner minus control; player response ticks are vectors tinted to the player’s piece color. Once an offer is live, its editor is replaced by a row of players; selecting one and pressing Confirm completes the exchange. Accepted responses cannot be cancelled or repriced. No per-turn offer allowance is displayed or enforced.

Every playable development card opens its explanation and a Play confirmation. Build buttons remain available for touchscreens. Direct board placement first opens a compact confirmation beside that location; the popover follows camera movement. Selecting a build tool first makes the next legal placement explicit. City markers surround the existing settlement without covering it. Optional sites stay quiet until hovered; compulsory and selected modes show their legal sites.

Production animations and profile gain badges replace redundant resource-gain text announcements. Card-play and victory messages remain. The local preview resets transient effects without stopping or suspending the music, and memoizes its legal game view across feedback updates. Network diagnostics have been removed from the game menu; connection recovery and disconnected-player status remain active.

The guide opens one topic at a time while retaining build costs, scoring, awards, turn flow, robber rules and development-card timing. The separate Game rules menu entry is removed. Settings distinguish selection from hover and point back to the settings control. Roll uses amber accents; Next uses mint accents and a bent arrow, with restrained corner highlights instead of a rotating dashed border. Development artwork explicitly clips each atlas cell so neighboring illustrations cannot leak into differently sized previews.

## Trade and event polish

A live offer shows actual room avatars. Pending responses have a small spinner, declined responses a painted red cross, and accepted responses a player-colored check. Choosing a partner still requires a separate confirmation. Incoming offers name and show the maker; give/get summaries always use the viewer’s perspective. Muted or reduced-motion preferences stop decorative movement without hiding response status.

Held medals sit on the upper-right edge of each player panel, outside the name row. Announcements use the earned medal and a fading backdrop, with the holder, count and award requirement still readable. Public development plays use their own artwork and a short effect description; buying a hidden card does not reveal its face. A queued award takes visual priority over a card announcement to avoid stacking celebrations. Mobile uses smaller medals and places celebrations below the player rail.

Passing a committed local turn uses a short paper-and-wood cue. The separate “your turn” reminder uses a softer, lower pluck with a wood contact instead of the longer stinger. No extra audio files are downloaded.
