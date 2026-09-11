# Music

Catanova includes one instrumental loop for optional background music: **The
Bard's Tale**, by **RandomMind**. The composer describes it as a peaceful,
positive fantasy piece and tags lute and flute. This is the original
instrumental release, separate from the composer's chiptune arrangement.
[Creator's release](https://opengameart.org/content/medieval-the-bards-tale).

## Asset and license

| Field                     | Value                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| App URL                   | `/audio/music/bards-tale.895a05b93cf9.m4a`                                                     |
| Repository file           | `apps/client/public/audio/music/bards-tale.895a05b93cf9.m4a`                                   |
| Creator                   | RandomMind                                                                                     |
| Original title            | Medieval: The Bard's Tale                                                                      |
| Original publication      | January 15, 2018                                                                               |
| License                   | CC0 1.0 Universal                                                                              |
| Source file               | [Loop_The_Bards_Tale.wav](https://opengameart.org/sites/default/files/Loop_The_Bards_Tale.wav) |
| Source checked/downloaded | September 11, 2026                                                                             |
| Duration                  | 57.72986394557823 seconds                                                                      |
| Decoded frames            | 2,545,887                                                                                      |
| Channels / sample rate    | Stereo / 44,100 Hz                                                                             |
| Delivery format           | AAC in M4A, approximately 126 kbps                                                             |
| Delivery size             | 925,576 bytes (904 KiB)                                                                        |

The creator's own upload links to [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
and expressly permits commercial projects. CC0 permits copying, modification
and redistribution, including commercial use. Keep the voluntary composer
credit with the asset so its provenance remains clear; do not imply endorsement.
The sibling `LICENSE.txt` remains available to users of the built app. This
asset's dedication is independent of the repository's code license.

## Preparation

The source is the composer's complete **loop WAV**, not an excerpt cut from the
full song. The musical arrangement, tempo and duration are unchanged. There is
no added crossfade or synthetic layer. The only processing is stereo AAC
compression using macOS Audio File Convert at 128 kbps and maximum encoder
quality:

```sh
afconvert -f m4af -d aac -b 128000 -q 127 Loop_The_Bards_Tale.wav bards-tale.895a05b93cf9.m4a
```

The source WAV is 10,183,830 bytes with SHA-256:

```text
6d0852a758dc41a763cd33b0693fa878e36d7f1d0149f7674bc82241a7a90de1
```

The shipped M4A has SHA-256:

```text
895a05b93cf988c6edd3a6eef3c9d7a27494ae9273c3e59042b1f30c2ff74770
```

The M4A is optimized for progressive reading and carries encoder priming and
remainder metadata. Native decode verification produced the same 2,545,887
valid frames as the WAV. The decoded peak is approximately −0.117 dBFS, with
no clipped samples. Its largest channel jump from the final sample back to the
first is 0.00826 on a normalized amplitude scale; the 99.9th percentile of
ordinary sample-to-sample changes is 0.08368. These checks establish duration,
headroom and the absence of a large numerical discontinuity. They do not
substitute for a listening check in the target browsers.

The downloaded WAV and temporary analysis/decoding files are not shipped or
tracked. Only the compressed asset and its license record belong in the public
music directory.

## Playback requirements

- Music is opt-in and has its own volume setting, separate from game effects.
- Fetch and decode the asset only after music is enabled and playback is
  permitted by a user interaction. Handle blocked playback without repeatedly
  prompting or throwing an unhandled error.
- Use a decoded audio buffer for continuous looping. Honor the decoder's valid
  sample range; do not add a silent padding interval between repetitions.
- Keep the background level below game effects. Fade gain briefly when starting
  or stopping; do not fade the loop itself on every repetition.
- Pause or suspend when the document is hidden and release resources on
  teardown. Changing views must not create overlapping copies.
- Verify playback and the repeated seam in Safari, Chromium and Firefox on the
  actual supported devices. Format metadata and native decoding alone do not
  establish browser behavior or subjective sound quality.
