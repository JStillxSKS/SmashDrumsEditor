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
import { buildChartText, isChartFile, parseChartFile } from "../utils/chartIO";
import { openOutputFolder, saveBlobFile, saveTextFile } from "../utils/fileSave";
import { buildSongIni } from "../utils/songIniIO";
import {
  chartsFromMeta,
  createEmptyMeta,
  parseMetaJson,
  prepareMetaForExport,
  withOffsetInTiming,
} from "../utils/metaIO";
import { getSongOffset } from "../utils/offset";
import {
  buildIndiesZip,
  parseIndiesFile,
  sanitizeIndiesFilename,
} from "../utils/indiesIO";
import {
  FIXED_PIXELS_PER_TICK,
  beatToTick,
  beatsEqual,
  clampPixelsPerTick,
  snapBeat,
  snapTick,
} from "../utils/resolution";
import {
  clampPlaybackSpeed,
  syncAudioPlaybackRate,
  syncAudioVolume,
} from "../utils/audioPlayback";
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
  anchorsFromBpm,
  beatToTime,
  sortTimingAnchors,
  timeToBeat,
} from "../utils/timing";

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
  placementMode: PlacementMode;
  pendingPhasePlacement: PhasePlacement;
  noteClipboard: NoteClipboardPayload | null;
  clipboardMessage: string | null;
  exportingIndies: boolean;

  setMetaField: <K extends keyof MetaJson>(key: K, value: MetaJson[K]) => void;
  setBpm: (bpm: number) => void;
  detectBpmFromAudio: () => Promise<number | null>;
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
  exportChart: () => void;
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
  pasteNotesAtStrikeTick: (strikeTick: number) => Promise<number>;
  clearClipboardMessage: () => void;
};

const audioContext = new AudioContext();

