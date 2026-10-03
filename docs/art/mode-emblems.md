# The game-mode emblems

Each game mode has a painted emblem: a small floating island in the hand-painted style of the Catanova logo. The
room shows the room's mode with its emblem in the banner beside Start (`Lobby.tsx`, `mode-chooser.css`); the mode
chooser itself shows each mode's real board instead (`ModeBoard.tsx`).

| Master                                         | What it shows                                                                                            | Browser file                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `assets/source-art/mode-emblems/classic.png`   | One hexagonal island: wheat, pine forest, a grey mountain, red clay, sheep pasture, a red-roofed cottage | `apps/client/public/art/optimized/mode-emblem-classic.61d640b72787.webp`   |
| `assets/source-art/mode-emblems/big-world.png` | A larger island with fields, forests, mountains, a desert, roads and six cottages in six roof colours    | `apps/client/public/art/optimized/mode-emblem-big-world.3ca68fd7e99b.webp` |
| `assets/source-art/mode-emblems/open-seas.png` | Three small islands on a round patch of sea, one veined with gold, two sailing ships and a pirate ship   | `apps/client/public/art/optimized/mode-emblem-open-seas.36e342521043.webp` |

## Making them

Drafted on 3 October 2026 with gpt-image-2.5-flare (1024 × 1024, transparent background), each prompt describing
its island as "a chunky floating diorama tile with visible earthy side thickness" in "hand-painted storybook gouache
style matching a warm golden logo: thick soft brown outlines, warm watercolor texture", ending "No text, no
letters, no frame, transparent background". The owner approved the drafts in the room. The masters are
gpt-image-2.5-sunburst edits of those drafts, asked to keep the composition, every element and the colours exactly
and only to refine the edges and detail, saved unchanged:

| Master          | Bytes     | SHA-256                                                            |
| --------------- | --------- | ------------------------------------------------------------------ |
| `classic.png`   | 1,969,390 | `0c8074d353fc25857876654c316724e9b287ef0af356d6554af8fc88fa30cc8f` |
| `big-world.png` | 2,050,284 | `143fe04dc2282aa82eeb82479a1ab5d20b424d5b80eed2ac481e83048112305a` |
| `open-seas.png` | 1,867,993 | `1db23daa09c1eec75ac6ba27279c6e2ebd5574b08477c394a824d58ce50faff0` |

The browser files are 256 × 256 exports, made as [Runtime artwork](RUNTIME.md#mode-emblems) describes.
