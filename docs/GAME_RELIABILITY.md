# Game reliability and rule options

## Dice audit

The production match inspected during this investigation recorded 573 rolls over 574 turns, including 540 automatic rolls. Its totals were:

| Total                       | 2    | 3    | 4    | 5    | 6    | 7    | 8    | 9    | 10   | 11   | 12   |
| --------------------------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| Observed                    | 19   | 31   | 52   | 69   | 62   | 107  | 89   | 48   | 47   | 33   | 16   |
| Expected with two fair dice | 15.9 | 31.8 | 47.8 | 63.7 | 79.6 | 95.5 | 79.6 | 63.7 | 47.8 | 31.8 | 15.9 |

These aggregate frequencies do not show an unusual deviation from two independent dice (chi-square 11.74, 10 degrees of freedom, approximate p-value 0.303). One match cannot establish overall fairness or independence; this check does not test the order of rolls. The high automatic-roll count exposed the abandoned-game lifecycle problem rather than evidence that low numbers were favored.

The server already used cryptographic random integers from Node, independently of the public board seed. Dice now use rejection sampling to avoid the tiny unequal bucket sizes when mapping a 32-bit draw to six faces. Neither mode consults recent rolls, player resources, scores or connection quality. Accepted results are persisted once; repeating a command returns its original receipt.

## Lobby dice modes

- **Natural (default, stored as `classic`):** two independent six-sided dice. Total 7 has a 6/36 chance; 2 and 12 each have a 1/36 chance. Old rooms and saves without a mode keep Classic behavior.
- **Balanced:** draw without replacement from the 36 ordered dice pairs. Before a roll, refresh to all 36 pairs if 12 or fewer remain. Each remaining pair has weight 10, except pairs matching the previous total have weight 7. Select with the same unbiased server random sampler, remove the pair, and remember its total. This reduces short-game swings and repeat streaks while retaining the familiar frequency curve. Individual rolls are dependent; it does not promise exact percentages or equal resources.

This is Catanova's implementation of the [published Colonist deck-and-repeat-weight design](https://blog.colonist.io/designing-balanced-dice/), not a claim of identical current behavior. There are no score, seat, resource, catch-up, or player-specific adjustments (including for sevens). Natural remains the default.

The host chooses before starting; the choice is persisted and locked during play. The remaining balanced deck and previous total are stored with the authoritative game snapshot and omitted from every client projection. Duplicate commands replay their receipt without drawing again. Refreshing the page, reconnecting, and restarting the server cannot reset the deck.

Flat odds are no longer accepted in new settings. Saved, unstarted flat lobbies open with Natural. Already-started legacy flat matches retain their original rule until finished; changing odds midway through a live game would be unfair. The compatibility branch is not selectable for new games.

Probability dots describe the standard two-dice distribution: 2/12 have one combination each, 3/11 two, 4/10 three, 5/9 four, 6/8 five; seven has six. Divide by 36 for the Natural probability. These markers do not modify rolls; Balanced uses this frequency curve as its starting deck, not fixed per-roll odds. The map generator is unchanged.

### Waiting-room player removal

The host opens a player's info menu and confirms removal. The server verifies the host, exact room revision, target membership, and that the game has not started. Removal and its intent-bound receipt commit atomically; a retry cannot remove a second player. The departing seat becomes unusable, its socket receives a terminal notice, and remaining players receive the updated roster. This removes a seat, not a permanent account ban.

## Five trade offers per turn

Catanova limits the active player to **five new player-trade offers per turn**. This is a house rule, not a base CATAN limit. New offers, replacement prices and open requests all count. Cancelling does not restore an offer. Invalid actions and repeated delivery of the same accepted command do not consume another offer.

Replies, declines, accepting an offer or proposal, withdrawing a proposal, and bank or harbor trades do not consume this allowance. The fifth offer can still finish normally. The allowance resets when the next player begins their turn. The client locks pending submissions immediately, but the authoritative limit and receipt handling are on the server.

