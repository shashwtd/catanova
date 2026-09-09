# Game feedback and presentation

The client presents only accepted, player-filtered server snapshots. Rendering, sound and animation never choose a die result, change the rules, or hold up an acknowledgement. Durable game actions and the public move ledger remain the source of truth.

## Event flow

`Connection` rejects rollback or incomplete snapshots. `main.tsx` passes the installed snapshot into `useFeedback`, which compares it with the previous installed snapshot. Welcome/resume snapshots, duplicate revisions, hidden tabs and room changes update the hand immediately without replaying historic dice or rewards.

`deriveFeedback` uses piece IDs, actual hand differences, server dice and public counts to describe a finite effect. Exact known-player prefixes and canonical public action text disambiguate automatic rolls and trades. User-entered names cannot manufacture effects by containing words such as “played Knight”. Opponent hands remain filtered: outgoing public effects may show a card back and count, never a guessed resource type.

Two dice roll for 1,120 ms before production starts. Each miniature resource flies for 700 ms, with at most 110 ms total stagger; its resource count and card pulse update after that resource's last arriving flight. The actual game state already contains the new hand and controls all legal actions. Tile glows, piece highlights and HUD announcements are finite and disappear after the event.

The coordinator coalesces rapid revisions to the latest state rather than building an unbounded queue. A fast subsequent action can end an earlier visual effect. Every underlying action remains durably recorded and available in history. Tab hiding cancels transient presentation and audio; returning shows the current hand. No accumulated background effects play on return.

## Cards

Resource cards show a short name/use tooltip on hover or keyboard focus, and can reveal it by touch. Empty cards use muted paper, hatching and desaturated ink; their hover tilt and sound are disabled. Tooltips render outside scrolling panels and clamp to the viewport.

Development cards share up to five illustrated stacks. Each stack chooses a playable copy first and shows the total, playable and newly bought counts in its tooltip. A card selection explains the effect; a separate labeled Play button confirms it. Monopoly and Year of Plenty show resource choices in that same panel. Newly bought cards explain the next-turn restriction; victory points explain that they already count. No drag gesture or hidden plus action is required.

## Sound

`SoundEngine` supplies original procedural foley and musical cues: wood/stone taps for construction, dice contacts, paper swishes for spending, short ascending notes for resources, distinct Knight/robber/development cues, and quiet UI/turn/award signals. There are no downloaded audio samples or external requests.

An AudioContext starts only after a trusted pointer or keyboard gesture. A cached noise buffer and scheduled oscillator layers feed a shared volume control. The engine limits concurrent sources, applies cue cooldowns, explicitly stops/disconnects nodes, and suspends after becoming idle. Muting or hiding the tab cancels active sound. A blocked audio context cannot block a game action. See [Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices), [autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay), and [AudioContext.suspend](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/suspend).

## Bounded rendering cost

The terrain draws only on loading, resize or graphics-context recovery. Pieces use small CSS meshes and static shadows; no 3D engine, physics loop, animated lights or model downloads are added. Dice, trails and transitions have fixed durations. CSS 3D is preserved through the camera hierarchy, and construction glow targets individual faces. [Geometry, dice and camera details](3D_NOTES.md).

Preferences independently control sound, volume, visual effects, 3D, board tilt and announcements. The operating system's reduced-motion setting disables spatial motion even when the local toggle is enabled. Static 3D can remain visible, and the user can select the flat fallback.

Automated checks cover authoritative-effect derivation, hidden-information boundaries, duplicate/reconnect suppression, arrival timing, die landing geometry, piece persistence, camera limits and audio budgets. These are not a thermal benchmark or a substitute for listening and visual testing on phones, tablets and laptops. Asset decoding and CSS compositing still cost memory and GPU time; zero heat on every device is not a supportable promise.
