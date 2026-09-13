# Dice and map review — September 2026

## Dice

Catanova's Natural setting samples each die independently using server-side cryptographic randomness. Balanced uses 36 ordered pairs without replacement, resets with 12 pairs left (after 24 rolls), and gives the previous total a weight of 7 rather than 10. The deck is stored with the match; reconnecting does not reshuffle it, and players never receive the remaining deck.

This matches the general algorithm described in [Colonist's design article](https://blog.colonist.io/designing-balanced-dice/). It is not a promise that every total appears in a game. Early reshuffling can omit the only 1+1 pair. Even natural dice have about a 24.4% chance of no 2 in 50 rolls: `(35 / 36)^50`.

Keep the current dice rules while collecting evidence. Menu → Statistics now shows recorded totals for the current match against the ordinary two-dice expectation, including zero-count totals. It reads committed roll events, not animations or the truncated client journal. Duplicate/replayed commands do not increment counts. The chart never includes the private remaining deck or forecasts the next result. Old matches without a complete event journal can only show the recorded rolls.

A guaranteed 36-roll deck would eliminate missing totals over a complete deck, but makes the end of each deck countable. That would be a different rules option, not a silent bug fix. No dice probabilities were changed in this update.

## The requested map generator

Inspected [catan.bunge.io](https://catan.bunge.io/) and its [public JavaScript](https://catan.bunge.io/index.min.js) on September 14, 2026. Its board generation executes in the browser. The generator code does not call a map-generation API; there is a separate site analytics script.

The script shuffles the standard resource/number inventories and retries until adjacency checks pass. Options include adjacent 6/8, 2/12, equal numbers, and equal resources. It does not score settlement sites or pairs of starting settlements; its `passedBalancedCheck` function returns `true`. Its rejection loop has no retry limit. Running that loop unchanged on our authoritative server could stall unrelated rooms under restrictive options.

There is also a [Darren Semotiuk fork](https://github.com/DarrenSem/catan) with an MIT license and performance improvements. That fork credits Jamison Bunge. We have not imported either implementation or any artwork; the deployed site's original-source license has not been established separately from the fork.

## Recommended direction

Retain our standard inventories, nine-port distribution, red-number separation, resource-production limits, deterministic seeds and bounded generation. Those already do more than the Bunge generator's basic adjacency checks.

The next useful fairness measure is the strength of **two legal starting settlements**, rather than a single attractive intersection. Score resource variety, expected production and port access; inspect how many good disjoint starting pairs remain after each draft pick. Reject only maps with an extreme outlier or too few viable starts. Do not promise each player all five resources: scarcity and trading are part of the game.

For variety, a future variant can permit an occasional connected cluster of three matching resources, keeping larger clusters forbidden and their total production capped. Compare it with the current two-tile cluster limit before making it the default. Nothing in this UI update changes map generation or silently relaxes its constraints.
