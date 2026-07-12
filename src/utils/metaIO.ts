import type { ChartNote, Difficulty, MetaJson, SongPhase, TimingAnchor } from "../types/meta";
import {
  clampPhaseId,
  clampPower,
  phaseById,
  sortSongPhases,
} from "../types/meta";
import { normalizeChartNotes, sortChartNotes } from "./chartNotes";
import { getSongOffset } from "./offset";
import { serializeMetaJson } from "./metaSerialize";
import { sortTimingAnchors } from "./timing";

function normalizeSongPhase(raw: Partial<SongPhase>): SongPhase {
  const phase = clampPhaseId(raw.phase ?? 1);
  return {
    beat: raw.beat ?? 0,
    phase,
    power: clampPower(raw.power ?? 1),
    phaseName: raw.phaseName?.trim() || phaseById(phase).label,
  };
}

export function createEmptyMeta(): MetaJson {
  return {
    NameArtist: "Unknown Artist",
    NameSong: "Untitled Song",
    NameCharter: "Chart Editor",
    FilePath: "",
    SongOffsetSeconds: 0,
    SongTiming: [
      { beat: 0, timer: 0 },
      { beat: 4, timer: 2 },
    ],
    SongPhases: [{ beat: 0, phase: 1, power: 1, phaseName: "Intro" }],
    ChartEasy: [],
    ChartNormal: [],
    ChartHard: [],
    ChartExtreme: [],
  };
}

export function chartsFromMeta(meta: MetaJson): Record<Difficulty, ChartNote[]> {
  return {
    easy: [...meta.ChartEasy],
    normal: [...meta.ChartNormal],
    hard: [...meta.ChartHard],
    extreme: [...meta.ChartExtreme],
  };
}

export function buildMetaJson(
  meta: MetaJson,
  charts: Record<Difficulty, ChartNote[]>
): MetaJson {
  return {
    ...meta,
    SongTiming: [...meta.SongTiming].sort((a, b) => a.beat - b.beat),
    SongPhases: sortSongPhases(meta.SongPhases),
    ChartEasy: sortChartNotes(normalizeChartNotes(charts.easy)),
    ChartNormal: sortChartNotes(normalizeChartNotes(charts.normal)),
    ChartHard: sortChartNotes(normalizeChartNotes(charts.hard)),
    ChartExtreme: sortChartNotes(normalizeChartNotes(charts.extreme)),
  };
}

function bakeOffsetIntoTiming(
  timing: TimingAnchor[],
  offsetSeconds: number
): TimingAnchor[] {
  const sorted = sortTimingAnchors(timing);
  if (offsetSeconds <= 0) return sorted;
  if (sorted.length === 0) return [{ beat: 0, timer: offsetSeconds }];

  const prevOffset = sorted[0]?.beat === 0 ? sorted[0].timer : 0;
  const delta = offsetSeconds - prevOffset;
  const shifted = sorted.map((anchor) => ({
    ...anchor,
    timer: anchor.timer + delta,
  }));

  if (shifted[0].beat === 0) {
    shifted[0] = { ...shifted[0], timer: offsetSeconds };
    return shifted;
  }

  return [{ beat: 0, timer: offsetSeconds }, ...shifted];
}

/** Editor timeline: beat 0 stays at timer 0; offset lives in SongOffsetSeconds. */
export function unbakeOffsetFromTiming(
  timing: TimingAnchor[],
  offsetSeconds: number
): TimingAnchor[] {
  const sorted = sortTimingAnchors(timing);
  if (offsetSeconds <= 0) return sorted;

  const shifted = sorted.map((anchor) => ({
    ...anchor,
    timer: Math.max(0, Math.round((anchor.timer - offsetSeconds) * 1_000_000) / 1_000_000),
  }));

  if (shifted[0]?.beat === 0) {
    shifted[0] = { ...shifted[0], timer: 0 };
  }

  return shifted;
}

