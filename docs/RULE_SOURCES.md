# Rule sources and compatibility ledger

Reviewed 9 September 2026. Ruleset target: **ordinary three- and four-player English sixth-edition base game**, with applicable base-game clarifications. User-facing resource labels are wood, brick, sheep, wheat, and ore. Familiar names Longest Road and Year of Plenty correspond to the sixth edition's Longest Route and Invention.

## Primary references

| ID | Reference | Use |
| --- | --- | --- |
| R6 | [CATAN: The Game, English sixth edition, 2025](https://www.catan.com/sites/default/files/2025-03/CN3081%20CATAN%E2%80%93The%20Game%20Rulebook%20secure%20%281%29.pdf) | Main mechanics, supply, setup, action phase, card effects |
| FAQ | [Official base-game FAQ](https://www.catan.com/faq/basegame) | Ordinary base-game edge cases; filter out expansion and legacy entries |
| R5 | [Archived English base rules and almanac, 2020](https://www.catan.com/sites/default/files/2021-06/catan_base_rules_2020_200707.pdf) | Supplemental explanations of unchanged mechanics and familiar terminology |
| WC25 | [World Championship tournament rules, 2025](https://www.catan.com/sites/default/files/2025-04/CATAN%20CWC%202025_Tournament%20Rules.pdf) | Cross-check information visibility and action timing; not adopted wholesale |
| INDEX | [Publisher's rules index](https://www.catan.com/understand-catan/game-rules) | Edition provenance and separation of expansions |

Reference PDFs were read outside the repository. No official artwork, explanatory examples, or rulebook passages are included. The rulebook explains mechanics independently; the setup table records configuration facts.

## Coverage

“Documented” means the behavior appears in our rulebook. It does **not** mean the engine implements it. The only implemented game material is the constants module; the tested server action is an unrelated connectivity counter.

| ID | Behavior | Rulebook section | Basis | Status |
| --- | --- | --- | --- | --- |
| B01 | Three/four players; 10-point goal | 1–3 | R6 pp. 2–5, 10–12 | Documented |
| B02 | Supply, terrain, token and deck quantities | 2 | R6 p. 3 | Documented; constants started |
| B03 | Familiar resource-name mapping | 2 | R6 p. 3; R5 | Documented |
| B04 | Fixed beginner setup, omit fourth color for three | 3.4; SETUP.md | R6 pp. 4–5 | Documented; rendered implementation fixture pending |
| B05 | Shuffled coastal frame and terrain | 3.2 | R6 p. 11 | Documented |
| B06 | A–R counterclockwise spiral; skip desert | 3.2 | R6 p. 11; R5 variable setup | Documented |
| B07 | Highest dice total determines first player | 3 | R6 pp. 5, 12 | Documented; tie re-roll is an explicit implementation convention |
| B08 | Forward then reverse setup draft | 3.3 | R6 p. 12 | Documented |
| B09 | Setup distance rule and adjacent starting roads | 3.3 | R6 p. 12 | Documented |
| B10 | Second setup settlement need not connect | 3.3 | R6 p. 12; R5 starting phase | Documented |
| B11 | Second-settlement resources; no desert resource | 3.3 | R6 p. 12 | Documented |
| B12 | Setup ports and coastal placement allowed | 3.3, 8 | FAQ: Settlements and Cities | Documented |
| B13 | Clockwise turns; production then action | 4 | R6 p. 6 | Documented |
| B14 | Development card before roll; same allowance | 4, 9 | R6 pp. 6, 9; FAQ: Development Cards | Documented |
| B15 | Complete roll before ordinary actions | 4, 6 | R6 p. 6; WC25 3.0.2 | Documented |
| B16 | Trade/build interleave freely | 4 | R6 p. 7; WC25 3.0.6 | Documented |
| B17 | All players produce; settlement one, city two | 5 | R6 p. 6 | Documented |
| B18 | Multiple producing hexes/buildings accumulate | 5 | R6 p. 6 | Documented |
| B19 | Robber blocks one hex, not a resource type | 5–6 | R6 p. 6; FAQ: Trade | Documented |
| B20 | Production cannot be declined | 5 | FAQ: Resource Cards | Documented |
| B21 | Bank shortage: nobody, or sole claimant takes remainder | 5 | R6 p. 6; FAQ: Resource Cards | Documented |
| B22 | No ordinary maximum resource hand | 5–6 | R6 p. 6; R5 resources | Documented |
| B23 | Seven produces nothing | 6 | R6 p. 6 | Documented |
| B24 | Over seven: discard floor(hand/2) once | 6.1 | R6 p. 6; FAQ: Seven and Robber | Documented |
| B25 | Development cards excluded from discards | 6.1, 9 | R6 p. 9 | Documented |
| B26 | No trading before resolving seven; all discard first | 6.1 | FAQ: Seven and Robber; R6 p. 6 | Documented |
| B27 | Robber must move to a different land hex, including desert | 6.2 | R6 p. 6; FAQ: Seven and Robber | Documented |
| B28 | One chosen adjacent opponent; one random resource | 6.2 | R6 p. 6; R5 robber | Documented |
| B29 | Zero-card victim and unoccupied destination allowed | 6.2 | FAQ: Seven and Robber | Documented |
| B30 | No voluntary victim-selected substitute | 6.2 | FAQ: Seven and Robber | Documented |
| B31 | Robber does not block building or ports | 6.2 | FAQ: Robber | Documented |
| B32 | Knight does not cause discards | 6.2, 9 | FAQ: Development Cards / Knight | Documented |
| B33 | Rolled seven and Knight can both move robber | 6.2 | FAQ: Seven and Robber | Documented |
| B34 | Every player trade includes active player | 7.1 | R6 p. 7 | Documented |
| B35 | Negotiated ratios, counteroffers, and refusal | 7.1 | R6 p. 7 | Documented |
| B36 | No gifts, same-resource exchanges, or payment for services | 7.1 | R6 p. 7; FAQ: Trade | Documented |
| B37 | No credit, secret trades, or triangular inactive trades | 7.1 | FAQ: Trade | Documented |
| B38 | No trading buildings/development cards | 7.1, 9 | R6 pp. 7, 9 | Documented |
| B39 | Bank 4:1 matching resources for different type | 7.2 | R6 p. 7 | Documented |
| B40 | Ports 3:1 and matching 2:1 | 7.2 | R6 p. 7 | Documented |
| B41 | Own building on marked corner required; road insufficient | 7.2 | R6 p. 7; FAQ: Trade | Documented |
| B42 | Port usable immediately after building | 7.2 | R6 action phase; WC25 3.0.10 | Documented |
| B43 | Piece/card costs and unlimited affordable purchases | 8 | R6 pp. 8–9 | Documented; constants started |
| B44 | Empty road edge and own-network attachment | 8.1 | R6 p. 8 | Documented |
| B45 | Cannot build through opponent's building | 8.1 | R6 p. 8; FAQ: Roads | Documented |
| B46 | May extend an existing interrupted section | 8.1 | FAQ: Roads | Documented |
| B47 | No reservation or relocation of placed pieces | 8 | FAQ: Settlements and Cities | Documented |
| B48 | Settlement requires own road after setup | 8.2 | R6 p. 8; FAQ | Documented |
| B49 | Distance rule applies to every owner's buildings | 8.2 | R6 p. 8 | Documented |
| B50 | Settlements may occupy middle of own or opponent route if legal | 8.2, 10 | FAQ: Settlements and Cities / Longest Road | Documented |
| B51 | Personal piece limits, including settlement before city | 8 | R6 pp. 8–9; FAQ | Documented |
| B52 | City replaces own settlement and returns its piece | 8.3 | R6 p. 9 | Documented |
| B53 | City worth two total; no need to build all settlements | 8.3 | R6 p. 9; FAQ | Documented |
| B54 | Draw hidden top development card; never replenish deck | 8.4 | R6 p. 9 | Documented |
| B55 | One non-VP card per turn; not bought this turn | 9 | R6 p. 9 | Documented |
| B56 | Old copy still playable after buying another | 9 | Purchase-turn restriction; WC25 2.0.5 separation | Documented |
| B57 | Knight effect and persistent played count | 9, 11 | R6 p. 9 | Documented |
| B58 | Road Building costs no resources; legal sequential placements | 9 | R6 p. 9; R5 progress cards | Documented; exceptional partial effect needs ruling |
| B59 | Year of Plenty chooses two bank resources | 9 | R6 p. 9; R5 progress cards | Documented; extreme depletion needs ruling |
| B60 | Monopoly takes every matching opponent resource, not bank | 9 | R6 p. 9; FAQ: Monopoly | Documented |
| B61 | May negotiate/trade before Monopoly; no hand inspection | 7.1, 9 | FAQ: Monopoly | Documented |
| B62 | VP cards hidden, multiple reveal and same-turn win exceptions | 1, 9 | R6 pp. 9–10 | Documented |
| B63 | Longest Road minimum five; strict overtaking | 10 | R6 p. 8 | Documented |
| B64 | Loops, branches, no reused edges, own buildings allowed | 10 | R5 Longest Road; FAQ: Longest Road | Documented |
| B65 | Opponent building interrupts a route | 10 | R6 p. 8; FAQ | Documented |
| B66 | Award retention, transfer and loss after interruption/ties | 10 | FAQ: Longest Road | Documented |
| B67 | Largest Army minimum three played Knights, strict overtaking | 11 | R6 p. 9; FAQ | Documented |
| B68 | Resource count public; hand faces private | 12 | FAQ: Resource Cards | Documented |
| B69 | Held development count observable, identities hidden | 12 | WC25 2.0.2–2.0.3; R6 p. 9 | Documented |
| B70 | Public trade contents; no showing hand to deter robber | 7, 12 | FAQ: Trade / Seven and Robber | Documented |
| B71 | Bank counting only when checking possible production shortage | 12 | FAQ: Resource Cards | Documented |
| B72 | Immediate win on own turn; no roll if already won | 1 | R6 p. 10; FAQ: Victory Conditions | Documented |
| B73 | Forgotten valid win remains a win in ordinary base game | 1 | FAQ: Victory Conditions | Documented; tournament differs |
| B74 | No automatic grace period, free gifts, or special build phase | 13 | R6 scope; WC25 3.0.16 cross-check | Documented |

## Edition and interpretation decisions

1. **Sixth-edition action phase:** trading and building can interleave. Older separated trade/build instructions are not the default.
2. **Naming:** keep Longest Road and Year of Plenty because they are familiar English gameplay terms. They do not change the effects of Longest Route or Invention.
3. **Victory:** R6 and the ordinary FAQ end the game immediately when a player has enough points on their turn. WC25 3.0.15 treats a missed declaration differently. We follow the ordinary base game and will detect wins automatically; we do not import the tournament penalty.
4. **Talk:** the ordinary FAQ permits talking at any time. Some tournament restrictions on negotiation before resolving a roll are stricter. The standard rules retain ordinary table talk while preventing illegal transfers.
5. **FAQ filtering:** the base-game FAQ includes old 5–6-player special-building rules, ships, and physical-knight language. Those entries do not authorize moving a base-game road or adding a special building phase.
6. **Standard supply:** although a FAQ permits players to agree to extra cards, the standard preset uses the base box's 19 per resource. An enlarged bank is a labeled option.
7. **Starting-player ties:** re-roll the tied highest totals. R6 specifies the highest roll but does not elaborate the tie procedure; this is our explicit tie-resolution convention.
8. **Digital action commitment:** a placement preview is freely adjustable until confirmation. Confirmation is the digital commitment point. Tournament rules permitting physical repositioning within an unfinished action must not silently become an undo after a committed online action or revealed information.

## Remaining source questions before claiming exact conformance

The rulebook is a comprehensive base-game draft, not a claim that every conceivable corner has been independently adjudicated. The following must be resolved before implementing those cases or advertising certified 1:1 behavior:

- **Road Building partial/no-effect play:** ordinary sources specify two legal free roads and finite pieces. The conventional one-road result when only one piece remains is included, but we still need an explicit authoritative base-game ruling for voluntarily declining a possible second road, having no legal first road, and using the card with no pieces. Do not borrow a Cities & Knights progress-card ruling without verifying that it applies.
- **Year of Plenty with fewer than two cards in the entire bank:** the ordinary sources specify two available resources, but do not expressly settle a one-card or empty-bank effect. A common interpretation is to take the available remainder; mark it as an interpretation until confirmed.

No email has been sent to the publisher. A future clarification request needs the maintainer's authorization. A supplied official clarification or new edition should be linked here with its date and the resulting ruleset decision.

## Implementation conformance gate

Translate each applicable row into executable game-state scenarios as the rules engine is implemented. Add resource and piece conservation properties, legal setup fixtures, phase-transition tests, Longest Road graph fixtures, per-player information tests, replay determinism, and immediate-win scenarios. Until then, passing connectivity tests means only that the multiplayer foundation passes those tests.
