# Smash Drums Editor — Feature Roadmap

Full implementation plan for the 18 proposed features, mapped to the current architecture (`useEditorStore`, `ChartEditor` canvas, `waveform.ts`, Electron shell).

> **Status (2026-09-29):** several "not yet shipped" items below have since landed —
> undo/redo (`src/store/history.ts`), tap tempo (`src/utils/tapTempo.ts`), difficulty
> downchart (`src/utils/downchart.ts`), note stats (`src/utils/chartStats.ts`), BPM
> detect, and **native MIDI import** (`src/utils/midiConvert.ts` — imports `.mid` /
> `.midi` directly, same rule chain as `scripts/midi_to_smash.py`). This document is
> kept as the original plan; treat the shipped list above as ground truth.

**Already shipped (partial overlap):**
- Session recovery + draft/autosave (`SessionRecovery`, `useAutosave`, `draftStorage`)
- Copy/paste + box copy mode (`noteClipboard`, `ChartEditor`)
- Per-lane waveforms (`buildWaveformByTick`, `waveDraw`)
- Timing anchors, phases, offset, BPM detect

**Not yet shipped:** everything below.

---

## Architecture principles

1. **Undo is the foundation** — most features mutate `meta` + `charts`; wrap mutations through a history middleware before building assist tools on top.
2. **Canvas stays dumb** — new visuals (ghost notes, heatmap, phase tint) are draw-layer additions; state lives in the store or derived selectors.
3. **Audio analysis is offline** — transient detect, onset lanes, and auto-suggest run once when audio loads (or on demand), cached in refs or IndexedDB keyed by audio hash.
4. **Electron-only features degrade gracefully** — recent projects, export-and-launch, desktop import picker check `window.electronAPI`.

---

## Feature specs

### 1. Transient auto-place (assist mode)

**What:** Detect peaks per lane from `AudioBuffer`, show semi-transparent ghost notes; user accepts (`Y`/click) or rejects (`N`/right-click).

**Where:**
- New `src/utils/transientDetect.ts` — per-lane peak picking from channel or stem
- New `src/types/assist.ts` — `GhostNote { beat, id, confidence }`
- Store: `ghostNotes`, `assistMode`, `acceptGhost`, `rejectGhost`, `runTransientDetect`
- `ChartEditor` draw pass after grid, before real notes

**Deps:** Undo (PR-1)

---

### 2. Difficulty downscale

**What:** Generate Easy/Normal/Hard from Extreme using configurable rules (drop 1/2 notes, remove doubles within N ticks, cap NPS).

**Where:**
- New `src/utils/difficultyDownscale.ts`
- `SidebarLeft` or modal: preview + apply per difficulty
- Rules engine: `thinDoubles`, `keepDownbeats`, `maxNps`

**Deps:** PR-1 (undo for apply)

---

### 3. Undo / redo

**What:** `Ctrl+Z` / `Ctrl+Y` for chart edits, paste, offset, anchors, phases, metadata fields.

**Where:**
- New `src/store/history.ts` — snapshot `{ meta, charts }` (exclude audio blobs/URLs)
- Middleware on `useEditorStore` or explicit `commit()` wrapper
- Cap stack at ~50 entries; coalesce rapid offset nudges within 300ms
- `Toolbar` + `SidebarRight` hints

**This unblocks:** 1, 2, 4, 5, 11, 12, 17

---

### 4. Pattern library

**What:** Save selection as named pattern; stamp at strike bar from library panel.

**Where:**
- Extend `NoteClipboardPayload` → `Pattern { id, name, notes, anchorBeat }`
- New `src/utils/patterns.ts` — persist to `localStorage` / Electron `output/patterns.json`
- New `PatternsPanel` in left sidebar
- Reuse `pastePayloadAtStrikeTick`

**Deps:** PR-1, existing copy selection

---

### 5. Mirror / flip lanes

**What:** Swap lane mapping (e.g. snare ↔ clapfire) or mirror selection across beat axis.

**Where:**
- New `src/utils/laneMirror.ts` — `LANE_SWAP_PAIRS`, `mirrorNotes(notes, mode)`
- Context action on selection or toolbar button
- Optional: mirror chart time (reverse beat order in range) for fills

**Deps:** PR-1, selection infra (box copy exists)

---

### 6. Tap tempo while listening

**What:** Press `T` (or foot pedal key) on beats during playback; builds anchors from median interval.

**Where:**
- New `src/utils/tapTempo.ts`
- Store: `tapTempoActive`, `tapTimes[]`, `commitTapAnchors`
- Overlay in `Toolbar` when active; converts taps → `SongTiming` anchors at snapped beats

