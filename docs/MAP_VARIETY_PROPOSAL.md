# More interesting openings without a rigid island

Proposal only. The current `balanced-v1` generator is unchanged by this UI update.

## What the current code checks

- Standard resource and number inventory; one desert.
- No connected resource cluster larger than two.
- At least two tiles of each resource separated by three hex steps.
- Total production pips for each resource between 2.5 and 4 per tile.
- No adjacent 6/8 numbers and no intersection above 11 production pips.
- Nine ports: four general 3:1 and one 2:1 for each resource, with spaced coastal ownership edges.

This bounds extremes, but it does not evaluate the snake-order opening draft. Resource spread alone does not guarantee good choices remain after the first settlements.

A reproducible sample of seeds 1–200 produced 17–26 intersections with at least eight pips (mean 22.325). That raw count looks healthy, but adjacent intersections compete with each other: selecting one blocks its neighbors. These numbers therefore are not evidence that every seat has a fair opening.

## Recommended next experiment

Keep the existing hard constraints and compare a small pool of valid maps using **opening choice diversity**. Count strong, mutually compatible settlement sites, then check a few plausible snake drafts for 2, 3 and 4 players. Prefer maps where later picks retain alternatives, without ranking one supposedly perfect map every time.

Judge starting pairs by several routes to a workable economy: production, different dice numbers, coverage of resources, and useful port access. Do not require each player to start with every resource. Trade and expansion should still matter, and a specialized coast/port opening should remain viable.

Allow an occasional connected three-tile resource cluster in an experimental preset, while keeping four-tile clusters forbidden. A productive pair can create an interesting strategy; a triple should not also receive all the best numbers. Avoid guaranteeing equal incomes, smoothing every interesting scarcity away, or adjusting the island to individual players.

Start with an offline comparison tool and a small human playtest set. Measure candidate-generation time and keep a strict candidate budget before adding any runtime selection. Do not add new nested rejection loops. Ship a versioned preset only after testing opening drafts and recording generation time; saved games keep their original board.
