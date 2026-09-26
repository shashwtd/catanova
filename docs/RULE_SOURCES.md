# Rule sources and compatibility ledger

Reviewed 9 September 2026. Ruleset target: **ordinary three- and four-player English sixth-edition base game**, with applicable base-game clarifications. User-facing resource labels are Timber, Clay, Sheep, Hay, and Rock; their stable storage IDs are wood, brick, sheep, wheat, and ore. Familiar names Longest Road and Year of Plenty correspond to the sixth edition's Longest Route and Invention.

The two planned modes, Big Table (`big-table-v1`) and Open Sea (`open-sea-v1`), have their own part at the end: [Big Table and Open Sea](#big-table-and-open-sea). Everything before that part concerns Classic (`base-3-4-v1`).

## Primary references

| ID | Reference | Use |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| R6 | [CATAN: The Game, English sixth edition, 2025](https://www.catan.com/sites/default/files/2025-03/CN3081%20CATAN%E2%80%93The%20Game%20Rulebook%20secure%20%281%29.pdf) | Main mechanics, supply, setup, action phase, card effects |
| FAQ | [Official base-game FAQ](https://www.catan.com/faq/basegame) | Ordinary base-game edge cases; filter out expansion and legacy entries |
| R5 | [Archived English base rules and almanac, 2020](https://www.catan.com/sites/default/files/2021-06/catan_base_rules_2020_200707.pdf) | Supplemental explanations of unchanged mechanics and familiar terminology |
| WC25 | [World Championship tournament rules, 2025](https://www.catan.com/sites/default/files/2025-04/CATAN%20CWC%202025_Tournament%20Rules.pdf) | Cross-check information visibility and action timing; not adopted wholesale |
| INDEX | [Publisher's rules index](https://www.catan.com/understand-catan/game-rules) | Edition provenance and separation of expansions |

Reference PDFs were read outside the repository. No official artwork, explanatory examples, or rulebook passages are included. The rulebook explains mechanics independently; the setup table records configuration facts.

## Coverage

“Documented” means the behavior appears in our rulebook. It does **not** mean the engine implements it. An early engine now implements ordinary turns, setup, production, robber/discards, trades, construction, development cards and scoring. The table remains a source-coverage ledger, not a per-row certification. See [playtest scope](PLAYTEST.md) and the executable tests in `tests/game.test.ts`, `tests/board.test.ts` and `tests/multiplayer-game.test.ts`.

| ID | Behavior | Rulebook section | Basis | Status |
| --- | --------------------------------------------------------------- | ---------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
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

Catanova also permits two invited players using these same base mechanics. That additional player-count option is a project choice, not a claim of official two-player conformance. It adds no neutral players or other two-player-specific mechanisms; [the rulebook](RULEBOOK.md) describes its scope.

## Edition and interpretation decisions

1. **Sixth-edition action phase:** trading and building can interleave. Older separated trade/build instructions are not the default.
2. **Naming:** keep Longest Road and Year of Plenty because they are familiar English gameplay terms. They do not change the effects of Longest Route or Invention.
3. **Victory:** R6 and the ordinary FAQ end the game immediately when a player has enough points on their turn. WC25 3.0.15 treats a missed declaration differently. We follow the ordinary base game and will detect wins automatically; we do not import the tournament penalty.
4. **Talk:** the ordinary FAQ permits talking at any time. Some tournament restrictions on negotiation before resolving a roll are stricter. The standard rules retain ordinary table talk while preventing illegal transfers.
5. **FAQ filtering:** the base-game FAQ includes old 5–6-player special-building rules, ships, and physical-knight language. Those entries do not authorize moving a base-game road or adding a special building phase.
6. **Standard supply:** although a FAQ permits players to agree to extra cards, the standard preset uses the base box's 19 per resource. An enlarged bank is a labeled option.
7. **Starting-player ties:** re-roll the tied highest totals. R6 specifies the highest roll but does not elaborate the tie procedure; this is our explicit tie-resolution convention.
8. **Digital action commitment:** a placement preview is freely adjustable until confirmation. The UI keeps a temporary piece after a site is clicked and commits only when the player confirms Build; selecting a build type or a site is only a preview. Tournament rules permitting physical repositioning within an unfinished action must not silently become an undo after a committed online action or revealed information.

## Remaining source questions before claiming exact conformance

The rulebook is a comprehensive base-game draft, not a claim that every conceivable corner has been independently adjudicated. The following need authoritative confirmation before advertising certified 1:1 behavior. The playtest has explicit provisional decisions so games can progress:

- **Road Building partial/no-effect play:** ordinary sources specify two legal free roads and finite pieces. The conventional one-road result when only one piece remains is included, but we still need an explicit authoritative base-game ruling for voluntarily declining a possible second road, having no legal first road, and using the card with no pieces. The playtest requires a legal first road and uses a second whenever possible; if no piece or legal site remains after the first, it finishes with one. Zero-road play and voluntarily declining an available road are not allowed provisionally. Do not borrow a Cities & Knights progress-card ruling without verifying that it applies.
- **Year of Plenty with fewer than two cards in the entire bank:** the ordinary sources specify two available resources, but do not expressly settle a one-card or empty-bank effect. The playtest takes the remaining card when there is exactly one and rejects play into an empty bank. This is an interpretation until confirmed.

No email has been sent to the publisher. A future clarification request needs the maintainer's authorization. A supplied official clarification or new edition should be linked here with its date and the resulting ruleset decision.

## Implementation conformance gate

Translate each applicable row into executable game-state scenarios as the rules engine is implemented. Add resource and piece conservation properties, legal setup fixtures, phase-transition tests, Longest Road graph fixtures, per-player information tests, replay determinism, and immediate-win scenarios. Current tests include these core categories, but the ledger has not yet been certified row by row. Fixed/spiral presets and complete human playtests remain outstanding.

## Big Table and Open Sea

Reviewed 26 September 2026. This part covers two planned rulesets: `big-table-v1`, Big Table, for five and six players, described in the [Big Table rulebook](RULEBOOK-BIG-TABLE.md); and `open-sea-v1`, Open Sea, described in the [Open Sea rulebook](RULEBOOK-OPEN-SEA.md). Both books are companions to the Classic rulebook. Every Classic rule, and every row B01–B74 above, applies to them unless a row below changes it.

Both modes' rules are implemented in the engine, though neither mode is yet offered to players. "Documented" means the behaviour appears in the mode's rulebook, as for Classic. "Catanova decision" marks a rule we chose where the official texts are silent or disagree, or where we knowingly depart from them; each points to an entry in the decision lists below. Section numbers refer to the mode's own rulebook. Mode, role and scenario names are Catanova's own; official product names appear only to identify the references.

### Primary references for the modes

| ID | Reference | Use |
| --- | --- | --- |
| R6-56 | [5–6 player expansion to the base game, English 2025 (CN3082)](https://www.catan.com/sites/default/files/2025-03/CN3082%20CATAN%20%E2%80%93%205-6%20Rulebook%202025%20reduced.pdf) | Big Table reference edition: components, supply, 30-hex island, setup, paired turns |
| S6 | [Seafarers expansion, English 2025 (CN3083)](https://www.catan.com/sites/default/files/2025-03/CN3083%20CATAN%E2%80%93Seafarers%20Rulebook%202025%20secured%20reduced.pdf) | Open Sea reference edition: ships, ship moves, gold fields, pirate, Longest Route, setup, the first scenario's values |
| S6-56 | [Seafarers 5–6 player expansion, English 2025 (CN3084)](https://www.catan.com/sites/default/files/2025-03/CN3084%20CATAN%20%E2%80%93%20Seafarers_%205-6%20Player_%20Rulebook.pdf) | Outline of a later Open Sea for five and six players; not used by `open-sea-v1` |
| PR21 | [Paired-players rule for 5–6 player games, English, 2021](https://www.catan.com/sites/default/files/2021-09/CATAN_New5-6Player_ruleEN.pdf) | The rule that replaced the special building phase: both players on turn, tie wording, card timing |
| SFAQ | [Official Seafarers FAQ](https://www.catan.com/faq/seafarers) | Loops and rings, closed lines, ship moves and Longest Route, Road Building timing, pirate edge cases; undated, older in wording than 2025 |
| L56 | [Archived English 5–6 player extension rules, 2020](https://www.catan.com/sites/default/files/2021-08/catan_5-6_basegame_rules.pdf) | The special building phase behind the Between-turns build option |
| DE56 | [German 5–6 player expansion rules, 2025](https://www.catan.de/sites/default/files/2025-03/CATAN_Das%20Spiel_5-6_Anleitung.pdf) | Cross-check of paired-turn wording and the robber's start; not adopted where it differs from R6-56 |
| DES6 | [German Seafarers rules, 2025](https://www.catan.de/sites/default/files/2025-03/400205684679_CAT_NE_SEE34_Manual_DE_web.pdf) | Cross-check of ship, robber and pirate wording; not adopted where it differs from S6 |

R6 and FAQ from the Classic table also apply. The base FAQ's 5–6 entries all date from the special-building-phase era; they are cited by topic ("Special Building Phase in a 5-6 Player Game", "Development Cards in General", "Development Cards – Progress – Road Building", and the one "Victory Conditions" entry on winning during the special building phase) for the Between-turns build option only. The other "Victory Conditions" entries are general base-game rulings. The one on a player already at the target when their turn begins, also cited by B72, supports BT33 and BT34 by analogy. SFAQ entries are cited by the topic of their question. Page numbers are PDF pages. Neither 2025 English book prints a visible version number, so cite them as "CN3082 (2025)" and "CN3083 (2025)". When checked on 25 September 2026, no errata and no FAQ entry existed for CN3082 or for the paired rule.

As for Classic, the reference PDFs were read outside the repository. No official artwork, examples or rulebook passages are included.

### Official maps are not reproduced

Neither mode rulebook, nor [map generation](MAP_GENERATION.md), reproduces an official map. The official fixed layouts, lettered number sequences and scenario maps are described at most by counts, shape and structure. Big Table's board comes from Catanova's preset `big-table-balanced-v1`, our balanced approach adapted to the 30-hex island ([Big Table islands](MAP_GENERATION.md#big-table-islands)). Outer Isles, Open Sea's first scenario, comes from the preset `outer-isles-v1`, with templates of our own design for three and for four players ([Outer Isles](MAP_GENERATION.md#open-sea-outer-isles)). Both presets are labelled as Catanova's own, not as the official setup. The official 5–6 lettered spiral is described in the Big Table rulebook for reference only and is not offered.

### Big Table coverage

| ID | Behavior | Rulebook section | Basis | Status |
| --- | --- | --- | --- | --- |
| BT01 | Five or six players only; no game for two to four, or for seven or more | 1.1, 10 | R6-56 pp. 1, 3 | Documented (BD2) |
| BT02 | Host picks the mode; ruleset frozen at start; mode change refused while seats or bots do not fit; a mode change resets the target to the new mode's default | 1.2 | — | Catanova decision (M2, M8) |
| BT03 | Summary of changes from Classic | 1.3 | R6-56 pp. 1–4 | Documented |
| BT04 | Bank of 24 per resource, 120 in total; shortage rule per resource | 2, 8 | R6 pp. 3, 6; R6-56 p. 1 | Documented |
| BT05 | 34-card deck: 20 Knights, 3 Road Building, 3 Year of Plenty, 3 Monopoly, 5 Victory Point; never refilled | 2 | R6 pp. 3, 9; R6-56 p. 1 | Documented |
| BT06 | 15 roads, 5 settlements, 4 cities per player; one robber despite two deserts | 2 | R6 p. 3; R6-56 p. 1 | Documented |
| BT07 | Awards keep the names Longest Road and Largest Army | 2, 8 | R6 pp. 8–9; R6-56 p. 1 | Documented; the name is a Catanova decision (BD4) |
| BT08 | 30 land hexes in rows of 3-4-5-6-5-4-3: 6 forest, 6 pasture, 6 fields, 5 hills, 5 mountains, 2 deserts | 3.1, 3.2 | R6-56 pp. 1–2, 4 | Documented |
| BT09 | 28 number tokens: two each of 2 and 12, three each of 3–6 and 8–11; none on deserts | 3.2 | R6-56 pp. 1, 4 | Documented |
| BT10 | Island graph: 80 intersections, 109 edges, 38 coastal edges, 22 sea spaces | 3.2 | Derived from the shape | Documented |
| BT11 | 11 harbours: five 3:1, two Sheep 2:1, one 2:1 each of Timber, Clay, Hay and Rock | 3.3 | R6 p. 3; R6-56 pp. 1–2 | Documented |
| BT12 | Harbours placed by our generator on 11 of 38 coastal edges, spaced, types shuffled | 3.3 | R6-56 p. 4 (official frame, not used) | Catanova decision (BD6) |
| BT13 | Room setup: turn structure, target 10 by default on the slider, dice mode, turn timer | 4.1, 9.1 | R6-56 p. 3 (10 points) | Documented; the options are a Catanova decision (M5) |
| BT14 | Balanced 30-hex board as the default and only board, labelled as our preset; 11-pip cap per intersection kept | 4.2 | — | Catanova decision (BD5) |
| BT15 | Robber starts on a desert chosen at random from the map seed | 4.2 | R6 p. 11; DE56 pp. 2–3 | Catanova decision (BD7) |
| BT16 | No fixed first-game layout; no five-player unused-colour rule | 4.2, 10 | R6-56 p. 2 (not adopted) | Catanova decision (BD8) |
| BT17 | Official variable setup and lettered spiral described for reference only; no spiral preset in v1 | 4.2 | R6-56 p. 4; R6 p. 11 | Documented (reference only); not offering a spiral preset is a Catanova decision (BD5) |
| BT18 | Highest roll starts; tied highest players re-roll | 4.3 | R6 p. 12; R6-56 p. 2 | Documented; the re-roll is Classic decision 7 (BD9) |
| BT19 | Snake draft 1…n, n…1; the markers play no part in setup | 4.4 | R6 p. 12; R6-56 p. 4; PR21 p. 1 | Documented |
| BT20 | Host chooses Paired turns (default) or Between-turns build; fixed for the game | 4.1, 5 | R6-56 p. 3; PR21 p. 1; L56 pp. 3–4 | Catanova decision (BD10) |
| BT21 | Lead is the player on turn; Partner is the third player to the Lead's left | 6.1 | R6-56 pp. 3–4; PR21 p. 1 | Documented; counting only players still in the game is a Catanova decision (BD12) |
| BT22 | Three phases in fixed order; the Lead finishes before the Partner begins | 6.1 | R6-56 p. 3 | Documented |
| BT23 | Lead plays a normal turn and may trade with anyone, the Partner included | 6.2 | R6-56 p. 3 | Documented |
| BT24 | Partner never rolls; may trade with the bank and at own harbours, build, buy and play one card; no trade with players | 6.3 | R6-56 pp. 1, 3; PR21 p. 2 | Documented |
| BT25 | Partner plays no card before the Lead's roll or during the Lead's part | 6.3 | PR21 p. 2; DE56 p. 4; R6-56 p. 3 | Documented |
| BT26 | Partner may reveal Victory Point cards to win, including cards bought in the phase | 6.3 | R6-56 p. 1; R6 pp. 9–10 | Documented |
| BT27 | Both markers pass one seat left after the Partner's phase | 6.3 | R6-56 p. 3 | Documented; DE56 timing not adopted (BD13) |
| BT28 | Others during a paired turn; no player trades in the Partner's phase; Monopoly takes from the other marker holder | 6.4 | R6 pp. 6–7, 9; R6-56 p. 3 | Documented |
| BT29 | Seven only on the Lead's roll; Partner discards and can be robbed; Partner's Knight may rob the Lead | 6.5 | R6 pp. 6, 9; R6-56 p. 3 | Documented |
| BT30 | Cards cross roles; one card per part, never one bought in the same part | 6.6 | R6-56 pp. 1, 3; PR21 p. 2 | Documented (BD15) |
| BT31 | Lead wins at once in their part; Partner wins at once in their phase | 6.7 | R6-56 p. 3 | Documented |
| BT32 | Both marker holders on turn for the whole paired turn; check after every action, a resignation that moves an award included; Lead wins if both qualify | 6.7 | PR21 p. 2; DE56 p. 4 | Catanova decision (BD14) |
| BT33 | Marker holder already at the target when the paired turn begins wins without rolling | 6.7 | FAQ: Victory Conditions; R6 p. 10 | Catanova decision (BD14) |
| BT34 | Player holding neither marker wins when a later paired turn begins in which they hold a marker, if still at the target | 6.7 | FAQ: Victory Conditions (by analogy) | Catanova decision (BD14) |
| BT35 | Fewer than five players: the Partner's phase stops; single turns | 6.8 | R6-56 p. 3 (five and six only) | Catanova decision (BD16) |
| BT36 | Between-turns build: after each turn, one window for every other player, clockwise from the next player; windows at any player count, never skipped automatically | 7.1, 7.2 | L56 pp. 3–4; FAQ: Special Building Phase in a 5-6 Player Game | Documented (older official rule); offering it, and the player count and skipping rules, are Catanova decisions (BD17) |
| BT37 | Windows allow building and buying with cards in hand only; no trade of any kind, no card play | 7.2, 7.3 | L56 p. 4; FAQ: Development Cards – Progress – Road Building | Documented |
| BT38 | Card bought in a window playable from the buyer's next turn | 7.4 | FAQ: Development Cards in General | Documented |
| BT39 | No win in a window; win at the start of own turn if still at the target | 7.5 | FAQ: Victory Conditions | Documented |
| BT40 | Everything else Classic; markers and the running window are public | 8 | R6; R6-56 p. 1 | Documented |
| BT41 | No bots and no stand-in bots | 1.1, 9.1 | — | Catanova decision (M3) |
| BT42 | Partner's-phase clock half the room time rounded up to a whole second, at least 30 s, 45 s for an absent Partner without a timer; windows 20 s in every room; only the acting clock shown prominently | 9.2, 9.4 | — | Catanova decision (BD18) |
| BT43 | Expired Partner's phase or window ends with nothing bought or built; free roads owed stay unplaced; a Knight's robber move is completed | 9.3 | — | Catanova decision (BD18) |
| BT44 | Absent player: the game waits; after 2 minutes offline the clock acts for them, setup placements included | 9.4 | TURN_CLOCK.md | Catanova decision (M4, M7) |
| BT45 | Resignation, pausing and abandonment as in Classic; resigned players skipped and not counted for the Partner; resignations in the middle of a turn | 9.5, 9.6 | TURN_CLOCK.md | Documented; mid-turn resignations are a Catanova decision (BD19) |

### Open Sea coverage

| ID | Behavior | Rulebook section | Basis | Status |
| --- | --- | --- | --- | --- |
| OS01 | One scenario, Outer Isles, for three or four players; no two-player game; five and six later | 1.1, 16.2, 16.3 | S6 p. 3 | Documented; the scope is a Catanova decision (OD2) |
| OS02 | Host picks the mode; ruleset frozen; change refused while more than four players or any bot are seated; fewer than three may switch and wait; a mode change resets the target to the new mode's default | 1.2, 15.1 | — | Catanova decision (M2, M8) |
| OS03 | Target 14 by default; the host may set 10–18 | 1.3, 12.3, 15.2 | S6 p. 4 | Catanova decision (OD5) |
| OS04 | Land and sea hexes; deserts and gold fields are land; no frame; the outer ring of sea is on the board | 2.1 | S6 pp. 2–3 | Catanova decision (OD4) |
| OS05 | Islands separated by sea; land, coastal and sea intersections | 2.2, 2.3 | S6 p. 2; DES6 p. 5 | Documented |
| OS06 | Distance rule across a strait | 2.3 | SFAQ: distance rule on neighbouring islands | Documented |
| OS07 | Edge classes; a coastal edge holds a road or a ship, never both | 2.4, 7.2 | S6 p. 2; DES6 p. 5; SFAQ: parallel roads and ships | Documented |
| OS08 | Nothing on rim edges | 2.4 | SFAQ: ships on frame edges (not adopted) | Catanova decision (OD4) |
| OS09 | Harbours as in Classic; a harbour edge may hold a road or a ship | 2.5 | R6 p. 7; S6 p. 12 | Documented; ships on harbour edges is a Catanova decision (OD9) |
| OS10 | Bank of 19 per resource; 25-card deck; 15 roads, 15 ships, 5 settlements, 4 cities | 3 | R6 p. 3; S6 p. 1 | Documented; the bank size is a Catanova decision (OD7) |
| OS11 | Ship costs 1 Timber and 1 Sheep, is worth no points, counts for Longest Route | 3 | S6 pp. 1–2 | Documented |
| OS12 | Island bonuses without a supply limit | 3, 12.2 | S6 p. 1 (finite token pool) | Catanova decision (OD6) |
| OS13 | Outer Isles guarantees: templates per player count, main island, small islands, gold only on small islands, sea ring, reachability, harbour spacing, pirate start | 4.1 | S6 p. 4 (structure of the first scenario) | Catanova decision (OD3) |
| OS14 | Terrain, numbers and harbour types shuffled every game under fairness rules; no 6 or 8 on gold | 4.2 | S6 pp. 5, 11, 20 | Catanova decision (OD3) |
| OS15 | Robber starts on a desert chosen from the map seed; pirate on the template's sea hex | 4.3 | S6 p. 4 | Catanova decision (OD20, OD21) |
| OS16 | Starting player by roll with Classic's tie re-roll; snake draft | 5.1, 5.2 | S6 p. 3; R6 p. 12 | Documented |
| OS17 | Both starting settlements on the main island | 5.3 | S6 p. 4 | Catanova decision (OD6); matches the first official scenario |
| OS18 | After each starting settlement a road, or at a coastal settlement a ship; never on the pirate's edges | 5.4 | S6 pp. 1, 3; SFAQ: starting ship next to the pirate | Documented (OD24) |
| OS19 | Second settlement next to gold: one chosen resource per gold field | 5.5, 9.3 | None settles it | Catanova decision (OD18) |
| OS20 | No bonus, trade, card or ship move in setup; a setup ship may move on the first turn | 5.6 | S6 pp. 2–4 (derived) | Documented |
| OS21 | Turn shape unchanged; ship move in the action phase; others cannot build or move ships | 6 | R6 p. 6; S6 p. 2 | Documented |
| OS22 | New ship attaches to own ship or building, never to a road, not through an opponent's building, not on the pirate's edges | 7.1 | S6 p. 2 | Documented (OD8) |
| OS23 | Roads and ships join only at own settlement or city; separate at an empty meeting point | 7.3 | S6 p. 2; DES6 pp. 5–6; SFAQ: road and shipping route meeting | Documented (OD8) |
| OS24 | Settling by ship, including on small islands | 7.4 | S6 pp. 2, 4; DES6 p. 5 | Documented |
| OS25 | One ship move per turn: not built this turn, not on the pirate's edges, with an open end, not in a closed line | 8.1, 8.4 | S6 p. 2 | Documented (OD14) |
| OS26 | Own road does not close a ship's end | 8.2 | S6 p. 2 | Documented; follows the 2025 wording (OD10) |
| OS27 | A closed line stays closed after an opponent builds on it; on an open line, the ships beside a new opponent settlement do not become open | 8.2, 8.7 | S6 p. 2; SFAQ: interrupted shipping route | Documented (OD11); the open-line case follows SFAQ by Catanova decision (OD13) |
| OS28 | Own ships meeting at an opponent's existing building do not connect; each end is open | 8.2 | None settles it | Catanova decision (OD13) |
| OS29 | A loop frees its two end ships; a ring frees every ring ship; the same in any network; a cycle through an opponent's building is neither | 8.3, 8.7 | SFAQ: when a ship is open | Catanova decision to follow SFAQ and extend it (OD12) |
| OS30 | No ship move between Road Building's two placements | 8.4, 13.2 | SFAQ: Road Building | Catanova decision (OD16) |
| OS31 | Destination is any edge where a new ship could go, with no distance limit; other ships must stay attached | 8.5 | S6 p. 2; SFAQ: how far an open ship may move | Documented; the attachment check is a Catanova decision (OD14) |
| OS32 | A move never costs Longest Route if the route is still at least as long | 8.6 | SFAQ: Longest Route while moving | Documented (OD15) |
| OS33 | Decision procedure for movable ships | 8.7 | S6 p. 2; SFAQ (derived) | Documented (derived) |
| OS34 | Gold field: 1 chosen resource per settlement, 2 per city in any mix; gold is not a resource | 9.1 | S6 p. 2; SFAQ: city next to a gold field | Documented |
| OS35 | Ordinary production and shortage rule first, then gold picks one player at a time from the active player, from what the bank holds | 9.2 | R6 p. 6; S6 p. 2 | Catanova decision (OD17) |
| OS36 | Robber stops a gold field; the pirate never stands on one | 9.4 | R6 p. 6; S6 p. 2 | Documented |
| OS37 | One 20-second gold clock per player for all their picks, in every room; the default is the fewest-held available type, ties in the order Timber, Clay, Sheep, Hay, Rock | 9.5, 15.3 | — | Catanova decision (OD19) |
| OS38 | Robber on land only; pirate on sea hexes only, never on a frame | 10.1 | S6 p. 2; DES6 p. 7; SFAQ: robber without a desert | Catanova decision (OD20, OD21) |
| OS39 | After discards on a 7, or on a Knight, exactly one of robber or pirate moves | 10.2, 10.3, 13.1 | S6 pp. 2–3; DES6 p. 7 | Documented |
| OS40 | Robber moves as in Classic and does not affect ships | 10.4 | R6 p. 6; S6 p. 2 | Documented |
| OS41 | Pirate to a different sea hex; one random card from a chosen player with a ship there; theft compulsory | 10.5 | S6 p. 2; SFAQ: coastal settlement next to the pirate | Documented; compulsory theft follows the 2025 wording (OD20) |
| OS42 | Pirate blocks building and moving ships on its six edges, and nothing else | 10.6 | S6 p. 2; SFAQ: building next to the pirate | Documented |
| OS43 | Longest Route: 2 points, at least 5 roads and/or ships; roads and ships chain only at own buildings | 11.1, 11.2 | S6 p. 2; SFAQ: road and shipping route meeting | Documented; the name is a Catanova decision (OD22) |
| OS44 | An opponent's building breaks the route, even on a closed line; the pirate has no effect; ties and breaks as in Classic | 11.1, 11.3 | S6 p. 2; SFAQ: interrupted shipping route; FAQ: Longest Road | Documented; keeping the award on a tie is a Catanova decision (OD22) |
| OS45 | Recalculate after each road, ship, move or connecting settlement | 11.4 | R6 p. 8 (derived) | Documented |
| OS46 | +2 for a player's first settlement on each small island; each island once per player; kept on upgrade | 12.1, 12.2 | S6 p. 4 | Documented; values of the first official scenario (OD6) |
| OS47 | Win during own turn at the target; hidden Victory Point cards count; no final round | 12.3 | R6 p. 10; S6 p. 2 | Documented |
| OS48 | Knight moves the robber or the pirate | 13.1 | S6 p. 3 | Documented |
| OS49 | Road Building places two roads or ships in any mix, one straight after the other; no paid build between | 13.2 | S6 p. 3; SFAQ: Road Building | Documented (OD23) |
| OS50 | Other development cards unchanged | 13.3 | S6 p. 3; R6 p. 9 | Documented |
| OS51 | Ships, moves, pirate and bonuses public; gold picks public | 14 | S6 p. 4 (public bonus tokens) | Documented; gold-pick visibility is a Catanova decision (OD19) |
| OS52 | Clocks: turn timer, discards, one 20-second gold clock per player owed gold; expiry defaults | 15.3 | — | Catanova decision (OD19, OD26, OD27, OD28) |
| OS53 | No bots and no stand-in bots | 15.4 | — | Catanova decision (M3) |
| OS54 | Absent player: the game waits; after 2 minutes offline the clock acts for them, setup placements included | 15.5 | TURN_CLOCK.md | Catanova decision (M4, M7) |
| OS55 | Resignation, pausing and abandonment as in Classic; ships stay on the board | 15.6 | TURN_CLOCK.md | Documented |
| OS56 | Reserved later scenarios; outline of five and six players with paired turns and a Partner's ship move | 16 | S6-56 pp. 2–3 | Outline only; not in `open-sea-v1` |
| OS57 | The room's board before the game: dealt when the room is created, as in Classic, and again on a change of mode, but not drawn in the lobby; it follows the seated count between the three- and four-player templates, and that re-deal does not reset readiness; Start refuses a board made for another count | 4.1, 15.1 | — | Catanova decision of 26 September 2026; replaces an earlier draft in which the lobby showed the board and a re-deal reset readiness |

### Edition and interpretation decisions: both modes

1. **M1 Names:** the modes are Classic (`base-3-4-v1`), Big Table (`big-table-v1`) and Open Sea (`open-sea-v1`). Big Table always appears with its short description, "for five and six players". Open Sea is always two words. Open Sea's first scenario is Outer Isles (`outer-isles`). Sister Isles (four islands), Sand Divide (a desert barrier) and Veiled Waters (fog) are reserved for later scenarios and are not in v1. A later knights mode will take a name of the form "X & Y" (candidates: Guilds & Guards, Raiders & Ramparts); it is parked and not documented. The paired-turn roles are the Lead and the Partner, and the Partner's part is "the Partner's phase". The official books say player 1 and player 2.
2. **M2 Choosing a mode:** the host picks it in Room setup. The ruleset is frozen into the game when it starts, and a saved game keeps it. In the lobby, a change of mode is refused while the seated players do not fit the new mode, or while bots are seated and the new mode allows none.
3. **M3 Bots:** allowed only in Classic for now. Big Table and Open Sea allow no bots and no stand-in bots. This is a product choice, not a rules claim.
4. **M4 Absent players:** a disconnected player is shown as disconnected, and the game waits for them. Once they have been offline for 2 minutes, the turn clock acts for them whenever the game waits on them, exactly as if their time had run out: their turns, any discard, and in Big Table the Partner's phase and build windows, and in Open Sea gold picks. This applies whether or not the room has a turn timer, and stops when they reconnect. It differs from Classic in three ways. No stand-in bot takes the seat after 30 seconds. The seat makes only the clock's forced moves and never builds, buys, trades, plays a card or moves a ship. A room without a timer is kept moving by the 2-minute rule rather than by a stand-in. Leave, the three-minute grace, no resignation for absence while any remaining player is connected, pausing when every remaining player is offline, and closing as Abandoned all work as in Classic. See [modes without bots](TURN_CLOCK.md#modes-without-bots).
5. **M5 Room options:** the target slider, dice mode and turn timer work as in Classic. Big Table's target is 10 by default. Open Sea's is 14 by default, within 10–18.
6. **M6 Versions:** a change that alters legal moves or hidden information needs a new ruleset version (`big-table-v2`, `open-sea-v2`). Board presets are versioned separately (`big-table-balanced-v1`, `outer-isles-v1`); see [map generation](MAP_GENERATION.md#versions).
7. **M7 Absent players during setup:** setup stays untimed, but a setup placement is compulsory, so it counts as a forced move under M4. Once a player has been offline for 2 minutes, whenever the draft waits on them, the clock places a settlement on the legal intersection with the most production pips, on the main island in Open Sea, with ties broken at random by the server. It then places a road on a random legal edge touching that settlement; in Open Sea it places a ship there instead only if no road is legal. Decided on 26 September 2026 (BQ11, OQ5).
8. **M8 Changing mode and the target:** changing mode resets the points target to the new mode's default: 10 for Classic and Big Table, 14 for Open Sea. Only too many seated players, or seated bots, block a change, so a room with too few players may switch and wait for more before starting. Decided on 26 September 2026 (BQ12, OQ11).

### Edition and interpretation decisions: Big Table

1. **BD1 Reference edition:** CN3082 (2025), played with R6. PR21 and DE56 are supporting evidence where R6-56 is silent; where they differ, R6-56 wins. L56 and the base FAQ's special-building-phase entries are used only for the Between-turns build option.
2. **BD2 Players:** five or six players only. The paired rule is defined only for those counts (R6-56 p. 3).
3. **BD3 Supply and island:** as the official expansion: 30 land hexes in rows of 3-4-5-6-5-4-3, 28 number tokens, 11 harbours, 24 of each resource, a 34-card deck, and 15 roads, 5 settlements and 4 cities per player (R6-56 p. 1; R6 p. 3).
4. **BD4 Award names:** Longest Road and Largest Army keep their Classic names. The 2025 books say Longest Route; Big Table has only roads, so the Classic name stays accurate. Classic decision 2 applies to Year of Plenty in the larger deck.
5. **BD5 Board:** every game uses `big-table-balanced-v1`, Catanova's balanced generator adapted to 30 hexes. It is the default and only board in v1, and it is labelled as our preset. The official variable setup (shuffled frame, random terrain, lettered spiral) is documented only as reference. No spiral preset is offered in v1. One is recorded only as a possible later option, and it would first need the value on each letter settled, since no 2025 source prints it (BQ2). The preset keeps the cap of 11 production pips per intersection, and the cap is not raised. It ships only when a tuned search keeps every board under the 100 ms limit over 20,000 seeds, or else generates boards off the server's main thread, in a worker, with a documented longer limit (BQ1).
6. **BD6 Harbours:** our generator places the 11 harbours on the 38 coastal edges, with types shuffled and no two harbours on the same or neighbouring intersections. By our count, a uniformly shuffled official frame puts two harbours on one intersection in about 80% of games. No official source addresses harbour spacing on this island.
7. **BD7 Robber start:** a desert chosen at random from the map seed. R6 p. 11 speaks of a single desert, DE56 pp. 2–3 lets the players pick either, and no source says who picks.
8. **BD8 No fixed layout:** no first-game layout, and so no five-player rule that leaves an unused colour's settlements on the island (R6-56 p. 2).
9. **BD9 Setup:** the Classic snake draft, 1…n then n…1. The starting player is decided by roll, with Classic decision 7's re-roll of tied highest totals; R6 and R6-56 do not cover a tie.
10. **BD10 Turn structure:** the host chooses Paired turns, the default and the current official rule (R6-56 p. 3; PR21 p. 1), or Between-turns build, labelled in Room setup as the older official rule. Officially the special building phase was replaced rather than kept as a variant; offering it is our choice.
11. **BD11 The Partner's actions:** as R6-56 p. 3: bank and harbour trades, building, buying and one development card of any type, including a Knight, which moves the robber and robs as usual. Trade with players is the only restriction. A community report that the Partner may not trade with the bank has no official support.
12. **BD12 Counting the Partner:** the third player to the Lead's left, counting only players still in the game.
13. **BD13 Passing the markers:** both markers pass one seat left together after the Partner's phase (R6-56 p. 3). DE56 p. 4 hands the Lead marker on as soon as the Lead finishes; that timing is not adopted, so the Lead remains a marker holder through the Partner's phase.
14. **BD14 Winning under paired turns:** R6-56 p. 3 settles only a Lead who reaches the target in their own part and a Partner who reaches it in their own phase. It prints no tie clause, and uses "turn" both for the whole paired turn and for the Lead's part alone. PR21 p. 2 and DE56 p. 4 count both marker holders as on turn and give player 1 a tie. Catanova rule: both marker holders are on turn for the whole paired turn. After every action, and when a paired turn begins, if exactly one of them has the target, that player wins at once; if both do, the Lead wins. A resignation counts as an action: when it moves Longest Road or Largest Army, the check is made at once (BQ4). A player holding neither marker who reaches the target wins when a later paired turn begins in which they hold the Lead or Partner marker, if they still have it then, so a new Partner wins before the Lead rolls (BQ13). That follows, by analogy, the base FAQ's ruling on a player already at the target when their turn begins.
15. **BD15 Cards across roles:** a card bought in one role may be played in the other role in a later part, and the one-card limit and the bought-this-part limit apply to each part separately (R6-56 pp. 1, 3; PR21 p. 2).
16. **BD16 Fewer than five players:** when resignations leave fewer than five players, the Partner's phase stops and turns continue one player at a time. The island, supply and deck stay those of Big Table. With four players, "third to the left" would be the Lead's right-hand neighbour, and with three the Lead.
17. **BD17 Between-turns build:** after each turn, every other player gets one window, one at a time, clockwise from the player to the left of the one who just finished. Windows follow every turn, even when nobody built. In a window a player may build roads, settlements and cities and buy development cards with the cards in hand. There is no trade with players, no bank or harbour trade, no development-card play and no win; a player who reaches the target in a window wins only on their own turn. A card bought in a window is playable from its buyer's next turn. This follows L56 pp. 3–4 and the base FAQ's 5–6 entries. The first German edition's form, where only players who ask may build, is not adopted. Once this structure is chosen, windows continue at any player count, even below five players (BQ5). Nothing skips a window automatically, because that would reveal something about a hidden hand; a player may pass at once (BQ6).
18. **BD18 Clocks:** the Partner's phase has its own clock, half the room's turn time rounded up to a whole second, and at least 30 seconds: 30, 33, 45, 58 and 70 seconds at the five timer stops (BQ9). In a room without a timer it is 45 seconds and starts only for an absent Partner (M4): when the phase begins with the Partner absent, or when the Partner disconnects during the phase. Once started, it keeps running if they reconnect; an absent player's own turn in such a room has no clock besides the 2-minute rule (BQ8). Each build window has a 20-second clock, in every room, whether or not it has a turn timer (BQ7). When either runs out, the phase or window simply ends, and nothing is bought or built automatically. Free roads still owed from a Road Building card played in the Partner's phase stay unplaced, while a robber move still owed from a Knight is completed with the Classic default (BQ10). Only the acting player's clock is shown prominently. No official source covers online clocks.
19. **BD19 Resignations in the middle of a turn:** as section 9.6 of the rulebook. The Partner's phase still follows a Lead who resigns, if five or more remain. A Partner who resigns before their phase is not replaced that paired turn. A Partner's phase under way finishes when the count drops below five. A robber move owed by a resigned player falls to the next player to act. Under Between-turns build, windows continue at any player count (BQ3).

### Edition and interpretation decisions: Open Sea

1. **OD1 Reference edition:** CN3083 (2025), played with R6. SFAQ is followed where it settles a point the book leaves open, although its wording predates 2025. DES6 is a cross-check; where it differs from S6, S6 wins.
2. **OD2 Scope:** `open-sea-v1` has one scenario, Outer Isles, for three or four players. There is no two-player Open Sea. Five and six players come later and are only outlined, from S6-56.
3. **OD3 Outer Isles:** our own shape, not an official map: a main island where every starting settlement goes, several small islands reachable only by sea, gold fields only on small islands, and a ring of sea hexes that is part of the board. There are separate templates for three and four players. Terrain, numbers and harbour types are shuffled every game under fairness rules: at least the `balanced-v2` number rules where they apply, no 6 or 8 on gold, every small island reachable by ship, and harbours on the main island's coast with no two sharing or neighbouring an intersection. The templates and rules are in [map generation](MAP_GENERATION.md#open-sea-outer-isles). Keeping red numbers off gold echoes S6 pp. 11 and 20.
4. **OD4 No frame:** S6 p. 2 lets the pirate go to the frame, and SFAQ lets ships use the edges between board and frame. Our board has no frame. Its outermost hexes are sea hexes on the board, nothing goes on the outer rim, and the pirate is always on a sea hex.
5. **OD5 Target:** 14 by default, and the host may choose 10–18. The first official scenario uses 14 (S6 p. 4); the range is ours.
6. **OD6 Island bonus:** +2 for a player's first settlement on each small island. Each island counts once per player, and bonuses have no supply limit, although the official token pool is finite (S6 p. 1). Starting settlements go only on the main island, so the bonus never comes from setup. The +2 value and the main-island start match the first official scenario (S6 p. 4).
7. **OD7 Supply:** 19 of each resource, since no Seafarers box adds cards and Classic decision 6 keeps 19 as the standard; the Classic 25-card deck; 15 roads, 15 ships, 5 settlements and 4 cities per player.
8. **OD8 Ships:** a ship costs 1 Timber and 1 Sheep and goes on an edge touching at least one sea hex, except the outer rim. A coastal edge holds a road or a ship, never both. Ships attach to your own ships or buildings, never directly to your roads. A road and a ship that meet at an empty intersection stay separate networks until you build there (S6 p. 2; SFAQ).
9. **OD9 Harbour edges:** a harbour edge is an ordinary coastal edge and may hold a road or a ship. S6 states this for one scenario only (p. 12).
10. **OD10 Open ends:** an end is open when its far intersection holds none of your buildings and none of your other ships. Your own road there does not close it, as the 2025 wording gives it (S6 p. 2). The 2020 English wording would have closed it, and no official example shows the case.
11. **OD11 Closed lines:** a line of ships joining two of your buildings never moves, even after an opponent builds on it (S6 p. 2; SFAQ). Your route is broken there for Longest Route.
12. **OD12 Loops and rings:** SFAQ is followed. A loop that leaves and returns to the same building of yours frees only its two end ships. A ring with none of your buildings on it makes every ring ship movable. Read literally, the 2025 end test would lock every ship in both shapes. The same check applies in any network, such as two rings side by side, three lines between the same two sea intersections or a ring hanging off a loop: every ship on a cycle with none of your buildings is free, and so are the two end ships of a loop through one of your buildings (OQ7). A loop or ring through an opponent's building is broken there, following OD13 (OQ8).
13. **OD13 An opponent's building at a meeting point:** your ships that meet at an intersection holding an opponent's building do not connect through it. If the building was there first, each has an open end there. Read literally, the 2025 wording would lock both. When an opponent places a settlement later on your line of ships, open or closed, the ends of your ships that met there are recorded as closed, so the ships beside it do not become open, as SFAQ answers (OQ15).
14. **OD14 Moving ships:** once per turn, in your action phase, and in the Partner's phase too in a later five-and-six version. The ship must not have been built this turn, must not be on an edge of the pirate's hex and must sit at an open end. It may go to any edge where a new ship could legally go, never an edge of the pirate's hex. A move may not detach another of your ships: every ship attached before the move must still be attached after it, and a ship already cut off never blocks a move (OQ6). Ships cut off together by another player's building still count as attached to each other, so moving one of them may not leave its partner detached (decided 26 September 2026).
15. **OD15 Moves and Longest Route:** moving a ship never costs you Longest Route if your route is still at least as long afterwards (SFAQ).
16. **OD16 Road Building and moves:** no ship move between the two placements. SFAQ forbids only a paid build between them.
17. **OD17 Gold production:** each adjacent settlement gets 1 resource of its owner's choice, each city 2 in any mix (S6 p. 2; SFAQ). Ordinary production resolves first with the base shortage rule. Then players owed gold choose one at a time, in turn order starting with the active player, each from what the bank still holds. Each pick must be a type the bank still holds, and if the bank is empty, remaining picks lapse (OQ9). No source settles gold during a shortage or the order of picks.
18. **OD18 Gold at setup:** a second starting settlement next to gold fields gets 1 chosen resource per adjacent gold field. No source settles it; Outer Isles never produces the case.
19. **OD19 Gold clock:** each player owed gold has one 20-second clock for all their picks. When it runs out, the default for each card still owed is the resource the player holds fewest of among those the bank still holds, with ties in the order Timber, Clay, Sheep, Hay, Rock. The clock runs in every room, whether or not it has a turn timer (OQ1), and the active player's clock pauses while picks are made, as during discards (OQ2). Picks are public once made, as Year of Plenty's cards are (OQ10).
20. **OD20 The pirate:** always on a sea hex, starting on a sea hex set by the template, away from starting positions. On a rolled 7 (after discards) or a Knight, the active player moves either the robber or the pirate, not both. The pirate must go to a different sea hex; then the active player must rob one player with a ship on an edge of that hex, one random resource card, if anyone has one. S6 p. 2 words the theft as a command; the 2020 English and German 2025 texts say "may", and we follow S6. The pirate blocks building and moving ships on its hex's edges, and blocks no production, roads, buildings or harbours.
21. **OD21 The robber:** land hexes only, starting on a desert chosen at random from the map seed. S6 never says "land" outright; DES6 p. 7 and SFAQ do.
22. **OD22 Longest Route:** Open Sea's award is called Longest Route because ships count, which is also the 2025 official name. It is worth 2 points and needs at least 5 roads and/or ships in one continuous route. Roads and ships chain only through your own settlement or city, and an opponent's building interrupts. Ties and breaks follow Classic section 10, where the holder keeps the award while tied, as the base FAQ has it; R6 p. 8 is less explicit on a tied holder.
23. **OD23 Road Building:** place 2 roads or ships in any mix, one after the other, each following its own rules. Classic's provisional handling of the extreme cases applies, reading "road" as "road or ship".
24. **OD24 Setup:** the Classic snake draft, on the main island. Each setup piece after a settlement may be a road or, if the settlement is coastal, a ship (S6 p. 3).
25. **OD25 Everything else:** every other rule is Classic.
26. **OD26 Clock defaults:** when a turn runs out with a robber-or-pirate move owed, the clock always moves the robber, never the pirate. If the pirate has moved and only its victim is owed, the clock picks a random legal victim among the other players with a ship on an edge of its hex (OQ3). Each Road Building piece still owed becomes a road on a random legal site if possible, otherwise a ship on a random legal edge away from the pirate, otherwise nothing (OQ4).
27. **OD27 Gold picks in setup:** a second starting settlement's gold picks have the same 20-second clock as a roll's, although setup placements themselves are untimed (sections 9.5 and 15.3). Outer Isles never deals the case. Decided when the engine was built, 26 September 2026.
28. **OD28 The pirate's victim:** online, a player moves the pirate and names its victim in one move, as with the robber, so the game never waits on a victim alone, and the clock's default for that case (OD26) never arises (section 15.3). Decided when the engine was built, 26 September 2026.

### Open points: Big Table

These are the points section 11 of the Big Table rulebook listed as open. Each is numbered as in that section. All were closed on 26 September 2026, under the owner's delegation, by the decision named.

1. **BQ1 The balanced 30-hex board:** closed by BD5. The 11-pip cap stays and is not raised. The preset ships when a tuned search keeps every board under 100 ms over 20,000 seeds, or else generates boards in a worker off the server's main thread with a documented longer limit. [Map generation](MAP_GENERATION.md#big-table-islands) has the measurements of the release code.
2. **BQ2 A spiral preset:** closed by BD5. None is offered in v1; one is recorded only as a possible later option.
3. **BQ3 Resignations during a paired turn:** closed by BD19, which confirms the rulebook's section 9.6.
4. **BQ4 A resignation that moves an award:** closed by BD14. It counts as an action and triggers the win check.
5. **BQ5 Between-turns build with fewer than five players:** closed by BD17. Windows continue at any player count.
6. **BQ6 Unusable build windows:** closed by BD17. Nothing skips a window automatically, and a player may pass at once.
7. **BQ7 Build-window clock without a turn timer:** closed by BD18. The 20-second clock is always on. The [turn clock](TURN_CLOCK.md#modes-without-bots) document says the same.
8. **BQ8 The 45-second Partner's phase:** closed by BD18, which confirms the rulebook's section 9.4.
9. **BQ9 Half-second clocks:** closed by BD18. They round up: 33 and 58 seconds.
10. **BQ10 Unfinished card effects when the Partner's phase expires:** closed by BD18. Free roads stay unplaced; a Knight's robber move is completed.
11. **BQ11 An absent player during the setup draft:** closed by M7.
12. **BQ12 Changing mode and the target:** closed by M8. The target resets to the new mode's default.
13. **BQ13 When a player who held no marker wins:** closed by BD14. They win when a later paired turn begins in which they hold a marker, if still at the target.

### Open points: Open Sea

These are the points section 17.3 of the Open Sea rulebook lists. Each is numbered as in that section. All but OQ14 are closed; OQ5–OQ11, OQ13 and OQ15 were closed on 26 September 2026, under the owner's delegation.

1. **OQ1 Gold clock without a turn timer:** closed by OD19. Always on. The [turn clock](TURN_CLOCK.md#modes-without-bots) document says the same.
2. **OQ2 The active player's clock during gold picks:** closed by OD19. It pauses, as during discards.
3. **OQ3 Clock default for a pending robber-or-pirate move, and for the pirate's victim:** closed by OD26.
4. **OQ4 Clock default for Road Building pieces still owed:** closed by OD26.
5. **OQ5 An absent player during the setup draft:** closed by M7. The setup piece is a road, or a ship if no road is legal.
6. **OQ6 The attachment check on a ship move:** closed by OD14. A move may not detach another of your ships.
7. **OQ7 Complex ship networks:** closed by OD12. The procedure applies to any network.
8. **OQ8 A loop or ring through an opponent's building:** closed by OD12. It is broken there.
9. **OQ9 Gold picks from an empty bank:** closed by OD17. Remaining picks lapse, and each pick must be a type the bank still holds.
10. **OQ10 Visibility of gold picks:** closed by OD19. Public once made.
11. **OQ11 Changing mode and the target:** closed by M8. "Do not fit" means too many seated players, so a room with fewer than three may switch to Open Sea and wait for more.
12. **OQ12 The Outer Isles templates:** closed. They are written in [map generation](MAP_GENERATION.md#open-sea-outer-isles), and section 4.1 of the rulebook has been checked against them.
13. **OQ13 Balance:** closed as a rules point, because it is not one. The target of 14 and the +2 bonus are to playtest after release, as the [game modes plan](GAME-MODES.md#still-open) records.
14. **OQ14 Classic's open items carry over:** the extreme cases of Road Building and Year of Plenty listed above. Still open.
15. **OQ15 A settlement placed later on an open line of ships:** closed by OD13, following SFAQ. The ends at the new settlement are recorded as closed.

An official clarification or errata for either expansion should be linked here with its date and the resulting ruleset decision.

### Mode conformance gate

Open Sea's rows are translated into executable scenarios. `tests/open-sea-reducer.test.ts` plays each rule through the reducer, every test named by its rulebook section; `tests/sea.test.ts`, `tests/sea-ships.test.ts` and `tests/gold.test.ts` test the rules module by module; `tests/open-sea-games.test.ts` plays whole three- and four-player games across seeds with every card and piece accounted for after each move; `tests/open-sea-room.test.ts` covers the lobby's board, the clocks, absences, journal replay and the restore verifier; and `tests/outer-isles-board.test.ts` checks the preset as [map generation](MAP_GENERATION.md) lists. Big Table's rows are translated the same way: `tests/big-table-rules.test.ts` plays each rule through the reducer, every test named by its rulebook section; `tests/big-table-server.test.ts` covers the room's settings, the clocks and the absence rule; `tests/big-table-e2e-paired.test.ts` and `tests/big-table-e2e-windows.test.ts` play whole five- and six-player games under each turn structure through the store and replay, verify and analyse them; and `tests/big-table-board.test.ts` checks the preset. Classic's tests and the `balanced-v2` fixture must keep passing unchanged, and do.