**Deps:** PR-1

---

### 7. Offset wizard

**What:** Guided flow: play from beat 0, user taps first obvious hit, set offset automatically.

**Where:**
- New `OffsetWizardModal` — 3-step UI in `SidebarLeft` Offset section
- Reuses tap listener from #6 or single-click capture
- Calls `setOffset` + `resyncAfterTimingChange`

**Deps:** #6 tap infra (can share), PR-1

---

### 8. A/B offset compare

**What:** Hold a key to preview alternate offset without committing.

**Where:**
- Store: `offsetAB: { a, b, activeSlot }`
- `Toolbar`/`SidebarLeft`: "Save A" / "Save B" / hold `Shift+[`/`]` to audition B
- Playback loop uses `getSongOffset` override during preview

**Deps:** PR-1 (optional; preview can be read-only)

---

### 9. Stem onset lanes

**What:** Faint tick marks per lane where transients detected (dimmer than ghost notes).

**Where:**
- Share `transientDetect.ts` with #1
- `ChartEditor` draw: small ticks at lane center
- Toggle in `SidebarRight` View section

**Deps:** #1 analysis module

---

### 10. Playtest mode

**What:** Full-screen highway; notes scroll; `1`–`6` scoring early/late/miss with timing windows.

**Where:**
- New `src/components/PlaytestView.tsx` — route or overlay (`appMode: 'edit' | 'playtest'`)
- Reuse `ChartEditor` draw + `drumHits` + scroll from audio
- New `src/utils/playtestScore.ts` — windows in ms from strike bar

**Deps:** Stable timing map (already have)

---

### 11. Density heatmap

**What:** Song overview bar colored by notes-per-measure.

**Where:**
- `SongOverview.tsx` — precompute `density[measure]` from active difficulty (or all)
- Color gradient in overview draw pass

**Deps:** None

---

### 12. Strength batch tools

**What:** Select tick range → apply strength to all notes in range.

**Where:**
- Reuse selection rect from copy mode
- Store: `batchSetStrength(minTick, maxTick, strength)`
- Small panel in `SidebarLeft` when selection active

**Deps:** PR-1, selection infra

---

### 13. Phase-driven visuals

**What:** Highway accent color / lane glow driven by active `SongPhase` + `power`.

**Where:**
- `ChartEditor` draw: interpolate `phaseById` color into lane header + grid tint
- Already have phase blink on cross; extend to sustained tint between phases

**Deps:** None

---

### 14. Chart from reference (overlay)

**What:** Load MIDI or `.chart` as read-only overlay (dimmed gems).

**Where:**
- New `src/utils/referenceOverlay.ts` — parse to `ChartNote[]`
- Store: `referenceNotes`, `referenceVisible`, `loadReference`
- `ChartEditor` draw pass at 25% alpha

**Deps:** chartIO / new MIDI parser (larger scope for MIDI)

---

### 15. Export preview package

**What:** One-click export to known Smash Drums custom folder; optional game launch.

**Where:**
- Electron `main.cjs`: `exportToGameFolder`, `launchSmashDrums` (registry/path config)
- Settings in `SidebarLeft`: game install path
- Reuse `exportIndies`

**Deps:** Electron only

---

### 16. Recent projects

**What:** Open last 5 imports from welcome screen or File menu.

**Where:**
- Extend `draftStorage` / new `recentProjects.json` in output folder
- `SessionRecovery` evolution → `WelcomeScreen` with recents list
- Store audio path reference (desktop) for re-link

**Deps:** Partially exists via autosave recovery

---

### 17. Measure loop

**What:** Loop playback between two beats or phase markers.

**Where:**
- Store: `loopRegion: { startBeat, endBeat } | null`
- `Toolbar` playback loop: on audio end / beat cross, `seekChartTime(loopStart)`
- Set loop from selection or phase boundaries

**Deps:** PR-1 optional

---

### 18. Note count / NPS stats

**What:** Sidebar stats: total notes, NPS per difficulty, peak measure.

**Where:**
- New `src/utils/chartStats.ts`
- `SidebarLeft` badge or collapsible Stats section
- Updates on chart/difficulty change

**Deps:** None

---

## Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Undo snapshot scope | `meta` + `charts` only | Audio buffers are huge; URLs/files unchanged by undo |
| History depth | 50 snapshots, coalesced nudges | Balance memory vs usefulness |
| Transient detect | Offline on load, cached | Avoid jank during scroll/zoom |
| Playtest | Separate overlay mode | Keeps editor UX simple |
| Patterns storage | localStorage + Electron file | Works in web dev and desktop |
| MIDI overlay | Phase 2 — CH chart overlay first | MIDI parsing is a separate project |
| Downscale | Rule-based, not ML | Predictable, charter-tunable |
| Phase visuals | Tint only, no new assets | Fits existing canvas pipeline |

