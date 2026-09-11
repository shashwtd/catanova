# Keeping the table involved

This pass addresses uncertainty and friction in the existing game: readable trade direction and confirmation, explicit declines, shared discard/robber progress, visible required placements, turn attention, meaningful award counts and celebrations, recorded foley, and optional instrumental music. These improve feedback without changing resource odds, scoring, or the base turn rules.

Better presentation alone will not establish that players enjoy a full match. A working hypothesis is that a well-presented table makes other players' turns interesting to follow: a roll has suspense, a payout has a readable result, and a new settlement visibly changes the island. This is a design hypothesis, not a verified explanation of why players enjoy Catan Universe.

## Engagement proposals to review

1. **Make each turn a shared little scene.** Build on the dice, payout and award feedback in this pass. Give a trade a clear card-exchange moment; let a newly built settlement briefly draw attention to its location; show the robber's departure, arrival and steal in a readable order. Let each result register before the next effect competes with it. Keep these moments brief and nonblocking: the server never waits for an animation, and returning to the tab shows the current state immediately. The aim is for spectators to follow what just changed without reading a log.

2. **Give the table a sense of place and tension.** Add restrained harbour ambience and a few variations of the instrumental music, with a short swell when an award changes hands or a public score nears victory. Silence matters too: duck the ambience for the roll and the local turn cue. Use public scores only, so the soundtrack cannot reveal hidden victory cards. Keep music optional, lazy-loaded, quiet by default when enabled, and stopped in background tabs. Avoid a soundtrack that becomes more frantic merely because a player is thinking.

3. **Let friends react at the table.** Offer a few expressive, optional reactions for a lucky roll, a close trade or a stolen award. Anchor them beside the sender's avatar, rate-limit them and provide a mute control. A brief end-of-match recap and rematch with the same group could then preserve that social momentum. Use real match facts such as the longest route reached and trades completed, without inventing extra rewards or revealing private cards during play.

For visual polish, use contrast deliberately: warm highlighted controls mean “you can act,” neutral surfaces mean information, and a single readable celebration marks a major achievement. Avoid perpetual glowing panels, competing banners, or a new reward for every click. Awards and a well-timed resource payout should be the highlights.

These are proposals, not additional features implemented in this release. Private planning helpers are out of scope; preserve the existing between-turn experience. Test the implemented feedback fixes with the same group first. Ask whether they could follow other players' turns, whether any wait was confusing, and which moments felt satisfying. Avoid artificial progression, daily chores, random comeback bonuses, or changing the rules merely to create more notifications.

## Validation scope

Automated checks exercise private trade direction, stale confirmations, persistent declines, required-action guidance, discard limits, award transfer/queue behavior, and audio lifecycle/resource cleanup. These checks do not substitute for listening in supported browsers or observing real players. Keep that distinction in release notes.
