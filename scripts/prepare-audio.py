"""Explicit audio-authoring tool: python prepare-audio.py <directory containing the four Kenney ZIPs>.

Requires NumPy and soundfile for authoring only. Runtime has no audio dependency.
ZIP names: casino.zip, impact.zip, rpg.zip, jingles.zip. See docs/audio/README.md.
"""
from pathlib import Path
import hashlib
import io
import json
import sys
import shutil
import subprocess
import tempfile
import zipfile
import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
ARCHIVES = Path(sys.argv[1])
OUT = ROOT / 'apps/client/public/audio/sfx'
DOCS = ROOT / 'docs/audio'
OUT.mkdir(parents=True, exist_ok=True)
(DOCS / 'licenses').mkdir(parents=True, exist_ok=True)
previous = json.loads((DOCS / 'sfx.json').read_text())['samples'] if (DOCS / 'sfx.json').exists() else []
PACKS = {
    'casino': ('casino-audio', 'f36250766ac5bc378c13708ddf12a23a8e54a3251f8d482c7536e51b5dbafa18'),
    'impact': ('impact-sounds', '029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8'),
    'rpg': ('rpg-audio', '6dbeaf8544da958d8f2adcb4a4a4b76c1ade34a05f8ab9edccd327da7375f38b'),
    'jingles': ('music-jingles', 'b729ba57959bd58793d2c5cafa348aaf2655d354f3da35ec4729e03ec77197b8'),
}
# Source recording, start/duration in seconds. Preserve transients, remove long empty tails.
CLIPS = {
    'diceRattle': ('casino', 'Audio/dice-shake-1.ogg', .07, .22),
    'diceContact': ('casino', 'Audio/die-throw-1.ogg', .153, .19),
    'wood': ('impact', 'Audio/impactWood_medium_000.ogg', 0, .23),
    'woodHeavy': ('impact', 'Audio/impactWood_heavy_000.ogg', 0, .28),
    'plank': ('impact', 'Audio/impactPlank_medium_000.ogg', 0, .30),
    'stone': ('impact', 'Audio/impactMining_001.ogg', 0, .51),
    'paperSlide': ('casino', 'Audio/card-slide-2.ogg', .008, .22),
    'paperPlace': ('casino', 'Audio/card-place-1.ogg', .092, .25),
    'paperFan': ('casino', 'Audio/card-fan-1.ogg', .018, .63),
    'cloth': ('rpg', 'Audio/cloth1.ogg', .066, .51),
    'steel': ('rpg', 'Audio/drawKnife1.ogg', .09, .31),
    'turn': ('jingles', 'Audio/Pizzicato jingles/jingles_PIZZI07.ogg', 0, 1.324),
    'award': ('jingles', 'Audio/Pizzicato jingles/jingles_PIZZI01.ogg', 0, 1.002),
    'magic': ('jingles', 'Audio/Pizzicato jingles/jingles_PIZZI02.ogg', 0, .956),
    'join': ('jingles', 'Audio/Pizzicato jingles/jingles_PIZZI00.ogg', 0, .494),
}
sha = lambda data: hashlib.sha256(data).hexdigest()
archives = {}
for name, (_, expected) in PACKS.items():
    data = (ARCHIVES / f'{name}.zip').read_bytes()
    if sha(data) != expected:
        raise ValueError(f'Unexpected source archive: {name}')
    archives[name] = zipfile.ZipFile(io.BytesIO(data))
    (DOCS / 'licenses' / f'kenney-{name}.txt').write_bytes(archives[name].read('License.txt'))
entries = []
for key, (pack, member, start, duration) in CLIPS.items():
    original = archives[pack].read(member)
    data, rate = sf.read(io.BytesIO(original), always_2d=True)
    data = data.mean(axis=1)
    data = data[round(start * rate):round((start + duration) * rate)]
    target_rate = 44100 if pack == 'jingles' else 22050
    if rate != target_rate:
        # Anti-alias before resampling; percussion retains body without wasting bandwidth above 10 kHz.
        cutoff = .45 * target_rate / rate
        taps = np.arange(-31, 32)
        kernel = 2 * cutoff * np.sinc(2 * cutoff * taps) * np.hamming(len(taps))
        data = np.convolve(data, kernel / kernel.sum(), mode='same')
        data = np.interp(np.arange(round(len(data) * target_rate / rate)) * rate / target_rate, np.arange(len(data)), data)
    # Equal peak headroom, not hard limiting. Very short ramps avoid cut-boundary clicks.
    data *= .78 / max(float(np.max(np.abs(data))), .001)
    attack, release = min(round(.001 * target_rate), len(data)), min(round(.012 * target_rate), len(data))
    data[:attack] *= np.linspace(0, 1, attack)
    data[-release:] *= np.linspace(1, 0, release)
    encoded = io.BytesIO()
    sf.write(encoded, data, target_rate, format='WAV', subtype='PCM_16')
    encoded = encoded.getvalue()
    extension = 'wav'
    if pack == 'jingles':
        with tempfile.TemporaryDirectory(prefix='catanova-stinger-') as temporary:
            original_wav, aac = Path(temporary) / 'source.wav', Path(temporary) / 'encoded.m4a'
            original_wav.write_bytes(encoded)
            if shutil.which('ffmpeg'):
                command = ['ffmpeg', '-v', 'error', '-i', str(original_wav), '-c:a', 'aac', '-b:a', '96k', str(aac)]
            else:
                command = ['/usr/bin/afconvert', str(original_wav), str(aac), '-f', 'm4af', '-d', 'aac', '-b', '96000', '-q', '127']
            subprocess.run(command, check=True)
            encoded = aac.read_bytes()
        extension = 'm4a'
    name = f'{key}.{sha(encoded)[:12]}.{extension}'
    (OUT / name).write_bytes(encoded)
    entries.append({'id': key, 'url': f'/audio/sfx/{name}', 'bytes': len(encoded), 'duration': len(data) / target_rate, 'sampleRate': target_rate,
                    'sha256': sha(encoded), 'sourceSha256': sha(original), 'source': member,
                    'pack': f'https://kenney.nl/assets/{PACKS[pack][0]}', 'archiveSha256': PACKS[pack][1],
                    'cropStart': start, 'cropDuration': duration, 'license': 'CC0-1.0'})
(DOCS / 'sfx.json').write_text(json.dumps({'creator': 'Kenney', 'channels': 1, 'samples': entries}, indent=2) + '\n')
catalog = '// Generated by scripts/prepare-audio.py from licensed recordings.\nexport const AUDIO_SAMPLES = ' + json.dumps({e['id']: {'url': e['url'], 'duration': e['duration']} for e in entries}, indent=2) + ' as const;\n'
(ROOT / 'apps/client/src/audio-samples.ts').write_text(catalog)
current = {entry['url'] for entry in entries}
for old in previous:
    if old['url'] not in current and old['url'].startswith('/audio/sfx/'):
        old_file = OUT / Path(old['url']).name
        if old_file.stem.split('.')[0] in CLIPS:
            old_file.unlink(missing_ok=True)
print(f'Exported {len(entries)} recorded samples, {sum(e["bytes"] for e in entries):,} bytes; no runtime codec dependency.')