---

## Open questions

1. **Playtest windows** — Fixed ±ms windows or scaled by note density / BPM?
2. **Downscale defaults** — Publish recommended rules per difficulty or ship one conservative preset?
3. **Game launch** — Hardcode Steam path heuristic vs user-picked install folder only?
4. **MIDI** — Support General MIDI drum map only, or skip MIDI v1 entirely?

---

## PR Plan

Ordered for incremental merge. Each PR is independently testable.

### PR-1: Undo / redo foundation
- **Files:** `src/store/history.ts`, `useEditorStore.ts`, `Toolbar.tsx`, `SidebarRight.tsx`
- **Changes:** History stack, wrap mutations, keyboard shortcuts, UI hint
- **Deps:** None

### PR-2: Chart stats (NPS / note count)
- **Files:** `src/utils/chartStats.ts`, `SidebarLeft.tsx`
- **Deps:** None

### PR-3: Density heatmap on overview
- **Files:** `SongOverview.tsx`, `chartStats.ts`
- **Deps:** PR-2 (shared measure aggregation)

### PR-4: Phase-driven highway tint
- **Files:** `ChartEditor.tsx`, `styles-future.css`
- **Deps:** None

### PR-5: Measure loop playback
- **Files:** `useEditorStore.ts`, `Toolbar.tsx`, `SidebarLeft.tsx`
- **Deps:** None

### PR-6: A/B offset compare
- **Files:** `useEditorStore.ts`, `SidebarLeft.tsx`, `offset.ts`
- **Deps:** PR-1 (nice-to-have)

### PR-7: Tap tempo + offset wizard
- **Files:** `tapTempo.ts`, `OffsetWizardModal.tsx`, `Toolbar.tsx`, `SidebarLeft.tsx`
- **Deps:** PR-1

### PR-8: Transient detect + onset lane ticks
- **Files:** `transientDetect.ts`, `ChartEditor.tsx`, `SidebarRight.tsx`
- **Deps:** None (audio buffer exists)

### PR-9: Assist mode (ghost notes accept/reject)
- **Files:** `assist.ts`, `ChartEditor.tsx`, `useEditorStore.ts`
- **Deps:** PR-8, PR-1

### PR-10: Pattern library
- **Files:** `patterns.ts`, `PatternsPanel.tsx`, `SidebarLeft.tsx`
- **Deps:** PR-1, copy/paste

### PR-11: Mirror / flip + strength batch
- **Files:** `laneMirror.ts`, `ChartEditor.tsx`, `SidebarLeft.tsx`
- **Deps:** PR-1, selection

### PR-12: Difficulty downscale
- **Files:** `difficultyDownscale.ts`, modal UI
- **Deps:** PR-1, PR-2

### PR-13: Playtest mode
- **Files:** `PlaytestView.tsx`, `playtestScore.ts`, `App.tsx`
- **Deps:** None

### PR-14: Reference chart overlay
- **Files:** `referenceOverlay.ts`, `ChartEditor.tsx`, import in Toolbar
- **Deps:** chartIO

### PR-15: Recent projects welcome screen
- **Files:** `recentProjects.ts`, `WelcomeScreen.tsx`, `SessionRecovery.tsx`
- **Deps:** draft/autosave infra

### PR-16: Export preview + game launch (Electron)
- **Files:** `electron/main.cjs`, settings UI, `exportIndies` hook
- **Deps:** PR-15 (paths)

### PR-17: MIDI reference overlay (optional)
- **Files:** `midiParse.ts`, import path
- **Deps:** PR-14
- **Note:** Defer unless user confirms MIDI scope

---

## Suggested build order (milestones)

| Milestone | PRs | User-visible win |
|-----------|-----|------------------|
| **M1 — Safety net** | PR-1, PR-2 | Undo + stats |
| **M2 — Timing UX** | PR-6, PR-7, PR-5 | Faster alignment workflow |
| **M3 — Charting speed** | PR-8, PR-9, PR-10, PR-11 | Assist + patterns + mirror |
| **M4 — Polish** | PR-3, PR-4, PR-12, PR-13 | Visual feedback + playtest |
| **M5 — Desktop pro** | PR-15, PR-16, PR-14 | Workflow + game loop |

**Estimated effort:** M1 ~1 week; full roadmap ~6–10 weeks part-time.

---

## Next step

Start **PR-1 (undo/redo)** — everything else gets safer and faster to iterate on.