# Audio

Game effects use short recordings and musical stingers by **Kenney**, licensed under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The app serves the files itself; it makes no requests to the creators' websites during play. Sources checked September 11, 2026:

| Source                                                  | Used for                                         |
| ------------------------------------------------------- | ------------------------------------------------ |
| [Casino Audio](https://kenney.nl/assets/casino-audio)   | Dice shake/contacts and card handling            |
| [Impact Sounds](https://kenney.nl/assets/impact-sounds) | Wood, plank and stone construction layers        |
| [RPG Audio](https://kenney.nl/assets/rpg-audio)         | Cloth for the robber and steel for the Knight    |
| [Music Jingles](https://kenney.nl/assets/music-jingles) | Short pizzicato turn, award, magic and join cues |

The original license texts are in [licenses/](licenses/). [sfx.json](sfx.json) records every source member, source archive hash, crop, output format and output hash. These CC0 assets have their own license independent of the repository's code license. Credit is retained voluntarily; neither creator endorses Catanova.

The separate optional music loop is **The Bard's Tale** by **RandomMind**, also CC0. [MUSIC.md](MUSIC.md) records its creator's release, encoding and verification.

## Delivery and playback

- The 15 effect files total **214,245 bytes**: 11 mono 22.05 kHz PCM WAV clips and four mono 44.1 kHz AAC stingers. They warm after an audio-enabled user gesture, without delaying rendering or play.
- Music is disabled by default and has its own volume. Its **925,576-byte** AAC loop loads only after enabling music during a game. It has a 60-second download deadline for slower links; the smaller effects have an eight-second deadline. Failed downloads back off for 30 seconds.
- All audio filenames contain a 12-character SHA-256 prefix and use immutable caching. No audio is preloaded by the landing HTML. Decoded effects are cached in memory; unavailable effects use an immediate bounded synthesis fallback instead of queuing stale sounds.
- Dice contacts follow the visible bounce times. Settlements use three hammer strikes, cities heavier wood/stone, roads plank impacts, and resource/trade actions paper sounds. Short pizzicato cues identify your turn and awards.
- A user gesture unlocks the shared AudioContext. Effects and music have separate gains. Music runs as one native looping source, pauses when hidden and resumes at its saved position. Ordinary effects remain silent when hidden; `playAttention('turn' | 'warning')` permits only an explicitly requested short reminder after activation.
- `setScene('menu' | 'game')` controls music eligibility; `refresh()` applies preferences and foreground changes. `silence()` stops voices/music and aborts in-flight downloads. `dispose()` also clears buffers and closes the context. The engine caps voices and suspends when idle.

Lifecycle and timing are covered by automated tests. Asset hashes, formats and transfer budgets are checked separately. Numerical decoding checks do not establish subjective quality: browser listening, volume balance and the repeating music seam still need listening checks on supported devices.

## Explicit authoring

Download the four original ZIPs from the linked Kenney releases into a temporary directory as `casino.zip`, `impact.zip`, `rpg.zip` and `jingles.zip`. The script validates their recorded SHA-256 hashes before processing. Use a separate Python environment with NumPy and soundfile installed, plus FFmpeg or macOS `afconvert` for the four AAC stingers:

```sh
python scripts/prepare-audio.py /path/to/source-archives
```

This command is never part of a normal build. It crops selected sounds, mixes to mono, applies an antialias filter when downsampling, normalizes peaks, and adds short edge fades. It writes hashed exports, the TypeScript catalog, provenance and license copies, removing only superseded outputs recorded in the previous manifest. Source archives and temporary decoded recordings are not shipped. Encoder changes may produce new hashes; review the generated files and listen before publishing.
