# User Guide

Smash Drums Editor is a charting tool for creating custom drum songs compatible with Smash Drums and related export paths (Indies `meta.json`, Clone Hero charts).

## Interface overview

The editor has three main areas:

```
┌─────────────────────────────────────────────────────────────┐
│  Toolbar — playback, audio, import/export, BPM              │
├──────────┬──────────────────────────────────┬───────────────┤
│  Left    │  Highway + song overview         │  Right        │
│  sidebar │  (chart canvas)                  │  sidebar      │
│          │                                  │               │
│  Song &  │                                  │  View,        │
│  chart   │                                  │  playback,    │
│  metadata│                                  │  controls     │
│  Offset  │                                  │               │
│  Timing  │                                  │               │
└──────────┴──────────────────────────────────┴───────────────┘
```

### Toolbar

| Control | Purpose |
|---------|---------|
| **Play / Pause** | Start or stop playback from the strike bar |
| **Song / Drums** | Switch which loaded audio track drives playback |
| **Timecode** | Shows audio time and chart time at the strike bar |
| **Start** | Jump to beat 0 |
| **BPM** | Whole-number song tempo. **Sync** estimates BPM from audio; **Tap** (or key `T`) locks tempo by tapping beats while playing |
| **Song** | Load full mix audio (mp3, wav, ogg, flac, m4a, aac) |
| **Drums** | Load isolated drums stem for charting |
| **Import** | Load `.indies`, `meta.json`, or Clone Hero `.chart` |
| **Export .indies** | Download a Smash Drums Indies package (meta, audio, cover, preview) |
| **Export CH chart + song.ini** | Download Clone Hero chart and ini files |

### Left sidebar — Song & Chart

- **Artist / Title / Charter** — song metadata shown in-game
- **Album art** — loaded from Indies packages or added manually (500×500 PNG on export)
- **Difficulty** — Easy, Normal, Hard, Extreme (each has its own note chart)
- **Strength** — Crystal (0), Neutral (1), or Burning (2) for newly placed notes
- **Extreme required** — at least one Extreme note is required before export

### Left sidebar — Offset

Charts can start before audio begins (silent lead-in):

- **Lead-in (ms)** — milliseconds of silence before the song audio starts
- **Nudge buttons** — fine (±5 ms) and coarse (±50 ms) adjustments
- **`[` `]` keys** — nudge offset while editing
- **Set here** — set offset so audio starts at the current strike bar
- **Go to start** — jump to beat 0

### Left sidebar — Timing

Switch between two timing views:

**Timing anchors** — beat/time sync points (exported to Clone Hero `[SyncTrack]`). Add anchors, edit beat and timer values, or click **Place on grid** and click the highway to drop an anchor.

**Song phases** — section markers (Intro, Verse, Chorus, etc.) with intensity. Configure type, label, and intensity, then **Place on grid** to add phase boundaries on the chart.

### Right sidebar — View

- **Snap** — grid quantization (1/4 beat through whole measure)
- **Zoom** — horizontal timeline scale
- **Lane wave width** — waveform display scale in each lane

### Right sidebar — Playback

- **Speed** — playback rate (50%–150%)
- **Audio source** — Song or Drums track
- **Song volume** — mix level
- **Hit sounds** — editor preview volume for drum hits during playback

### Right sidebar — Controls

Built-in keyboard and mouse reference (also summarized below).

## Highway editor

The chart canvas shows six lanes left to right:

| Key | Lane | Color | Smash instrument |
|-----|------|-------|------------------|
| `1` | 1 | Pink | Hi-hat |
| `2` | 2 | Red | Snare |
| `3` | 3 | Blue | Kick (bass) |
| `4` | 4 | Yellow | Cymbal |
| `5` | 5 | Green | Tom |
| `6` | 6 | Orange | Clapfire |

The **strike bar** is the horizontal line near the bottom. Notes scroll toward it during playback; new notes are placed at the strike bar position.

### Placing and removing notes

| Action | How |
|--------|-----|
| Place note | Press `1`–`6`, or **Caps Lock + click** a lane |
| Remove note | **Caps Lock + click** an existing note |
| Seek playhead | Click the highway (**Caps Lock off**) |
| Copy notes | `Ctrl+C` — copies all notes visible on screen |
| Paste notes | `Ctrl+V` — pastes with the first note at the strike bar |

### Timeline navigation

| Action | How |
|--------|-----|
| Pan timeline | Mouse wheel |
| Zoom | `Ctrl` + mouse wheel |
| Step by snap | `←` `→` (strike bar), `↑` `↓` (scroll position) |
| Scrub overview | Click or drag the song overview bar below the highway |
| Cancel placement mode | `Esc` |

### Placement modes

When placing **timing anchors** or **song phases**, the highway enters placement mode (highlighted). Click the grid to drop the marker at that beat. Press `Esc` to exit.

## Typical workflow

### Start from an Indies package

1. Click **Import** and choose a `.indies` file
2. Audio, cover art, metadata, and charts load automatically
3. Select **Extreme** difficulty and chart your drums
4. Adjust offset until hits line up with the waveform
5. Set BPM and timing anchors if needed
6. Export when finished

### Start from scratch

1. Load **Song** audio (and optionally **Drums** stem)
2. Click **Sync** (from audio), use **Tap** / `T` on the beat while playing, or set BPM manually
3. Set artist, title, and charter in the left sidebar
4. Add album art if desired
5. Chart on **Extreme** first (required for export), then copy patterns to other difficulties as needed
6. Add song phases and timing anchors
7. Export `.indies` or Clone Hero files

### Start from a Clone Hero chart

1. **Import** a `.chart` file
2. Lane mapping converts Clone Hero pads to Smash Drums lanes (see [File Formats](FILE_FORMATS.md))
3. Load matching audio separately via **Song**
4. Adjust offset and continue editing

## Export requirements

Before export, the editor validates your chart:

- **Extreme difficulty must have at least one note** on every export

If validation fails, a dialog explains what to fix.

## Windows shortcuts

After cloning or downloading the project, run **`Install Launchers.bat`** once (in the project root). This creates `.lnk` shortcuts with the Smash Drums Editor icon:

| Shortcut (project root) | Action |
|-------------------------|--------|
| `Dev Smash Drums Editor.lnk` | Development mode (hot reload) |
| `Build Smash Drums Editor.lnk` | Build portable EXE |
| `Open Smash Drums Editor.lnk` | Launch built app |

The underlying batch files are in **`launchers/`**. Windows cannot assign custom icons to `.bat` files directly; the shortcuts in the project root wrap those scripts.

## Tips

- Use the **drums stem** as the audio source when charting — transients are easier to see in the lane waveforms
- **Snap to 1/8** is a good default for most drum patterns
- Use **Set here** on offset after lining up the first obvious hit with the strike bar
- The song **overview** waveform helps find sections quickly; click to jump
- Copy/paste is useful for repeating fills across measures (`Ctrl+C` / `Ctrl+V`)