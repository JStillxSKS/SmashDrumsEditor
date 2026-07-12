import { create } from "zustand";
import type {
  ChartNote,
  Difficulty,
  MetaJson,
  PhasePlacement,
  PlacementMode,
  SongPhase,
  TimingAnchor,
} from "../types/meta";
import {
  clampPhaseId,
  clampPower,
  phaseById,
  sortSongPhases,
} from "../types/meta";

import { validateIndiesCharts } from "../utils/chartNotes";
import { chartsWithAutoDownchart, generateLowerDifficulties } from "../utils/downchart";
import { buildChartText, isChartFile, parseChartFile } from "../utils/chartIO";
import {
  fileSystemPath,
  isOutputFolderPath,
  joinOutputPath,
} from "../utils/fileSystemPath";
import {
  getOutputFolder,
  openOutputFolder,
  saveBlobFile,
  saveTextFile,
} from "../utils/fileSave";
import { buildSongIni } from "../utils/songIniIO";
import {
  chartsFromMeta,
  createEmptyMeta,
  parseMetaJson,
  prepareMetaForExport,
} from "../utils/metaIO";
import { seekChartTime } from "../utils/audioElement";
import { publishIndiesPackage, type PublishResult } from "../lib/indiesDbPublish";
import { supabase } from "../lib/supabase";
import {
  buildIndiesZip,
  parseIndiesFile,
  sanitizeIndiesFilename,
} from "../utils/indiesIO";
import { importViewState } from "../utils/importView";
import { isRlrrFile, parseRlrrFile } from "../utils/paradiddleIO";
import { loadSiblingFile } from "../utils/siblingFile";
import {
  FIXED_PIXELS_PER_TICK,
  RESOLUTION,
  beatToTick,
  beatsEqual,
  clampPixelsPerTick,
  snapBeat,
  snapTick,
} from "../utils/resolution";
import { editorAudioContext } from "../utils/editorAudioContext";
import { editorAudioPlayer, syncEditorAudioPlayerFromState } from "../utils/editorAudioPlayer";
import { clampPlaybackSpeed } from "../utils/playbackSpeed";
import { INDIES_AUDIO_FILE } from "../utils/audioFormat";
import type { AudioSource } from "../utils/audioSource";
import { detectBpm } from "../utils/bpmDetect";
import {
  mergeNotes,
  notesInSelectionRect,
  notesInTickRange,
  parseClipboard,
  pastePayloadAtStrikeTick,
  selectionFirstBeat,
  serializeClipboard,
  type NoteClipboardPayload,
} from "../utils/noteClipboard";
import {
  estimateBpmFromTapTimes,
  offsetDeltaToSnapTapToBeat,
  TAP_TEMPO_MAX_TAPS,
  TAP_TEMPO_MIN_TAPS,
  type TapTempoEstimate,
} from "../utils/tapTempo";
import { getSongOffset } from "../utils/offset";

import {
  applyConstantBpmChange,
  beatToTime,
  bpmFromAnchors,
  sortTimingAnchors,
  timeToBeat,
} from "../utils/timing";
import {
  clearHistory,
  commitHistory,
  extractSnapshot,
  redo as historyRedo,
  undo as historyUndo,
  type HistoryTag,
} from "./history";