The [official CATAN rulebook](https://www.catan.com/sites/default/files/2021-06/catan_base_rules_2020_200707.pdf), pages 4 and 14, permits repeated trading during the active player's trading phase while the player has resources; it does not impose a five-offer cap.

## Harbor audit

The board has nine harbors: four generic 3:1 harbors and one 2:1 harbor for each of the five resources. A settlement or city on either of that harbor's two coastal intersections grants its rate. A road alone does not. A specific 2:1 harbor discounts the resource being given; a generic 3:1 trade gives three identical resources. This matches the harbor and maritime-trade explanations in the [official rulebook](https://www.catan.com/sites/default/files/2021-06/catan_base_rules_2020_200707.pdf), pages 8–9.

No harbor count, access or spacing change was needed. Existing placement rotates nine spaced coastal edges around the 30-edge shoreline; no two harbors share an access vertex. A 100-seed regression checks inventory, coastal placement, eighteen distinct endpoints, both settlement/city access points and road-only rejection. It checks rules and topology, not visual overlap on every display size.

## Fair-map proposals — not implemented

The current `balanced-v1` generator keeps same-resource clusters at two tiles or fewer, spreads each resource across the island, separates 6/8 tiles, bounds total Classic production by resource, and caps an intersection at 11 production pips. It preserves the normal terrain and number-token inventories. None of these rules changed in this update.

Two small changes are worth discussing before changing the preset:

1. **Judge starting positions as pairs.** Evaluate a player's two legal starting intersections together, considering production and resource variety, rather than assuming one individually strong intersection makes a fair start. Keep multiple plausible choices through the snake-order draft; do not promise every player every resource.
2. **Allow an occasional three-tile resource cluster.** A rare maximum-three cluster could make islands feel less constrained while retaining spread checks and rejecting extreme production concentrations. Compare sample boards before adopting it; do not silently relax the current preset.

These are proposals only. A new generator or a mode-specific fairness preset needs an explicit decision and its own comparison tests.

## Disconnects and deliberate Leave

A lost connection gets three continuous minutes to return. Each deadline is persisted and continues while everybody is away and across server restarts. If nobody remains connected, turn autoplay stops immediately. Expiration still runs, and a fully abandoned game finishes without creating a winner. A legacy paused save receives one migration grace period; its historical moves and pieces are preserved.

The explicit **Leave game** command permanently resigns that seat. Its receipt, resignation, journal entry and seat release commit together. A disconnected browser must reconnect to confirm Leave; closing a tab remains a disconnect with the grace period. Finished-game departures preserve the result. See [turn clock behavior](TURN_CLOCK.md).

## Start loading and performance

Current clients warm the seven essential game atlases and fonts in the room. Images share a decoded cache with the terrain renderer, with three concurrent requests per warmup and retryable failures. The game art remains 2,942,320 bytes at its existing resolution and quality; no new raster art was added. The two new hub/room SVG textures total 1,954 bytes. Music continues to stream independently rather than becoming a start prerequisite.

Start broadcasts a preparation screen with the roster. The authoritative game is created only after every player reports ready and at least two seconds have elapsed. Ten seconds is the server limit; a failed load or a room/connection change cancels preparation and returns players to the room. Cancelled command IDs are retained briefly so delayed retries do not reopen a cancelled launch. A new attempt uses a new command ID. Clients also bound the visual curtain so an offline browser cannot be trapped behind it.

A mix of older and current browser clients must refresh before using coordinated loading. The first turn is not running during preparation. Readiness and the cloud effect do not bypass server validation or acknowledge a game before its database transaction commits.

This update removes unattended gameplay work, duplicate terrain decoding and large landing-art requests from the signed-in hub and room. It retains compressed static delivery, immutable art URLs, on-demand terrain rendering, bounded device pixel ratio, and paged move history. These are concrete improvements, not a claim that every device/network can guarantee a fixed FPS or a ten-second download.

## Routes, invitations and verification

Authenticated players land at `/play`; `/` remains the public homepage. The room address bar uses `/room/AB2C`, and copied address-bar URLs open an admission preview for that room. Within a browser, history binds this short address to the permanent room identity. Joining uses the identity returned by the preview, preventing a reassigned code from silently changing the target between preview and join. Dedicated copy/share controls retain durable links. Four-character aliases are finite and reusable; old code-only links cannot be permanent identifiers.

Empty room slots open a friend invitation drawer with room sharing underneath. Invitations require a confirmed friendship between non-guest accounts, expire after five minutes, and are protected by account/IP rate limits, duplicate suppression and sender/recipient caps. Private routes and account endpoints are not indexed.

Guest verification uses Cloudflare Turnstile's explicit script `onload` callback, registered before injection, instead of calling `ready()` on a partly loaded async API. Failed loads can be retried; abandoned widget callbacks cannot sign in later. Cloudflare is allowed in the CAPTCHA-specific script/frame/connection policy. Google login remains separate from guest CAPTCHA. See [Cloudflare's rendering documentation](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/).
