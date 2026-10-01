# Mobile / APK feedback backlog

**Process:** Collect notes here. Ship in **bulk** when ready — not one-by-one pushes.

---

## How to add items

- Append under **Open** with date + short note.
- When bulk ships, move items to **Done**.

---

## Open

_(none)_

---

## Done

### Batch 2 — 2026-09-29 (MIDI import + real OGG audio)

| Item | Resolution |
|------|------------|
| MP3 (etc.) in, real OGG out | **Fixed.** `buildIndiesZip` now transcodes non-Ogg audio to real Ogg Vorbis with ffmpeg.wasm (`src/utils/audioTranscode.ts`, encoder lazily loaded from `public/ffmpeg/`, copied on install by `scripts/copy-ffmpeg-core.cjs`). Ogg sources pass through untouched. `meta.json` `FilePath` now matches the packaged audio name (`audio.ogg`). |
| MIDI drums → chart | **Removed.** In-app `.mid` / `.midi` import (`src/utils/midiConvert.ts`) was deleted — output quality was poor. Replaced by **Auto-Chart from audio** (desktop): the Auto-Charter Python CLI generates a draft `.indies` from a song file, imported straight into the editor. |

### Batch 1 — 2026-07-15 (mobile smoothness + layout)

| Item | Resolution |
|------|------------|
| Portrait vs landscape choice | **Removed.** Single **Mobile charting** shell (tall highway + side overview). Old portrait/landscape prefs migrate to `mobile`. |
| Landscape-on-portrait-lock looks better | That shell is now **the** mobile layout. |
| More highway / less bottom buffer | Side overview only on mobile; no bottom scroll strip. |
| Tool hint blocks highway | **Tap to dismiss** + **auto-hide after 10s**; shows again when Edit/Seek tool changes. |
| Audio lag / heavy phone | Cap canvas DPR 1.25; flat gems/receptors (no gradients/shadows); single mono wave strip; cheaper strike/phase cues; coarser wave peaks; overview simplified. |
| Gradients / simplify wave / lighter strike | As above. |

---

## Parked / later

_(none)_
