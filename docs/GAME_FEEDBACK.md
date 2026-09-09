# Game feedback and presentation

The client presents only accepted, player-filtered server snapshots. Rendering, sound and animation never choose a die result, change the rules, or hold up an acknowledgement. Durable game actions and the public move ledger remain the source of truth.

## Event flow

`Connection` rejects rollback or incomplete snapshots. `main.tsx` passes the installed snapshot into `useFeedback`, which compares it with the previous installed snapshot. Welcome/resume snapshots, duplicate revisions, hidden tabs and room changes update the hand immediately without replaying historic dice or rewards.

`deriveFeedback` uses piece IDs, actual hand differences, server dice and public counts to describe a finite effect. Exact known-player prefixes and canonical public action text disambiguate automatic rolls and trades. User-entered names cannot manufacture effects by containing words such as “played Knight”. Opponent hands remain filtered: outgoing public effects may show a card back and count, never a guessed resource type.

Two dice settle to the accepted result and pause so players can read the faces before production starts. The dice then move to a small dock above the turn control. Miniature resources fly from paying tiles to the local hand or receiving player profiles; each local resource count and card pulse update after its final arriving flight. Brief resource icons and +N receipts appear beside receiving profiles. Only known or public resource identities are shown; private transfers use a card back and total. Timing comes from the shared dice and feedback constants.

The actual game state already contains the new hand and determines legal actions. Local actions pause briefly while the dice result is being presented. The coordinator retains one pending snapshot range during an active presentation and combines rapid updates into that range; it does not build an unbounded effect queue. Every underlying action remains durably recorded and available in history. Tile glows, piece highlights and announcements are finite. Tab hiding cancels transient presentation and audio; returning shows the current hand without replaying background effects.

## Cards

Resource cards are compact colored cards with artwork and a count. They have no visible names or tooltips; accessible labels retain each resource's name and quantity. Nonempty cards can lift slightly on hover, while empty cards use muted colors, hatching and desaturated artwork without hover movement or sound.

Development cards sit inline beside the resource hand, with their purchase card at the end. Up to five illustrated stacks group identical cards and choose a playable copy first. Development-card tooltips retain the story, effect, total, playable and newly bought counts. Selecting a card opens a detail panel; a separate labeled Play button confirms it. Monopoly and Year of Plenty show resource choices in that panel. Newly bought cards explain the next-turn restriction; victory points explain that they already count.

One square control switches from Roll to End after rolling; Trade sits beside it. Player portraits carry the current-turn marker, optional countdown, score and awards. [GameIcons.tsx](../apps/client/src/GameIcons.tsx) supplies the original editable SVG interface icons. Portraits and selected controls use a thin rope-and-wood border texture.

## Sound

`SoundEngine` supplies original procedural foley and musical cues: wood/stone taps for construction, dice contacts, paper swishes for spending, short ascending notes for resources, distinct Knight/robber/development cues, and quiet UI/turn/award signals. There are no downloaded audio samples or external requests.

An AudioContext starts only after a trusted pointer or keyboard gesture. A cached noise buffer and scheduled oscillator layers feed a shared volume control. The engine limits concurrent sources, applies cue cooldowns, explicitly stops/disconnects nodes, and suspends after becoming idle. Muting or hiding the tab cancels active sound. A blocked audio context cannot block a game action. See [Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices), [autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay), and [AudioContext.suspend](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/suspend).

## Bounded rendering cost

The flat terrain draws on loading, resize, board changes or graphics-context recovery. Roads and buildings use SVG shapes with static shadows. Panning and zooming move the island and tabletop together; the camera's short zoom glide stops when it reaches its target. Dice, trails, receipts and transitions have fixed durations. [Board, dice and camera details](3D_NOTES.md).

Settings expose volume and the optional host-owned turn timer. A volume of zero mutes sound. The host can change the timer before the game starts; it then locks for the match. The operating system's reduced-motion setting selects quieter presentation without another settings toggle. [Timer rules and persistence](TURN_CLOCK.md).

Automated checks cover authoritative-effect derivation, hidden-information boundaries, duplicate/reconnect suppression, arrival timing, die landing geometry, piece persistence, camera limits and audio budgets. These are not a thermal benchmark or a substitute for listening and visual testing on phones, tablets and laptops. Asset decoding and CSS compositing still cost memory and GPU time; zero heat on every device is not a supportable promise.
