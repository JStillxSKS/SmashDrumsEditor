# File Formats

Smash Drums Editor reads and writes several formats used by Smash Drums Indies content and Clone Hero tooling.

## Import

Use **Import** in the toolbar. Accepted extensions: `.indies`, `.json`, `.chart`

### `.indies` (Smash Drums Indies package)

A ZIP archive containing:

| File | Description |
|------|-------------|
| `meta.json` | Song metadata and all difficulty charts |
| `audio.ogg` | Full song audio |
| `cover.png` | 500×500 album art |
| `preview.wav` | 12-second menu preview (22050 Hz mono) |

On import, metadata, charts, audio, and cover load into the editor.

### `meta.json` (Indies metadata)

Standalone metadata file with chart arrays embedded:

```json
{
  "NameArtist": "Artist",
  "NameSong": "Song Title",
  "NameCharter": "Charter",
  "FilePath": "audio.ogg",
  "SongOffsetSeconds": 0.0,
  "SongTiming": [{ "beat": 0, "timer": 0 }],
  "SongPhases": [],
  "ChartEasy": [],
  "ChartNormal": [],
  "ChartHard": [],
  "ChartExtreme": [{ "Beat": 4, "Id": 1, "Strength": 1 }]
}
```

Load audio separately via **Song** if `FilePath` is set.

### Clone Hero `.chart`

Moonscraper / Clone Hero text chart. The editor parses:

- `[Song]` metadata
- `[SyncTrack]` timing anchors
- `[ExpertDrums]` (and other `*Drums` sections) note data

Clone Hero lane numbers are remapped to Smash Drums instrument IDs (see lane table below).

## Export

### Export .indies

Downloads a Smash Drums Indies ZIP package containing:

| File | Description |
|------|-------------|
| `meta.json` | Song metadata and all four difficulty charts |
| `audio.ogg` | Loaded song audio |
| `cover.png` | Album art (500×500), if set |
| `preview.wav` | 12-second menu preview clip |

Requirements:

- At least one note on **Extreme**
- **Song** audio must be loaded (use **Song**, not the drums stem)

The download filename is based on the song title (e.g. `My Song.indies`).

### Export CH chart + song.ini

Downloads two files:

1. **`notes.chart`** — Clone Hero format with `[SyncTrack]` and per-difficulty drum sections (`EasyDrums`, `MediumDrums`, `HardDrums`, `ExpertDrums`)
2. **`song.ini`** — Clone Hero song metadata

Audio is referenced as `song.ogg` in the chart. Place your audio file alongside the chart in a Clone Hero song folder.

## Chart note format

Each note in `meta.json` chart arrays:

| Field | Type | Description |
|-------|------|-------------|
| `Beat` | number | Beat position (480 ticks per beat internally) |
| `Id` | 0–5 | Smash Drums instrument ID |
| `Strength` | 0–2 | 0 = Crystal, 1 = Neutral, 2 = Burning |

## Instrument IDs

| Id | Name | Description |
|----|------|-------------|
| 0 | Bass | Blue kick drum |
| 1 | Snare | Red snare |
| 2 | Cymbal | Yellow cymbal |
| 3 | Tom | Green tom |
| 4 | Hi-hat | Pink hi-hat |
| 5 | Clapfire | Orange clapfire |

## Highway lane layout

Left to right on the editor highway:

```
Hi-hat (4) | Snare (1) | Kick (0) | Cymbal (2) | Tom (3) | Clapfire (5)
```

## Clone Hero lane mapping

| Smash Id | CH Expert pad | Cymbal flag | Exported to CH |
|----------|---------------|-------------|----------------|
| 4 Hi-hat | 2 (yellow) | yes (+64) | yes |
| 1 Snare | 1 | no | yes |
| 0 Kick | 0 | no | yes |
| 2 Cymbal | 3 (blue) | yes (+64) | yes |
| 3 Tom | 4 (green) | no | yes |
| 5 Clapfire | — | — | no (Smash-only) |

Clone Hero cymbal notes use lane + 64 (e.g. yellow cymbal = 66).

## Timing

- **Resolution:** 480 ticks per beat (Clone Hero standard)
- **SongTiming anchors:** `{ beat, timer }` pairs defining tempo map
- **SongPhases:** `{ beat, phase, power, phaseName }` section markers
- **SongOffsetSeconds:** seconds of chart time before audio begins

## Audio files

Supported for manual load: mp3, wav, ogg, flac, m4a, aac

Indies packages expect `audio.ogg`. Clone Hero exports reference `song.ogg`.