type EditorState = {
  meta: MetaJson;
  charts: Record<Difficulty, ChartNote[]>;
  difficulty: Difficulty;
  selectedLane: 0 | 1 | 2 | 3 | 4 | 5;
  strength: 0 | 1 | 2;
  snapTicks: number;
  scrollTick: number;
  pixelsPerTick: number;
  /** Vertical wave scale — independent of snap; follows zoom slider only */
  wavePixelsPerTick: number;
  waveScale: number;
  /** Loaded song playback volume (0–1) */
  songVolume: number;
  /** Editor preview volume for strike-bar drum hits (0–1) */
  hitVolume: number;
  /** Preview playback speed — audio + highway scroll (0.25–2) */
  playbackSpeed: number;
  audioUrl: string | null;
  audioFileName: string | null;
  audioFile: File | null;
  audioBuffer: AudioBuffer | null;
  coverImageUrl: string | null;
  coverImageFileName: string | null;
  coverImageFile: File | null;
  drumsAudioUrl: string | null;
  drumsAudioFileName: string | null;
  drumsAudioBuffer: AudioBuffer | null;
  audioSource: AudioSource;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  bpmDetecting: boolean;
  bpmConfidence: number | null;
  /** Tap-to-sync: chart times of registered taps */
  tapTempoActive: boolean;
  tapTempoTimes: number[];
  placementMode: PlacementMode;
  pendingPhasePlacement: PhasePlacement;
  noteClipboard: NoteClipboardPayload | null;
  clipboardMessage: string | null;
  exportingIndies: boolean;
  publishingIndies: boolean;
  /** Desktop: target .indies path in the output folder. */
  sourceIndiesPath: string | null;
  /** Bumped when undo/redo stack changes — subscribe for toolbar hints */
  historyVersion: number;

  undo: () => void;
  redo: () => void;
  setMetaField: <K extends keyof MetaJson>(key: K, value: MetaJson[K]) => void;
  setBpm: (bpm: number) => void;
  /** Detect whole BPM from song audio and apply (grid-locked notes). */
  detectBpmFromAudio: () => Promise<number | null>;
  /** Alias of detect — “Sync BPM from audio”. */
  syncBpmFromAudio: () => Promise<number | null>;
  startTapTempo: () => void;
  cancelTapTempo: () => void;
  /** Register a tap at current chart time; returns live estimate. */
  registerTapTempo: (chartTime?: number) => TapTempoEstimate | null;
  /** Apply whole BPM from taps; snaps first tap to nearest beat via offset. */
  commitTapTempo: (snapOffsetToFirstTap?: boolean) => number | null;
  getTapTempoEstimate: () => TapTempoEstimate | null;
  setDifficulty: (d: Difficulty) => void;
  setSelectedLane: (lane: 0 | 1 | 2 | 3 | 4 | 5) => void;
  setStrength: (s: 0 | 1 | 2) => void;
  setSnapTicks: (ticks: number) => void;
  setScrollTick: (tick: number) => void;
  setPixelsPerTick: (v: number) => void;
  setWaveScale: (v: number) => void;
  setSongVolume: (v: number) => void;
  setHitVolume: (v: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  setOffset: (seconds: number) => void;
  nudgeOffset: (delta: number) => void;
  setOffsetFromPlayhead: () => void;
  goToChartStart: () => void;
  setCurrentTime: (t: number) => void;
  setIsPlaying: (p: boolean) => void;
  loadAudio: (file: File) => Promise<void>;
  loadDrumsAudio: (file: File) => Promise<void>;
  loadCoverImage: (file: File) => Promise<void>;
  clearCoverImage: () => void;
  setAudioSource: (source: AudioSource) => void;
  loadMeta: (file: File) => Promise<void>;
  loadChart: (file: File) => Promise<void>;
  exportIndies: () => Promise<void>;
  publishToIndiesDb: (explicit?: boolean) => Promise<PublishResult>;
  exportChart: () => void;
  generateLowerDifficultiesFromExtreme: (force?: boolean) => void;
  toggleNote: (beat: number, id: 0 | 1 | 2 | 3 | 4 | 5) => void;
  removeNote: (beat: number, id: 0 | 1 | 2 | 3 | 4 | 5) => void;
  getActiveNotes: () => ChartNote[];
  updatePhase: (index: number, patch: Partial<SongPhase>) => void;
  addPhase: () => void;
  addPhaseAtPlayhead: () => void;
  removePhase: (index: number) => void;
  updateAnchor: (index: number, patch: Partial<TimingAnchor>) => void;
  addAnchor: () => void;
  addAnchorAtPlayhead: () => void;
  removeAnchor: (index: number) => void;
  setPlacementMode: (mode: PlacementMode) => void;
  setPendingPhasePlacement: (patch: Partial<PhasePlacement>) => void;
  placePhaseAtBeat: (beat: number) => void;
  placeAnchorAtBeat: (beat: number) => void;
  copyNotesInRange: (minTick: number, maxTick: number) => Promise<number>;
  copyNotesInSelection: (
    anchorTick: number,
    currentTick: number,
    anchorCol: number,
    currentCol: number
  ) => Promise<number>;
  deleteNotesInSelection: (
    anchorTick: number,
    currentTick: number,
    anchorCol: number,
    currentCol: number
  ) => number;
  pasteNotesAtStrikeTick: (strikeTick: number) => Promise<number>;
  clearClipboardMessage: () => void;
};


const initialMeta = createEmptyMeta();
const initialCharts = { easy: [], normal: [], hard: [], extreme: [] } as Record<
  Difficulty,
  ChartNote[]
>;
function bumpHistoryVersion(version: number, changed: boolean): number {
  return changed ? version + 1 : version;
}

export const useEditorStore = create<EditorState>((set, get) => {
  const recordHistory = (tag: HistoryTag) => {
    const state = get();
    const changed = commitHistory(extractSnapshot(state), tag);
    if (changed) set({ historyVersion: bumpHistoryVersion(state.historyVersion, true) });
  };

  const resetHistoryStack = () => {
    clearHistory();
    set({ historyVersion: get().historyVersion + 1 });
  };

  return {
  meta: initialMeta,
  charts: initialCharts,
  difficulty: "extreme",
  selectedLane: 1,
  strength: 1,
  snapTicks: 240,
  scrollTick: 0,
  pixelsPerTick: FIXED_PIXELS_PER_TICK,
  wavePixelsPerTick: FIXED_PIXELS_PER_TICK,
  waveScale: 1.4,
  songVolume: 1,
  hitVolume: 0.75,
  playbackSpeed: 1,
  audioUrl: null,
  audioFileName: null,
  audioFile: null,
  audioBuffer: null,
  coverImageUrl: null,
  coverImageFileName: null,
  coverImageFile: null,
  drumsAudioUrl: null,
  drumsAudioFileName: null,
  drumsAudioBuffer: null,
  audioSource: "song",
  duration: 0,
  currentTime: 0,
  isPlaying: false,
  bpmDetecting: false,
  bpmConfidence: null,
  tapTempoActive: false,
  tapTempoTimes: [],
  placementMode: null,
  pendingPhasePlacement: {
    phase: 2,
    power: 0.5,
    phaseName: phaseById(2).label,
  },
  noteClipboard: null,
  clipboardMessage: null,
  exportingIndies: false,
  publishingIndies: false,
  sourceIndiesPath: null,
  historyVersion: 0,

  undo: () => {
    const state = get();
    const restored = historyUndo(extractSnapshot(state));
    if (!restored) return;
    set({
      meta: restored.meta,
      charts: restored.charts,
      historyVersion: state.historyVersion + 1,
    });
  },

  redo: () => {
    const state = get();
    const restored = historyRedo(extractSnapshot(state));
    if (!restored) return;
    set({
      meta: restored.meta,
      charts: restored.charts,
      historyVersion: state.historyVersion + 1,
    });
  },

  setMetaField: (key, value) => {
    recordHistory("meta");
    set((s) => ({ meta: { ...s.meta, [key]: value } }));
  },

  setBpm: (bpm) => {
    const state = get();
    const { meta, charts, changed } = applyConstantBpmChange(state.meta, state.charts, bpm);
    if (!changed) return;
    recordHistory("timing");
    // Notes stay on the same beats; keep the strike bar on that beat while
    // the tempo map retimes relative to the audio (integer BPM only).
    const strikeBeat = state.scrollTick / RESOLUTION;
    const nextTime = beatToTime(strikeBeat, meta.SongTiming);
    set({
      meta,
      charts,
      currentTime: nextTime,
      bpmConfidence: null,
    });
  },

  detectBpmFromAudio: async () => {
    const { audioBuffer } = get();
    if (!audioBuffer) return null;
    set({ bpmDetecting: true, tapTempoActive: false, tapTempoTimes: [] });
    try {
      await new Promise((r) => setTimeout(r, 0));
      const { bpm, confidence } = detectBpm(audioBuffer);
      const state = get();
      const prevBpm = bpmFromAnchors(state.meta.SongTiming);
      const { meta, charts, changed } = applyConstantBpmChange(state.meta, state.charts, bpm);
      if (!changed) {
        set({
          bpmDetecting: false,
          bpmConfidence: confidence,
          clipboardMessage: `BPM Sync: already ${bpm} (confidence ${Math.round(confidence * 100)}%)`,
        });
        return bpm;
      }
      recordHistory("timing");
      const strikeBeat = state.scrollTick / RESOLUTION;
      const nextTime = beatToTime(strikeBeat, meta.SongTiming);
      set({
        meta,
        charts,
        currentTime: nextTime,
        bpmDetecting: false,
        bpmConfidence: confidence,
        clipboardMessage: `BPM Sync: ${prevBpm} → ${bpm} (confidence ${Math.round(confidence * 100)}%) — notes stayed on beats`,
      });
      return bpm;
    } catch {
      set({
        bpmDetecting: false,
        bpmConfidence: null,
        clipboardMessage: "BPM Sync failed — try Tap instead",
      });
      return null;
    }
  },

  syncBpmFromAudio: async () => get().detectBpmFromAudio(),

  startTapTempo: () => {
    set({
      tapTempoActive: true,
      tapTempoTimes: [],
      clipboardMessage: `Tap tempo: hit T on beats (${TAP_TEMPO_MIN_TAPS}+ taps), Enter to apply, Esc to cancel`,
    });
  },

  cancelTapTempo: () => {
    if (!get().tapTempoActive && get().tapTempoTimes.length === 0) return;
    set({
      tapTempoActive: false,
      tapTempoTimes: [],
      clipboardMessage: "Tap tempo cancelled",
    });
  },

  getTapTempoEstimate: () => estimateBpmFromTapTimes(get().tapTempoTimes),

  registerTapTempo: (chartTime) => {
    const state = get();
    if (!state.tapTempoActive) {
      set({
        tapTempoActive: true,
        tapTempoTimes: [],
        clipboardMessage: `Tap tempo: hit T on beats (${TAP_TEMPO_MIN_TAPS}+ taps), Enter to apply, Esc to cancel`,
      });
    }

    let t = chartTime;
    if (t === undefined) {
      if (state.isPlaying && editorAudioPlayer.isPlaying()) {
        t = editorAudioPlayer.getAudioTime() + getSongOffset(state.meta);
      } else {
        t = state.currentTime;
      }
    }

    const prev = get().tapTempoTimes;
    // Ignore accidental double-taps at nearly the same chart time
    if (prev.length > 0 && Math.abs(t - prev[prev.length - 1]) < 0.12) {
      return estimateBpmFromTapTimes(prev);
    }

    const next = [...prev, t].slice(-TAP_TEMPO_MAX_TAPS);
    const estimate = estimateBpmFromTapTimes(next);
    const hint = estimate?.ready
      ? `Tap ${next.length}: ~${estimate.bpm} BPM — Enter to apply`
      : `Tap ${next.length}/${TAP_TEMPO_MIN_TAPS}: keep tapping on the beat`;
    set({
      tapTempoActive: true,
      tapTempoTimes: next,
      clipboardMessage: hint,
    });
    return estimate;
  },

  commitTapTempo: (snapOffsetToFirstTap = true) => {
    const state = get();
    const estimate = estimateBpmFromTapTimes(state.tapTempoTimes);
    if (!estimate?.ready) {
      set({
        clipboardMessage: `Tap tempo: need at least ${TAP_TEMPO_MIN_TAPS} taps on the beat`,
      });
      return null;
    }

    const bpm = estimate.bpm;
    const firstTap = state.tapTempoTimes[0];
    const { meta, charts, changed } = applyConstantBpmChange(state.meta, state.charts, bpm);

    let nextMeta = meta;
    let offsetNote = "";

    if (snapOffsetToFirstTap && firstTap !== undefined) {
      const spb = 60 / bpm;
      const beatAtTap = timeToBeat(firstTap, meta.SongTiming);
      const delta = offsetDeltaToSnapTapToBeat(firstTap, beatAtTap, spb);
      if (Math.abs(delta) > 0.0005 && Math.abs(delta) < 2) {
        const nextOffset = Math.max(
          0,
          Math.round((getSongOffset(meta) + delta) * 1000) / 1000
        );
        nextMeta = { ...meta, SongOffsetSeconds: nextOffset };
        offsetNote = ` · offset ${Math.round(nextOffset * 1000)} ms`;
      }
    }

    const offsetChanged =
      Math.abs(getSongOffset(nextMeta) - getSongOffset(state.meta)) > 0.0005;
    if (!changed && !offsetChanged) {
      set({
        tapTempoActive: false,
        tapTempoTimes: [],
        clipboardMessage: `Tap Sync: already ${bpm} BPM`,
      });
      return bpm;
    }

    recordHistory("timing");
    const strikeBeat = state.scrollTick / RESOLUTION;
    const nextTime = beatToTime(strikeBeat, nextMeta.SongTiming);
    set({
      meta: nextMeta,
      charts: changed ? charts : state.charts,
      currentTime: nextTime,
      bpmConfidence: null,
      tapTempoActive: false,
      tapTempoTimes: [],
      clipboardMessage: `Tap Sync: ${bpm} BPM (${estimate.tapCount} taps${offsetNote})`,
    });
    return bpm;
  },

  setDifficulty: (difficulty) => set({ difficulty }),
  setSelectedLane: (selectedLane) => set({ selectedLane }),
  setStrength: (strength) => set({ strength }),
  setSnapTicks: (snapTicks) => set({ snapTicks }),
  setScrollTick: (scrollTick) => set({ scrollTick: Math.max(0, scrollTick) }),
  setPixelsPerTick: (pixelsPerTick) => {
    const ppt = clampPixelsPerTick(pixelsPerTick);
    set({ pixelsPerTick: ppt, wavePixelsPerTick: ppt });
  },
  setWaveScale: (waveScale) =>
    set({ waveScale: Math.max(0.25, Math.min(3, waveScale)) }),
  setSongVolume: (songVolume) => {
    const volume = Math.max(0, Math.min(1, songVolume));
    set({ songVolume: volume });
    editorAudioPlayer.setVolume(volume);
  },
  setHitVolume: (hitVolume) =>
    set({ hitVolume: Math.max(0, Math.min(1, hitVolume)) }),
  setPlaybackSpeed: (speed) => {
    const playbackSpeed = clampPlaybackSpeed(speed);
    set({ playbackSpeed });
    editorAudioPlayer.setRate(playbackSpeed);
  },
  setOffset: (seconds) => {
    recordHistory("offset");
    const offset = Math.round(seconds * 1000) / 1000;
    set((s) => ({
      meta: {
        ...s.meta,
        SongOffsetSeconds: offset,
      },
    }));
  },
  nudgeOffset: (deltaSeconds) => {
    recordHistory("offset");
    const offset =
      Math.round((get().meta.SongOffsetSeconds + deltaSeconds) * 1000) / 1000;
    set((s) => ({
      meta: {
        ...s.meta,
        SongOffsetSeconds: offset,
      },
    }));
  },
  setOffsetFromPlayhead: () => {
    recordHistory("offset");
    const offset = Math.round(get().currentTime * 1000) / 1000;
    set((s) => ({
      meta: {
        ...s.meta,
        SongOffsetSeconds: offset,
      },
    }));
  },
  goToChartStart: () => {
    set({ scrollTick: 0, currentTime: 0 });
    seekChartTime(0);
  },
  setCurrentTime: (currentTime) => set({ currentTime }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),

  loadAudio: async (file) => {
    try {
      if (editorAudioContext.state === "suspended") await editorAudioContext.resume();
      const buf = await file.arrayBuffer();
      const decoded = await editorAudioContext.decodeAudioData(buf.slice(0));
      const prev = get().audioUrl;
      if (prev) URL.revokeObjectURL(prev);
      const url = URL.createObjectURL(file);
      editorAudioPlayer.pause();
      set((s) => ({
        audioUrl: url,
        audioFileName: file.name,
        audioFile: file,
        audioBuffer: decoded,
        duration: decoded.duration,
        scrollTick: 0,
        currentTime: 0,
        isPlaying: false,
        meta: { ...s.meta, FilePath: INDIES_AUDIO_FILE },
      }));
      syncEditorAudioPlayerFromState(get());
    } catch {
      window.alert("Could not decode this audio file. Try OGG, MP3, or WAV.");
    }
  },

  loadDrumsAudio: async (file) => {
    try {
      if (editorAudioContext.state === "suspended") await editorAudioContext.resume();
      const buf = await file.arrayBuffer();
      const decoded = await editorAudioContext.decodeAudioData(buf.slice(0));
      const prev = get().drumsAudioUrl;
      if (prev) URL.revokeObjectURL(prev);
      const url = URL.createObjectURL(file);
      set({
        drumsAudioUrl: url,
        drumsAudioFileName: file.name,
        drumsAudioBuffer: decoded,
      });
      syncEditorAudioPlayerFromState(get());
    } catch {
      window.alert("Could not decode this drums audio file. Try OGG, MP3, or WAV.");
    }
  },

  setAudioSource: (audioSource) => {
    set({ audioSource });
    syncEditorAudioPlayerFromState(get());
  },

  loadCoverImage: async (file) => {
    const prev = get().coverImageUrl;
    if (prev) URL.revokeObjectURL(prev);
    const url = URL.createObjectURL(file);
    set({
      coverImageUrl: url,
      coverImageFileName: file.name,
      coverImageFile: file,
    });
  },

  clearCoverImage: () => {
    const prev = get().coverImageUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({
      coverImageUrl: null,
      coverImageFileName: null,
      coverImageFile: null,
    });
  },

  loadMeta: async (file) => {
    if (isRlrrFile(file)) {
      const paradiddlePackage = await parseRlrrFile(file);
      if (!paradiddlePackage) {
        window.alert(
          "Could not read this Paradiddle .rlrr file. The file may be corrupt or use an unsupported format."
        );
        return;
      }
      const { meta, charts, audioFileName, coverFileName } = paradiddlePackage;
      const view = importViewState(charts);
      const noteCount = charts[view.difficulty].length;
      set({
        meta,
        charts,
        difficulty: view.difficulty,
        scrollTick: view.scrollTick,
        currentTime: 0,
        isPlaying: false,
        sourceIndiesPath: null,
        clipboardMessage: `Imported ${meta.NameSong} (${noteCount} notes)`,
      });
      if (coverFileName) {
        const coverFile = await loadSiblingFile(file, coverFileName);
        if (coverFile) {
          await get().loadCoverImage(coverFile);
        } else {
          get().clearCoverImage();
        }
      } else {
        get().clearCoverImage();
      }
      if (audioFileName) {
        const audioFile = await loadSiblingFile(file, audioFileName);
        if (audioFile) {
          await get().loadAudio(audioFile);
        } else {
          set({
            clipboardMessage: `Imported ${meta.NameSong} (${noteCount} notes) — use Song to load ${audioFileName} from the same folder.`,
          });
        }
      }
      const afterAudio = importViewState(get().charts);
      set({
        difficulty: afterAudio.difficulty,
        scrollTick: afterAudio.scrollTick,
        currentTime: 0,
        isPlaying: false,
      });
      resetHistoryStack();
      return;
    }

    const indiesPackage = await parseIndiesFile(file);
    if (indiesPackage) {
      const { meta, charts, audioFile, coverFile } = indiesPackage;
      const importPath = fileSystemPath(file);
      const filename = `${sanitizeIndiesFilename(meta.NameSong || meta.NameArtist || "song")}.indies`;
      let sourceIndiesPath: string | null = null;
      if (importPath && isOutputFolderPath(importPath)) {
        sourceIndiesPath = importPath;
      } else if (window.electronAPI?.isDesktop) {
        const outputDir = await getOutputFolder();
        if (outputDir) sourceIndiesPath = joinOutputPath(outputDir, filename);
      }
      set({
        meta,
        charts,
        scrollTick: 0,
        currentTime: 0,
        isPlaying: false,
        sourceIndiesPath,
      });
      if (coverFile) {
        await get().loadCoverImage(coverFile);
      } else {
        get().clearCoverImage();
      }
      if (audioFile) {
        await get().loadAudio(audioFile);
      }
      resetHistoryStack();
      return;
    }

    const text = await file.text();
    if (isChartFile(text)) {
      const { meta, charts } = parseChartFile(text);
      const view = importViewState(charts);
      set({
        meta,
        charts,
        difficulty: view.difficulty,
        scrollTick: view.scrollTick,
        currentTime: 0,
        isPlaying: false,
        sourceIndiesPath: null,
      });
      resetHistoryStack();
      return;
    }
    const meta = parseMetaJson(text);
    const charts = chartsFromMeta(meta);
    set({
      meta,
      charts,
      scrollTick: 0,
      currentTime: 0,
      isPlaying: false,
      sourceIndiesPath: null,
    });
    resetHistoryStack();
  },

  loadChart: async (file) => {
    const text = await file.text();
    const { meta, charts } = parseChartFile(text);
    set({
      meta,
      charts,
      scrollTick: 0,
      currentTime: 0,
      isPlaying: false,
      sourceIndiesPath: null,
    });
    resetHistoryStack();
  },

  generateLowerDifficultiesFromExtreme: (force = false) => {
    const { charts } = get();
    if (charts.extreme.length === 0) {
      set({ clipboardMessage: "Add notes on Extreme first" });
      return;
    }
    const hasLower =
      charts.hard.length > 0 || charts.normal.length > 0 || charts.easy.length > 0;
    if (hasLower && !force) {
      const ok = window.confirm(
        "Replace Easy, Normal, and Hard with auto-generated charts from Extreme?"
      );
      if (!ok) return;
    }
    recordHistory("chart");
    const generated = generateLowerDifficulties(charts.extreme);
    set({
      charts: { ...charts, ...generated },
      clipboardMessage: `Auto-charted ${generated.easy.length} Easy · ${generated.normal.length} Normal · ${generated.hard.length} Hard`,
    });
  },

  exportIndies: async () => {
    if (get().exportingIndies) return;

    let { meta, charts, audioFile, audioBuffer, coverImageFile } = get();
    const filled = chartsWithAutoDownchart(charts);
    if (filled !== charts) {
      charts = filled;
      set({ charts });
    }
    const issues = validateIndiesCharts(charts);
    if (issues.length > 0) {
      window.alert(issues.join("\n"));
      return;
    }
    if (!audioFile || !audioBuffer) {
      window.alert("Load song audio before exporting an .indies package.");
      return;
    }

    set({ exportingIndies: true });
    try {
      const blob = await buildIndiesZip({
        meta,
        charts,
        audioFile,
        coverFile: coverImageFile,
        audioBuffer,
      });
      const filename = `${sanitizeIndiesFilename(meta.NameSong || meta.NameArtist || "song")}.indies`;
      const hadOutputTarget = Boolean(get().sourceIndiesPath);
      const result = await saveBlobFile(filename, blob, { backup: true });
      const where =
        result.method === "disk" ? result.path : `Downloads (${result.filename})`;
      const verb = hadOutputTarget ? "Updated" : "Saved";
      set({
        clipboardMessage: `${verb} ${where}`,
        sourceIndiesPath:
          result.method === "disk" && window.electronAPI?.isDesktop ? result.path : null,
      });
      if (result.method === "disk") {
        await openOutputFolder();
        window.alert(`${verb}:\n${result.path}\n\nA .bak backup was kept if the file already existed.`);
      }
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Could not build .indies package."
      );
    } finally {
      set({ exportingIndies: false });
    }
  },

  publishToIndiesDb: async (explicit = false) => {
    if (get().publishingIndies) {
      throw new Error("Publish already in progress.");
    }

    let { meta, charts, audioFile, audioBuffer, coverImageFile } = get();
    const filled = chartsWithAutoDownchart(charts);
    if (filled !== charts) {
      charts = filled;
      set({ charts });
    }

    const issues = validateIndiesCharts(charts);
    if (issues.length > 0) {
      throw new Error(issues.join("\n"));
    }
    if (!audioFile || !audioBuffer) {
      throw new Error("Load song audio before publishing to Indies-DB.");
    }
    if (!supabase) {
      throw new Error(
        "Indies-DB is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env."
      );
    }

    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) throw sessionErr;
    const user = sessionData.session?.user;
    if (!user) {
      throw new Error("Sign in to publish your map.");
    }

    set({ publishingIndies: true });
    try {
      const exportMeta = {
        ...meta,
        IndiesDbMapId: meta.IndiesDbMapId?.trim() || undefined,
      };
      const blob = await buildIndiesZip({
        meta: exportMeta,
        charts,
        audioFile,
        coverFile: coverImageFile,
        audioBuffer,
      });

      const result = await publishIndiesPackage({
        user,
        indiesBlob: blob,
        meta: exportMeta,
        charts,
        coverFile: coverImageFile,
        existingMapId: exportMeta.IndiesDbMapId,
        explicit,
      });

      set({
        meta: { ...meta, IndiesDbMapId: result.mapId },
        clipboardMessage: result.isUpdate
          ? `Updated on Indies-DB: ${result.mapUrl}`
          : `Published to Indies-DB: ${result.mapUrl}`,
      });

      return result;
    } finally {
      set({ publishingIndies: false });
    }
  },

  exportChart: async () => {
    let { meta, charts, audioFileName, duration } = get();
    const filled = chartsWithAutoDownchart(charts);
    if (filled !== charts) {
      charts = filled;
      set({ charts });
    }
    const issues = validateIndiesCharts(charts);
    if (issues.length > 0) {
      window.alert(issues.join("\n"));
      return;
    }
    const built = prepareMetaForExport(meta, charts);
    const base = sanitizeIndiesFilename(built.NameSong || built.NameArtist || "song");
    try {
      const chartResult = await saveTextFile(
        `${base}/notes.chart`,
        buildChartText(built, charts, audioFileName, duration)
      );
      const iniResult = await saveTextFile(
        `${base}/song.ini`,
        buildSongIni(built, charts, duration)
      );
      const where =
        chartResult.method === "disk"
          ? chartResult.path.replace(/[/\\][^/\\]+$/, "")
          : `${chartResult.method === "download" ? chartResult.filename : "notes.chart"} + ${iniResult.method === "download" ? iniResult.filename : "song.ini"}`;
      set({ clipboardMessage: `Exported ${where}` });
      if (chartResult.method === "disk") {
        await openOutputFolder();
        window.alert(`Saved to:\n${where}`);
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not export chart.");
    }
  },

  toggleNote: (beat, id) => {
    const { difficulty, strength, charts, snapTicks, scrollTick } = get();
    const snapped = snapBeat(beat, snapTicks);
    const strikeTick = snapTick(scrollTick, snapTicks);
    const noteTick = beatToTick(snapped);
    const notes = [...charts[difficulty]];
    const cellIdx = notes.findIndex((n) => {
      if (n.Id !== id) return false;
      if (beatToTick(n.Beat) === beatToTick(beat)) return true;
      return beatsEqual(n.Beat, snapped);
    });

    if (cellIdx >= 0) {
      recordHistory("chart");
      notes.splice(cellIdx, 1);
    } else {
      if (noteTick < strikeTick) return;
      recordHistory("chart");
      notes.push({ Beat: snapped, Id: id, Strength: strength });
    }
    notes.sort((a, b) => a.Beat - b.Beat || a.Id - b.Id);
    set({ charts: { ...charts, [difficulty]: notes } });
  },

  removeNote: (beat, id) => {
    const { difficulty, charts } = get();
    const targetTick = beatToTick(beat);
    const notes = charts[difficulty].filter(
      (n) => !(n.Id === id && beatToTick(n.Beat) === targetTick)
    );
    if (notes.length === charts[difficulty].length) return;
    recordHistory("chart");
    set({ charts: { ...charts, [difficulty]: notes } });
  },

  getActiveNotes: () => get().charts[get().difficulty],

  copyNotesInRange: async (minTick, maxTick) => {
    const { difficulty, charts, scrollTick, snapTicks } = get();
    const strikeTick = snapTick(scrollTick, snapTicks);
    const picked = notesInTickRange(
      charts[difficulty],
      Math.max(minTick, strikeTick),
      maxTick
    );
    if (picked.length === 0) {
      set({ clipboardMessage: "Nothing to copy in view" });
      return 0;
    }
    const anchorBeat = selectionFirstBeat(picked);
    const payload: NoteClipboardPayload = { version: 1, notes: picked, anchorBeat };
    set({ noteClipboard: payload, clipboardMessage: `Copied ${picked.length} notes` });
    try {
      await navigator.clipboard.writeText(serializeClipboard(payload));
    } catch {
      // Internal buffer still works when system clipboard is blocked.
    }
    return picked.length;
  },

  copyNotesInSelection: async (anchorTick, currentTick, anchorCol, currentCol) => {
    const { difficulty, charts } = get();
    const picked = notesInSelectionRect(
      charts[difficulty],
      anchorTick,
      currentTick,
      anchorCol,
      currentCol
    );
    if (picked.length === 0) {
      set({ clipboardMessage: "No notes in selection" });
      return 0;
    }
    const anchorBeat = selectionFirstBeat(picked);
    const payload: NoteClipboardPayload = { version: 1, notes: picked, anchorBeat };
    set({ noteClipboard: payload, clipboardMessage: `Copied ${picked.length} notes` });
    try {
      await navigator.clipboard.writeText(serializeClipboard(payload));
    } catch {
      // Internal buffer still works when system clipboard is blocked.
    }
    return picked.length;
  },

  deleteNotesInSelection: (anchorTick, currentTick, anchorCol, currentCol) => {
    const { difficulty, charts } = get();
    const picked = notesInSelectionRect(
      charts[difficulty],
      anchorTick,
      currentTick,
      anchorCol,
      currentCol
    );
    if (picked.length === 0) {
      set({ clipboardMessage: "No notes in selection" });
      return 0;
    }
    recordHistory("chart");
    const toRemove = new Set(picked.map((n) => `${beatToTick(n.Beat)}:${n.Id}`));
    const notes = charts[difficulty].filter(
      (n) => !toRemove.has(`${beatToTick(n.Beat)}:${n.Id}`)
    );
    set({
      charts: { ...charts, [difficulty]: notes },
      clipboardMessage: `Deleted ${picked.length} notes`,
    });
    return picked.length;
  },

  pasteNotesAtStrikeTick: async (strikeTick) => {
    let payload = get().noteClipboard;
    if (!payload) {
      try {
        const text = await navigator.clipboard.readText();
        payload = parseClipboard(text);
        if (payload) set({ noteClipboard: payload });
      } catch {
        set({ clipboardMessage: "Clipboard empty" });
        return 0;
      }
    }
    if (!payload || payload.notes.length === 0) {
      set({ clipboardMessage: "Clipboard empty" });
      return 0;
    }

    recordHistory("chart");
    const { difficulty, charts, snapTicks } = get();
    const targetTick = snapTick(Math.max(0, strikeTick), snapTicks);
    const pasted = pastePayloadAtStrikeTick(payload, targetTick);
    const merged = mergeNotes(charts[difficulty], pasted);
    set({
      charts: { ...charts, [difficulty]: merged },
      scrollTick: targetTick,
      clipboardMessage: `Pasted ${pasted.length} notes at strike`,
    });
    return pasted.length;
  },

  clearClipboardMessage: () => set({ clipboardMessage: null }),

  updatePhase: (index, patch) => {
    recordHistory("phase");
    set((s) => {
      const phases = sortSongPhases(s.meta.SongPhases);
      if (index < 0 || index >= phases.length) return s;
      const next = { ...phases[index], ...patch };
      if (patch.phase !== undefined) {
        next.phase = clampPhaseId(patch.phase);
        if (patch.phaseName === undefined) {
          next.phaseName = phaseById(next.phase).label;
        }
      }
      if (patch.power !== undefined) next.power = clampPower(patch.power);
      if (patch.beat !== undefined) next.beat = Math.max(0, patch.beat);
      phases[index] = next;
      return { meta: { ...s.meta, SongPhases: sortSongPhases(phases) } };
    });
  },

  addPhase: () => {
    recordHistory("phase");
    set((s) => {
      const phases = sortSongPhases(s.meta.SongPhases);
      const lastBeat = phases.length > 0 ? phases[phases.length - 1].beat : 0;
      const phase: SongPhase = {
        beat: lastBeat + 4,
        phase: 2,
        power: 0.5,
        phaseName: phaseById(2).label,
      };
      return { meta: { ...s.meta, SongPhases: sortSongPhases([...phases, phase]) } };
    });
  },

  addPhaseAtPlayhead: () => {
    recordHistory("phase");
    set((s) => {
      const beat = Math.round(timeToBeat(s.currentTime, s.meta.SongTiming) * 1000) / 1000;
      const phase: SongPhase = {
        beat: Math.max(0, beat),
        phase: 2,
        power: 0.5,
        phaseName: phaseById(2).label,
      };
      return {
        meta: {
          ...s.meta,
          SongPhases: sortSongPhases([...s.meta.SongPhases, phase]),
        },
      };
    });
  },

  removePhase: (index) => {
    recordHistory("phase");
    set((s) => {
      const phases = sortSongPhases(s.meta.SongPhases);
      if (phases.length <= 1 || index < 0 || index >= phases.length) return s;
      phases.splice(index, 1);
      return { meta: { ...s.meta, SongPhases: phases } };
    });
  },

  updateAnchor: (index, patch) => {
    recordHistory("timing");
    set((s) => {
      const anchors = sortTimingAnchors(s.meta.SongTiming);
      if (index < 0 || index >= anchors.length) return s;
      const next = { ...anchors[index], ...patch };
      if (patch.beat !== undefined) next.beat = Math.max(0, patch.beat);
      if (patch.timer !== undefined) next.timer = Math.max(0, patch.timer);
      anchors[index] = next;
      const timing = sortTimingAnchors(anchors);
      if (index === 0 && timing[0]?.beat === 0 && patch.timer !== undefined) {
        const offset = Math.max(0, Math.round(patch.timer * 1000) / 1000);
        timing[0] = { ...timing[0], timer: 0 };
        return {
          meta: {
            ...s.meta,
            SongOffsetSeconds: offset,
            SongTiming: timing,
          },
        };
      }
      if (timing[0]?.beat === 0) {
        timing[0] = { ...timing[0], timer: 0 };
      }
      return {
        meta: {
          ...s.meta,
          SongTiming: timing,
        },
      };
    });
  },

  addAnchor: () => {
    recordHistory("timing");
    set((s) => {
      const anchors = sortTimingAnchors(s.meta.SongTiming);
      const last = anchors[anchors.length - 1];
      const beat = last.beat + 4;
      const anchor: TimingAnchor = { beat, timer: beatToTime(beat, anchors) };
      return { meta: { ...s.meta, SongTiming: sortTimingAnchors([...anchors, anchor]) } };
    });
  },

  addAnchorAtPlayhead: () => {
    recordHistory("timing");
    set((s) => {
      const beat = Math.round(timeToBeat(s.currentTime, s.meta.SongTiming) * 1000) / 1000;
      const timer = Math.round(s.currentTime * 1000) / 1000;
      const anchor: TimingAnchor = { beat: Math.max(0, beat), timer: Math.max(0, timer) };
      const anchors = sortTimingAnchors([...s.meta.SongTiming, anchor]);
      const deduped = anchors.filter(
        (item, idx, list) =>
          idx === 0 ||
          Math.abs(item.beat - list[idx - 1].beat) > 1 / 480 ||
          Math.abs(item.timer - list[idx - 1].timer) > 0.001
      );
      return { meta: { ...s.meta, SongTiming: deduped.length >= 2 ? deduped : anchors } };
    });
  },

  removeAnchor: (index) => {
    recordHistory("timing");
    set((s) => {
      const anchors = sortTimingAnchors(s.meta.SongTiming);
      if (anchors.length <= 2 || index < 0 || index >= anchors.length) return s;
      anchors.splice(index, 1);
      return { meta: { ...s.meta, SongTiming: anchors } };
    });
  },

  setPlacementMode: (placementMode) => set({ placementMode }),

  setPendingPhasePlacement: (patch) =>
    set((s) => {
      const next: PhasePlacement = { ...s.pendingPhasePlacement, ...patch };
      if (patch.phase !== undefined) {
        next.phase = clampPhaseId(patch.phase);
        if (patch.phaseName === undefined) {
          next.phaseName = phaseById(next.phase).label;
        }
      }
      if (patch.power !== undefined) next.power = clampPower(patch.power);
      if (patch.phaseName !== undefined) next.phaseName = patch.phaseName.trim() || phaseById(next.phase).label;
      return { pendingPhasePlacement: next };
    }),

  placePhaseAtBeat: (beat) => {
    recordHistory("phase");
    set((s) => {
      const snapped = snapBeat(Math.max(0, beat), s.snapTicks);
      const phases = sortSongPhases(s.meta.SongPhases);
      const existing = phases.findIndex((ph) => beatsEqual(ph.beat, snapped));
      const template = s.pendingPhasePlacement;
      const nextPhase: SongPhase = {
        beat: snapped,
        phase: clampPhaseId(template.phase),
        power: clampPower(template.power),
        phaseName: template.phaseName.trim() || phaseById(template.phase).label,
      };
      if (existing >= 0) phases[existing] = nextPhase;
      else phases.push(nextPhase);
      return { meta: { ...s.meta, SongPhases: sortSongPhases(phases) } };
    });
  },

  placeAnchorAtBeat: (beat) => {
    recordHistory("timing");
    set((s) => {
      const snapped = snapBeat(Math.max(0, beat), s.snapTicks);
      const anchors = sortTimingAnchors(s.meta.SongTiming);
      const timer = Math.round(beatToTime(snapped, anchors) * 1000) / 1000;
      const existing = anchors.findIndex((a) => beatsEqual(a.beat, snapped));
      const next: TimingAnchor = { beat: snapped, timer };
      if (existing >= 0) anchors[existing] = next;
      else anchors.push(next);
      const deduped = sortTimingAnchors(anchors).filter(
        (item, idx, list) =>
          idx === 0 ||
          Math.abs(item.beat - list[idx - 1].beat) > 1 / 480 ||
          Math.abs(item.timer - list[idx - 1].timer) > 0.001
      );
      return {
        meta: {
          ...s.meta,
          SongTiming: deduped.length >= 2 ? deduped : sortTimingAnchors(anchors),
        },
      };
    });
  },
};
});