# Entry screen slideshow: what to draw

The Catanova entry screen has one painted background today. It is becoming a
four slide crossfade, seven seconds a slide. Slide 1 already exists. This brief
is for the other three.

Read the whole of "Rules that apply to all three" before starting. Getting the
crop and the palette right matters more than the subject: these are backgrounds
behind a card, not posters.

---

## Give the generator these files first

They are the whole style guide. Nothing written below beats what is in them.

| File | What it establishes |
| --- | --- |
| `assets/source-art/title-landscape.png` | **The target.** Slide 1. Match its light, palette, brush and level of finish. |
| `assets/source-art/terrain-fantasy.png` | The six terrains exactly as the board draws them. Six tiles in a 3x2 grid. |
| `assets/source-art/sprites-fantasy.png` | The five resources, the crate, the port jetty and the boat. |
| `apps/client/public/art/optimized/painted-icons.*.webp` | Bottom row: the road, the settlement, the city, as the game draws its pieces. |

The house style is a painted storybook illustration: soft edges, warm bounce
light, no outlines, no cel shading, no flat vector, no photography, no 3D render
look. It sits somewhere near a hand painted board game box, not near concept art.

---

## Rules that apply to all three

**Format.** 1672 x 941 px PNG, RGB, no alpha channel. Exactly these dimensions,
so all four slides crossfade without any drift.

**Nothing written.** No text, numerals, logos, watermarks, signatures, UI, cursors
or frames anywhere in the image. The one exception is the number tokens in slide
2, covered there.

**No people.** No figures, no hands, no faces. The robber in slide 2 is a small
hooded shape and is the only figure allowed anywhere.

**Keep the middle quiet.** A cream card about 650 px wide sits dead centre over
these images, and a bar runs across the top. Put the subject in the lower half
or the outer thirds. The centre should be readable, unbusy ground: water, sky,
grass, table. Nothing the viewer would be annoyed to have covered.

**Light.** Warm late afternoon sun from the upper left, cool teal in the shadows.
Slide 4 is the exception and is warm lamplight after dusk.

**Palette, taken from the running game.**

| Use | Value |
| --- | --- |
| Sea | `#52bebf` |
| Forest | `#57815a` |
| Pasture | `#a0b767` |
| Fields | `#dcb95f` |
| Hills, clay | `#c57d59` |
| Mountains | `#8998a5` |
| Desert sand | `#e3c589` |
| Parchment, number tokens | `#fff0cc` |
| Player coral | `#ef7756` |
| Player sky | `#54b3dc` |
| Player violet | `#b08be4` |
| Player amber | `#f2ce56` |

Player pieces use only those four. Never invent a fifth piece colour.

---

## Slide 2: the island in play

The one the request was really about. It has to look like the game, drawn rather
than captured.

**Subject.** The hex island from above and slightly to the front, tilted maybe 20
degrees off flat so the pieces stand up and catch light, filling the lower two
thirds of the frame and running off the bottom edge. Bright turquoise sea around
it with a soft cyan glow hugging the coastline.

**The island is nineteen hexagons** packed into one larger hexagon, rows of
3-4-5-4-3. Each hex is one of the six terrains from `terrain-fantasy.png`, seen
from directly above and clipped to the hexagon, with a thin sandy shore where
the outer hexes meet the water:

- forest: dark conifers and a path
- hills: orange red clay terraces, a small winch
- pasture: bright green grass, a few white sheep, a fence
- fields: gold wheat in rows with tied sheaves
- mountains: grey blue rock peaks with small firs
- desert: pale sand dunes. **Exactly one desert on the island.**

Roughly even spread, no two of the same terrain in a solid block.

**Number tokens.** Most hexes carry a round cream disc (`#fff0cc`) sitting flat
on the tile, a little smaller than half the hex, with a number from 2 to 12 and a
row of small dots under it. Two of them read 6 and 8 in red; the rest are dark
brown. The desert has no token. Keep them small in frame and slightly soft. A
clean soft numeral is right; a crisp garbled one is worse than no detail at all.

**Pieces, in four colours.** Roads are short fat bars laid flat along the edges
between hexes, in a player colour with a darker rim, in runs of two to four.
Settlements are small houses on the corners where hexes meet, a cube with a
pitched roof. Two or three cities: a bigger building with two conical towers.
Spread coral, sky, violet and amber around the island so no one colour owns it.
Leave most corners and edges empty; a mid game board is sparse, not crowded.

**The coast.** Five or six small wooden jetties in the water just off the shore,
each a T of planks with rope rails, with a little sailing boat moored at some of
them. From `sprites-fantasy.png`, bottom row. No labels on them.

**The robber.** One small dark hooded figure standing on the desert hex. Small
enough to read as a game piece.

**Save as** `assets/source-art/title-board.png`

---

## Slide 3: the harbour

Closer in, quieter, so the sequence breathes between two wide shots.

**Subject.** A single wooden jetty from `sprites-fantasy.png` running from the
lower right into turquoise shallow water, with the little sailing boat moored
alongside, sail half furled. On the planks: an open wooden crate holding stacked
logs, a heap of orange red clay chunks and a tied wheat sheaf, all drawn exactly
as they appear in the sprite sheet. Rope coiled on the boards. Clear water with
sand and stones visible through it under the jetty.

**Frame.** Jetty and cargo in the lower right. Open water and a soft distant
green headland across the upper left, so the centre stays calm. Late sun, long
warm reflections on the water.

**Save as** `assets/source-art/title-harbour.png`

---

## Slide 4: the table after dark

Closes the loop: the island, the game, the goods, and then the room you play in.

**Subject.** A dark walnut table from a low three quarter angle. On it, out of
focus and running off the top of the frame, the edge of the hex island board,
only a hex or two readable. Nearer the camera and sharp: three or four resource
cards face up on the wood showing the logs, the clay and the sheep from the
sprite sheet, two white dice with dark pips resting beside them, a small stack
of face down cards with a patterned parchment back.

**Light.** After dusk. A string of small frosted lanterns hangs across the top of
the frame, well out of focus, throwing warm pools onto the table. Soft bokeh, no
visible wire detail, no bulb filaments. The rest of the room falls away to dark
brown. This is the one slide that is warm rather than bright.

**Frame.** Cards and dice in the lower left third. The upper right stays dark and
empty. The centre is plain lit table.

**Save as** `assets/source-art/title-table-dusk.png`

---

## Things that have gone wrong before, so please check

- **A fifth colour appearing on the pieces.** Only coral, sky, violet, amber.
- **Two deserts, or none.** Exactly one.
- **A crowded board.** Most edges and corners are empty in a real mid game.
- **Hexes drawn as flat colour.** Every hex is a painted scene clipped to a hexagon.
- **Tokens rendered as garbled type.** Soft and small beats sharp and wrong.
- **A busy centre.** The card covers it. Check by masking the middle 650 px.
- **Alpha channel.** The pipeline compares transparency and will reject the file.

---

## Handing them back

Drop the three PNGs into `assets/source-art/` under the names above. That is the
whole handover; the encoding, hashing, manifest entries and wiring are done on
this side with `scripts/optimize-art.mjs` and `apps/client/src/TitleScenery.tsx`.

If a file has to be redone later, the same name is fine. The pipeline hashes
content, so a new version gets a new URL by itself.
