# MIDI → Smash Drums Converter

Turn General MIDI drum tracks into Smash Drums Editor charts (`.indies`).

## In the editor (no Python needed)

**Import → pick a `.mid` / `.midi` file** (or drag it onto the Home screen).
The editor converts it in-app using the same rule chain as the Python script
below — charts match the converter output note-for-note. Song audio is
auto-detected next to the MIDI (`song.ogg`, `Artist - Song.mp3`, …); otherwise
load it with **🎵 Song** after import.

What you get: Extreme on the MIDI's hits (snapped to the 1/16 grid), plus
auto-thinned Hard / Normal / Easy, a tempo map with integer-beat anchors
(multi-tempo MIDIs keep every tempo change that lands on a whole beat), and
 Neutral-strength notes throughout. Everything is editable after import.

## From the command line

The bundled script does the same conversion with more knobs (audio tempo-fit,
BPM override, batch folders, `.chart` + `song.ini` output):

1. **Drag and drop** one or more `.mid` files onto  
   **`Desktop\Convert MIDI to Smash.bat`**
2. Open **Smash Drums Editor** → **Import** → pick the new `.indies`  
   (saved under `Desktop\Smash Drums Editor\output\`)

First run installs Python packages (`mido`, `numpy`, `soundfile`, `Pillow`) if needed.

## Command line

```bat
cd Desktop\SmashDrumsEditor
python scripts\midi_to_smash.py path\to\drums.mid
python scripts\midi_to_smash.py drums.mid --audio song.ogg
python scripts\midi_to_smash.py drums.mid --artist "Band" --title "Song" --charter "You"
python scripts\midi_to_smash.py drums.mid --offset 0.08 --bpm 160
python scripts\midi_to_smash.py drums.mid --inspect
```

### Options

| Flag | Meaning |
|------|---------|
| `--audio` / `-a` | Full-mix audio (`.ogg` preferred). Also auto-finds `song.ogg` next to the MIDI. |
| `--artist` | Artist (default: guess from filename) |
| `--title` | Title (default: guess from filename) |
| `--charter` / `-c` | Charter name (default: `MIDI Convert`) |
| `--offset` | Song offset in seconds |
| `--bpm` | Override MIDI tempo |
| `--out` / `-o` | Output directory |
| `--no-downchart` | Copy Extreme into all difficulties |
| `--open` | Open output folder when done |
| `--inspect` | Print MIDI note map only (no convert) |

## What gets written

For each song:

```
Smash Drums Editor\output\
  Song Title.indies          ← import this
  Song Title\
    meta.json
    notes.chart
    song.ini
    audio.ogg                ← if audio was found
    cover.png
    preview.wav
```

## Lane mapping (GM → Smash)

| Smash | Instruments (GM notes) |
|-------|------------------------|
| Kick (0) | 35, 36 |
| Snare (1) | 37, 38, 40 |
| Cymbal (2) | 49, 51, 52, 53, 55, 57, 59 |
| Tom (3) | 41, 43, 45, 47, 48, 50 |
| Hi-hat (4) | 42, 44, 46 |
| Clapfire (5) | 39, 54, 56 |

If a MIDI has no toms (or no hats, etc.), that lane will be empty — the converter only maps what is in the file.

## Tips

- Stem filenames like `Artist__Song_drums_123.mid` auto-fill artist/title.
- **Start lines up but notes fall behind** → chart BPM is too low (common: MIDI says 160, song is ~163). Raise BPM in the editor, or reconvert with `--bpm 163.5`.
- **Everything early/late by a fixed amount** → tweak **Song Offset** (or `--offset`).
- With `--audio`, the converter tries to fit tempo from the mix automatically.
- Extreme = every mapped hit. Hard / Normal / Easy are auto-thinned unless `--no-downchart`.