export const useEditorStore = create<EditorState>((set, get) => ({
  meta: createEmptyMeta(),
  charts: { easy: [], normal: [], hard: [], extreme: [] },
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
  placementMode: null,
  pendingPhasePlacement: {
    phase: 2,
    power: 0.5,
    phaseName: phaseById(2).label,
  },
  noteClipboard: null,
  clipboardMessage: null,
  exportingIndies: false,

  setMetaField: (key, value) =>
    set((s) => ({ meta: { ...s.meta, [key]: value } })),

  setBpm: (bpm) =>
    set((s) => {
      const offset = getSongOffset(s.meta);
      return {
        meta: {
          ...s.meta,
          SongTiming: withOffsetInTiming(anchorsFromBpm(bpm), offset),
        },
        bpmConfidence: null,
      };
    }),

  detectBpmFromAudio: async () => {
    const { audioBuffer } = get();
    if (!audioBuffer) return null;
    set({ bpmDetecting: true });
    try {
      await new Promise((r) => setTimeout(r, 0));
      const { bpm, confidence } = detectBpm(audioBuffer);
      set((s) => {
        const offset = getSongOffset(s.meta);
        return {
          meta: {
            ...s.meta,
            SongTiming: withOffsetInTiming(anchorsFromBpm(bpm), offset),
          },
          bpmDetecting: false,
          bpmConfidence: confidence,
        };
      });
      return bpm;
    } catch {
      set({ bpmDetecting: false, bpmConfidence: null });
      return null;
    }
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
    const audio = document.getElementById("editor-audio") as HTMLAudioElement | null;
    syncAudioVolume(audio, volume);
  },
  setHitVolume: (hitVolume) =>
    set({ hitVolume: Math.max(0, Math.min(1, hitVolume)) }),
  setPlaybackSpeed: (speed) => {
    const playbackSpeed = clampPlaybackSpeed(speed);
    set({ playbackSpeed });
    const audio = document.getElementById("editor-audio") as HTMLAudioElement | null;
    syncAudioPlaybackRate(audio, playbackSpeed);
  },
  setOffset: (seconds) => {
    const offset = Math.round(seconds * 1000) / 1000;
    set((s) => ({
      meta: {
        ...s.meta,
        SongOffsetSeconds: offset,
        SongTiming: withOffsetInTiming(s.meta.SongTiming, offset),
      },
    }));
  },
  nudgeOffset: (deltaSeconds) => {
    const offset =
      Math.round((get().meta.SongOffsetSeconds + deltaSeconds) * 1000) / 1000;
    set((s) => ({
      meta: {
        ...s.meta,
        SongOffsetSeconds: offset,
        SongTiming: withOffsetInTiming(s.meta.SongTiming, offset),
      },
    }));
  },
  setOffsetFromPlayhead: () => {
    const offset = Math.round(get().currentTime * 1000) / 1000;
    set((s) => ({
      meta: {
        ...s.meta,
        SongOffsetSeconds: offset,
        SongTiming: withOffsetInTiming(s.meta.SongTiming, offset),
      },
    }));
  },
  goToChartStart: () => {
    set({ scrollTick: 0, currentTime: 0 });
  },
  setCurrentTime: (currentTime) => set({ currentTime }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),

  loadAudio: async (file) => {
    try {
      if (audioContext.state === "suspended") await audioContext.resume();
      const buf = await file.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(buf.slice(0));
      const prev = get().audioUrl;
      if (prev) URL.revokeObjectURL(prev);
      const url = URL.createObjectURL(file);
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
      syncAudioVolume(
        document.getElementById("editor-audio") as HTMLAudioElement | null,
        get().songVolume
      );
    } catch {
      window.alert("Could not decode this audio file. Try OGG, MP3, or WAV.");
    }
  },

  loadDrumsAudio: async (file) => {
    try {
      if (audioContext.state === "suspended") await audioContext.resume();
      const buf = await file.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(buf.slice(0));
      const prev = get().drumsAudioUrl;
      if (prev) URL.revokeObjectURL(prev);
      const url = URL.createObjectURL(file);
      set({
        drumsAudioUrl: url,
        drumsAudioFileName: file.name,
        drumsAudioBuffer: decoded,
      });
    } catch {
      window.alert("Could not decode this drums audio file. Try OGG, MP3, or WAV.");
    }
  },

  setAudioSource: (audioSource) => set({ audioSource }),

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
    const indiesPackage = await parseIndiesFile(file);
    if (indiesPackage) {
      const { meta, charts, audioFile, coverFile } = indiesPackage;
      set({
        meta,
        charts,
        scrollTick: 0,
        currentTime: 0,
        isPlaying: false,
      });
      if (coverFile) {
        await get().loadCoverImage(coverFile);
      } else {
        get().clearCoverImage();
      }
      if (audioFile) {
        await get().loadAudio(audioFile);
      }
      return;
    }

    const text = await file.text();
    if (isChartFile(text)) {
      const { meta, charts } = parseChartFile(text);
      set({
        meta,
        charts,
        scrollTick: 0,
        currentTime: 0,
        isPlaying: false,
      });
      return;
    }
    const meta = parseMetaJson(text);
    set({
      meta,
      charts: chartsFromMeta(meta),
      scrollTick: 0,
      currentTime: 0,
      isPlaying: false,
    });
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
    });
  },

  exportIndies: async () => {
    if (get().exportingIndies) return;

    const { meta, charts, audioFile, audioBuffer, coverImageFile } = get();
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
      const base = sanitizeIndiesFilename(meta.NameSong || meta.NameArtist || "song");
      const result = await saveBlobFile(`${base}.indies`, blob);
      const where =
        result.method === "disk" ? result.path : `Downloads (${result.filename})`;
      set({ clipboardMessage: `Exported ${where}` });
      if (result.method === "disk") {
        await openOutputFolder();
        window.alert(`Saved to:\n${result.path}`);
      }
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Could not build .indies package."
      );
    } finally {
      set({ exportingIndies: false });
    }
  },

  exportChart: async () => {
    const { meta, charts, audioFileName, duration } = get();
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
      notes.splice(cellIdx, 1);
    } else {
      if (noteTick < strikeTick) return;
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

  updatePhase: (index, patch) =>
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
    }),

  addPhase: () =>
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
    }),

  addPhaseAtPlayhead: () =>
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
    }),

  removePhase: (index) =>
    set((s) => {
      const phases = sortSongPhases(s.meta.SongPhases);
      if (phases.length <= 1 || index < 0 || index >= phases.length) return s;
      phases.splice(index, 1);
      return { meta: { ...s.meta, SongPhases: phases } };
    }),

  updateAnchor: (index, patch) =>
    set((s) => {
      const anchors = sortTimingAnchors(s.meta.SongTiming);
      if (index < 0 || index >= anchors.length) return s;
      const next = { ...anchors[index], ...patch };
      if (patch.beat !== undefined) next.beat = Math.max(0, patch.beat);
      if (patch.timer !== undefined) next.timer = Math.max(0, patch.timer);
      anchors[index] = next;
      const timing = sortTimingAnchors(anchors);
      const offset =
        timing[0]?.beat === 0 ? timing[0].timer : s.meta.SongOffsetSeconds;
      return {
        meta: {
          ...s.meta,
          SongOffsetSeconds: offset,
          SongTiming: timing,
        },
      };
    }),

  addAnchor: () =>
    set((s) => {
      const anchors = sortTimingAnchors(s.meta.SongTiming);
      const last = anchors[anchors.length - 1];
      const beat = last.beat + 4;
      const anchor: TimingAnchor = { beat, timer: beatToTime(beat, anchors) };
      return { meta: { ...s.meta, SongTiming: sortTimingAnchors([...anchors, anchor]) } };
    }),

  addAnchorAtPlayhead: () =>
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
    }),

  removeAnchor: (index) =>
    set((s) => {
      const anchors = sortTimingAnchors(s.meta.SongTiming);
      if (anchors.length <= 2 || index < 0 || index >= anchors.length) return s;
      anchors.splice(index, 1);
      return { meta: { ...s.meta, SongTiming: anchors } };
    }),

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

  placePhaseAtBeat: (beat) =>
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
    }),

  placeAnchorAtBeat: (beat) =>
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
    }),
}));