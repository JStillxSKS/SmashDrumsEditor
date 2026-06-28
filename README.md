# Smash Drums Editor

A desktop chart editor for [Smash Drums](https://smashdrums.com/) custom songs. Built with React, TypeScript, Vite, and Electron.

![Smash Drums Editor](public/app-icon.jpg)

## Documentation

| Guide | Description |
|-------|-------------|
| [User Guide](docs/USER_GUIDE.md) | How to chart songs, use the highway editor, timing, and export |
| [File Formats](docs/FILE_FORMATS.md) | Import/export formats (`.indies`, `meta.json`, Clone Hero charts) |
| [Development](docs/DEVELOPMENT.md) | Setup, scripts, building the portable EXE, project layout |

## Quick start

**Requirements:** Node.js 20+, npm 10+, Windows (for portable EXE builds)

```bash
git clone https://github.com/JStillxSKS/SmashDrumsEditor.git
cd SmashDrumsEditor
npm install
npm run desktop:dev
```

**Windows shortcuts:** Run `Install Launchers.bat` once to create icon shortcuts in the project root. Batch files live in `launchers/`.

**Portable app:** Download [Smash-Drums-Editor-0.1.0-portable.exe](https://github.com/JStillxSKS/SmashDrumsEditor/releases/download/v0.1.0/Smash-Drums-Editor-0.1.0-portable.exe) (Windows x64, no install), or build with `npm run desktop:build`

## Features

- Visual highway editor with waveform overview
- Six Smash Drums lanes (hi-hat, snare, kick, cymbal, tom, clapfire)
- Four difficulties (Easy, Normal, Hard, Extreme)
- Note strengths: Crystal, Neutral, Burning
- BPM editing, auto-detect, timing anchors, and song phases
- Audio offset / silent lead-in
- Import `.indies`, `meta.json`, or Clone Hero `.chart`
- Export Smash Drums `.indies` packages or Clone Hero `notes.chart` + `song.ini`

## Disclaimer

This project is not affiliated with or endorsed by Smash Drums. Use and distribution are at your own discretion.