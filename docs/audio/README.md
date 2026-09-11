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

## How each cue is assembled

The shipped music and effect samples were **not generated with an AI music tool or recorded for Catanova**. The work here was selecting existing CC0 audio, trimming and encoding the clips, then arranging their playback in code. The table uses sample IDs from [sfx.json](sfx.json), which maps each ID to its exact original filename. For example, `wood` is Kenney's `impactWood_medium_000.ogg`, `steel` is `drawKnife1.ogg`, and the `turn`, `award`, `magic` and `join` stingers use `jingles_PIZZI07`, `01`, `02` and `00` respectively.

Offsets below are milliseconds from the start of a cue. `×` indicates playback speed, which also changes pitch; unspecified speed is 1×. [soundLayers()](../../apps/client/src/sound.ts) contains the individual layer gains and duration caps.

| Cue                      | Sample arrangement                                                                                                                                                    | Immediate fallback if samples are unavailable                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Button tap               | `paperPlace` at 0, 1.2×, capped at 130 ms                                                                                                                             | One short falling triangle-wave tap                                                    |
| Card hover               | `paperSlide` at 0, 1.2×, capped at 140 ms                                                                                                                             | A soft filtered-noise brush and a short high tone                                      |
| Dice roll                | `diceRattle` at 25; `diceContact` at 260, 580, 830 and 1030, with quieter `wood` 19 ms after each contact. Contacts get quieter and slightly faster with each bounce. | Noise rattle plus paired falling triangle taps and noise at the same four bounce times |
| Road                     | `plank` at 0; `wood` at 100, 1.12×                                                                                                                                    | Two falling taps with a low noise impact                                               |
| Settlement               | Three `wood` strikes at 0, 190 and 390, at 1.03×, 0.97× and 1.07×                                                                                                     | Two falling taps, a noise impact and a short resolving tone                            |
| City                     | `woodHeavy` at 0, 0.94×; `stone` at 160, 0.84×; `woodHeavy` at 360, 1.02×; `wood` at 560, 0.89×                                                                       | Low tap and noise followed by three rising tones                                       |
| Receive resources        | `paperSlide` at 0; `paperPlace` at 150, 1.04×                                                                                                                         | Three rising sine-wave tones                                                           |
| Spend resources          | `paperFan` at 0, 1.12×; `paperPlace` at 180                                                                                                                           | Two filtered-noise swishes and a falling tap                                           |
| Trade                    | `paperSlide` at 0; `paperFan` at 120, 1.15×; `paperPlace` at 340                                                                                                      | A noise swish and two rising tones                                                     |
| Development card         | `paperFan` at 0; `magic` stinger at 90                                                                                                                                | Noise plus a four-note rising figure                                                   |
| Knight                   | `steel` at 0; `magic` at 150, 0.84×; `woodHeavy` at 170                                                                                                               | Filtered noise, two triangle-wave tones and one higher sine tone                       |
| Move robber              | `cloth` at 0; `woodHeavy` at 200, 0.76×                                                                                                                               | Low filtered noise, a descending triangle tone and a low tap                           |
| Your turn                | `turn` pizzicato stinger at 0                                                                                                                                         | Two rising tones                                                                       |
| Award                    | `award` stinger at 0; `magic` at 660, 1.12×                                                                                                                           | Four rising tones                                                                      |
| Win                      | `award` at 0; `turn` at 880                                                                                                                                           | A seven-note rising and resolving figure                                               |
| Warning / timer reminder | `wood` taps at 0 and 190, at 1.3× and 1.12×                                                                                                                           | Two matching falling taps 180 ms apart                                                 |
| Error                    | `woodHeavy` at 0, 0.72×                                                                                                                                               | One low falling tap                                                                    |
| Player joins             | `join` pizzicato stinger at 0                                                                                                                                         | Two rising tones                                                                       |

The fallback column describes the small Web Audio score in [soundScore()](../../apps/client/src/sound.ts): sine/triangle oscillators and generated noise, with short volume envelopes and low-pass filtering. It is not a second set of recordings. A cue uses its complete sample arrangement only when all its clips are decoded; otherwise that event uses synthesis immediately. The newly downloaded samples are used for later events, never played late over a different move.

For sample preparation, [prepare-audio.py](../../scripts/prepare-audio.py) applies the exact source crops in the manifest, averages source channels to mono, and uses a 63-tap windowed-sinc antialias filter before resampling when needed. Each cropped clip is peak-normalized to 0.78 of full scale (about −2.16 dBFS) before adding a 1 ms attack and 12 ms release fade. This is peak normalization, not equal-perceived-loudness mastering or hard limiting. Foley becomes 16-bit PCM WAV at 22.05 kHz; the four jingles become 44.1 kHz mono AAC at 96 kbps. Playback combines per-layer gains with the user's effects volume.

There is **one background music track**: RandomMind's complete 57.73-second _The Bard's Tale_ loop. Its arrangement, tempo and duration were left intact; the stereo WAV was compressed to AAC at a requested 128 kbps, with no added musical layers or loop crossfade. It plays through one native looping source with a volume fade at start/stop, not a newly generated composition. The source, encoding command and hashes are in [MUSIC.md](MUSIC.md).

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