export function withOffsetInTiming(
  timing: TimingAnchor[],
  offsetSeconds: number
): TimingAnchor[] {
  return bakeOffsetIntoTiming(timing, offsetSeconds);
}

/** Offset is editor-only — bake into SongTiming[0].timer and zero SongOffsetSeconds on export. */
export function prepareMetaForExport(
  meta: MetaJson,
  charts: Record<Difficulty, ChartNote[]>
): MetaJson {
  const offset = getSongOffset(meta);
  return buildMetaJson(
    {
      ...meta,
      SongOffsetSeconds: 0,
      SongTiming: bakeOffsetIntoTiming(meta.SongTiming, offset),
    },
    charts
  );
}

export function downloadMetaJson(meta: MetaJson, filename = "meta.json"): void {
  const blob = new Blob([serializeMetaJson(meta)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Normalize imported SongTiming + offset into editor form:
 * - beat 0 always at timer 0
 * - lead-in lives in SongOffsetSeconds
 *
 * Other tools disagree on layout:
 * - Indies export style: offset baked into SongTiming[0].timer, SongOffsetSeconds = 0
 * - Editor / some packs: SongTiming starts at 0, offset only in SongOffsetSeconds
 *
 * Always unbaking by SongOffsetSeconds when timer is already 0 corrupts the tempo map
 * (every later anchor loses that many seconds → BPM looks wrong / "anchors don't work").
 */
export function normalizeImportedTiming(
  timing: TimingAnchor[],
  declaredOffsetSeconds: number
): { timing: TimingAnchor[]; offset: number } {
  const sorted = sortTimingAnchors(timing);
  if (sorted.length === 0) {
    return {
      timing: [
        { beat: 0, timer: 0 },
        { beat: 4, timer: 2 },
      ],
      offset: Math.max(0, declaredOffsetSeconds),
    };
  }

  const declared = Math.max(0, declaredOffsetSeconds);
  const first = sorted[0];
  const firstTimer = first.beat === 0 ? first.timer : 0;

  // Already editor-style: beat 0 at t=0. Keep anchors; offset is separate.
  if (first.beat === 0 && firstTimer <= 1e-9) {
    const cleaned = sorted.map((a, i) =>
      i === 0 && a.beat === 0 ? { ...a, timer: 0 } : a
    );
    return { timing: cleaned, offset: declared };
  }

  // Offset is baked into absolute timers (common on .indies from export / other tools).
  const baked = first.beat === 0 ? firstTimer : 0;
  const offset = declared > 1e-9 ? declared : baked;
  const unbakeBy = baked > 1e-9 ? baked : offset;
  return {
    timing: unbakeOffsetFromTiming(sorted, unbakeBy),
    offset,
  };
}

export function parseMetaJson(raw: string): MetaJson {
  const data = JSON.parse(raw) as Partial<MetaJson>;
  const base = createEmptyMeta();
  const rawTiming =
    data.SongTiming && data.SongTiming.length >= 2
      ? sortTimingAnchors(data.SongTiming)
      : base.SongTiming;
  const { timing, offset } = normalizeImportedTiming(
    rawTiming,
    data.SongOffsetSeconds ?? 0
  );

  return {
    NameArtist: data.NameArtist ?? base.NameArtist,
    NameSong: data.NameSong ?? base.NameSong,
    NameCharter: data.NameCharter ?? base.NameCharter,
    IndiesDbMapId: data.IndiesDbMapId?.trim() || undefined,
    FilePath: data.FilePath ?? "",
    SongOffsetSeconds: offset,
    SongTiming: timing,
    SongPhases:
      data.SongPhases && data.SongPhases.length >= 1
        ? sortSongPhases(data.SongPhases.map(normalizeSongPhase))
        : base.SongPhases,
    ChartEasy: normalizeChartNotes(data.ChartEasy),
    ChartNormal: normalizeChartNotes(data.ChartNormal),
    ChartHard: normalizeChartNotes(data.ChartHard),
    ChartExtreme: normalizeChartNotes(data.ChartExtreme),
  };
}