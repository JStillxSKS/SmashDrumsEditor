import type { ChartNote, Difficulty, MetaJson, SongPhase, TimingAnchor } from "../types/meta";
import { clampPhaseId, clampPower, phaseById } from "../types/meta";
import { RESOLUTION } from "./resolution";
import { normalizeChartNotes } from "./chartNotes";
import { chDrumEntriesToNotes, indiesNoteToChLanes } from "./chartLaneMapping";
import { CHART_MUSIC_STREAM } from "./audioFormat";
import { getSongOffset } from "./offset";
import {
  buildMetaJson,
  createEmptyMeta,
  normalizeImportedTiming,
} from "./metaIO";
import {
  anchorsFromBpm,
  beatToTime,
  bpmAtAnchor,
  bpmFromAnchors,
  maxContentBeat,
  sortTimingAnchors,
  timeToBeat,
} from "./timing";

const CHART_DIFFICULTY_SECTIONS: Record<Difficulty, string> = {
  easy: "EasyDrums",
  normal: "MediumDrums",
  hard: "HardDrums",
  extreme: "ExpertDrums",
};

const SECTION_TO_DIFFICULTY: Record<string, Difficulty> = {
  EasyDrums: "easy",
  MediumDrums: "normal",
  HardDrums: "hard",
  ExpertDrums: "extreme",
};

/** Moonscraper [Song] Difficulty field (ExpertDrums section still holds the notes). */
const CHART_DIFFICULTY = 0;

type TrackEntry = { tick: number; key: string; value: string };

function escapeChartString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function unescapeChartString(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function parseQuotedValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return unescapeChartString(trimmed.slice(1, -1));
  }
  return trimmed;
}

/** Moonscraper / FeedBack — strip from first `;` outside quoted strings. */
function stripChartLineComment(line: string): string {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (ch === ";" && !inQuote) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

function parseChartNumber(raw: string): number {
  const token = raw.trim().split(/\s+/)[0];
  const n = Number(token);
  return Number.isFinite(n) ? n : NaN;
}

function bpmAtBeat(beat: number, anchors: TimingAnchor[]): number {
  const sorted = sortTimingAnchors(anchors);
  if (sorted.length < 2) return bpmFromAnchors(sorted);

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (beat >= a.beat && beat <= b.beat) return bpmAtAnchor(sorted, i);
  }

  return bpmAtAnchor(sorted, sorted.length - 2);
}

/** Tempo-change anchors only — not the closing duration anchor. */
function tempoChangeAnchors(anchors: TimingAnchor[], toleranceBpm = 0.1): TimingAnchor[] {
  const sorted = sortTimingAnchors(anchors);
  if (sorted.length === 0) return anchorsFromBpm(120);

  const result: TimingAnchor[] = [sorted[0]];
  let lastBpm = bpmAtAnchor(sorted, 0);

  for (let i = 1; i < sorted.length; i++) {
    const bpm = bpmAtAnchor(sorted, i);
    if (Math.abs(bpm - lastBpm) > toleranceBpm) {
      result.push(sorted[i]);
      lastBpm = bpm;
    }
  }

  return result;
}

function syncEndBeat(
  meta: MetaJson,
  charts: Record<Difficulty, ChartNote[]>,
  duration: number
): number {
  let endBeat = maxContentBeat(meta, charts);

  if (duration > 0) {
    const audioEndBeat = timeToBeat(
      duration + getSongOffset(meta),
      meta.SongTiming
    );
    endBeat = Math.max(endBeat, audioEndBeat);
  }

  return Math.max(endBeat, 4);
}

/**
 * Clone Hero [SyncTrack] — start anchor, optional tempo changes (each with TS 4),
 * closing anchor at song end with TS 4 + A + B (see TCBAITW notes.chart).
 */
function buildSyncTrackLines(
  meta: MetaJson,
  charts: Record<Difficulty, ChartNote[]>,
  duration: number
): string[] {
  const anchors = sortTimingAnchors(meta.SongTiming);
  const changes = tempoChangeAnchors(anchors);
  const lines: string[] = [];

  const startBpm = Math.round(bpmAtAnchor(anchors, 0) * 1000);
  lines.push("  0 = TS 4");
  lines.push("  0 = A 0");
  lines.push(`  0 = B ${startBpm}`);

  for (let i = 1; i < changes.length; i++) {
    const anchor = changes[i];
    const tick = Math.round(anchor.beat * RESOLUTION);
    if (tick <= 0) continue;

    const micros = Math.round(anchor.timer * 1_000_000);
    const bpm = Math.round(bpmAtBeat(anchor.beat, anchors) * 1000);
    lines.push(`  ${tick} = TS 4`);
    lines.push(`  ${tick} = A ${micros}`);
    lines.push(`  ${tick} = B ${bpm}`);
  }

  const endBeat = syncEndBeat(meta, charts, duration);
  const endTick = Math.round(endBeat * RESOLUTION);
  const endMicros = Math.round(beatToTime(endBeat, anchors) * 1_000_000);
  const endBpm = Math.round(bpmAtBeat(endBeat, anchors) * 1000);

  const lastChangeTick =
    changes.length > 0 ? Math.round(changes[changes.length - 1].beat * RESOLUTION) : 0;

  if (endTick > lastChangeTick) {
    lines.push(`  ${endTick} = TS 4`);
    lines.push(`  ${endTick} = A ${endMicros}`);
    lines.push(`  ${endTick} = B ${endBpm}`);
  }

  return lines;
}

function formatEventLabel(phaseName: string): string {
  const trimmed = phaseName.trim();
  if (!trimmed) return "section Intro";
  if (/^section\s+/i.test(trimmed)) return trimmed;
  return `section ${trimmed}`;
}

function buildEventLines(meta: MetaJson): string[] {
  return [...meta.SongPhases]
    .sort((a, b) => a.beat - b.beat)
    .map((phase) => {
      const tick = Math.round(phase.beat * RESOLUTION);
      const label = escapeChartString(formatEventLabel(phase.phaseName));
      return `  ${tick} = E "${label}"`;
    });
}

function buildDrumLines(notes: ChartNote[]): string[] {
  const lanesByTick = new Map<number, number[]>();

  for (const note of normalizeChartNotes(notes)) {
    const tick = Math.round(note.Beat * RESOLUTION);
    const chLanes = indiesNoteToChLanes(note);
    if (chLanes.length === 0) continue;

    const existing = lanesByTick.get(tick) ?? [];
    existing.push(...chLanes);
    lanesByTick.set(tick, existing);
  }

  const lines: string[] = [];
  for (const tick of [...lanesByTick.keys()].sort((a, b) => a - b)) {
    const uniqueLanes = [...new Set(lanesByTick.get(tick)!)].sort((a, b) => a - b);
    for (const lane of uniqueLanes) {
      lines.push(`  ${tick} = N ${lane} 0`);
    }
  }

  return lines;
}

function musicStreamName(_meta: MetaJson, audioFileName: string | null): string {
  if (audioFileName?.trim()) return CHART_MUSIC_STREAM;
  return CHART_MUSIC_STREAM;
}

function chartSection(name: string, lines: string[]): string {
  const body = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  return `[${name}]\n{\n${body}}`;
}

export function buildChartText(
  meta: MetaJson,
  charts: Record<Difficulty, ChartNote[]>,
  audioFileName: string | null = null,
  duration = 0
): string {
  const built = buildMetaJson(meta, charts);
  const offsetMs = Math.round(built.SongOffsetSeconds * 1000);
  const musicStream = escapeChartString(musicStreamName(built, audioFileName));

  const sections: string[] = [
    chartSection("Song", [
      `  Name = "${escapeChartString(built.NameSong)}"`,
      `  Artist = "${escapeChartString(built.NameArtist)}"`,
      `  Charter = "${escapeChartString(built.NameCharter)}"`,
      `  Offset = ${offsetMs}`,
      `  Resolution = ${RESOLUTION}`,
      `  Player2 = bass`,
      `  Difficulty = ${CHART_DIFFICULTY}`,
      `  PreviewStart = 0`,
      `  PreviewEnd = 0`,
      `  Genre = "rock"`,
      `  MediaType = "cd"`,
      `  MusicStream = "${musicStream}"`,
    ]),
    chartSection("SyncTrack", buildSyncTrackLines(built, charts, duration)),
    chartSection("Events", buildEventLines(built)),
  ];

  const drumOrder: Difficulty[] = ["extreme", "hard", "normal", "easy"];
  for (const diff of drumOrder) {
    const notes = charts[diff];
    if (notes.length > 0) {
      sections.push(chartSection(CHART_DIFFICULTY_SECTIONS[diff], buildDrumLines(notes)));
    }
  }

  return `\uFEFF${sections.join("\n")}\n`;
}

export function chartFilename(_songName?: string): string {
  return "notes.chart";
}

export function downloadChart(
  meta: MetaJson,
  charts: Record<Difficulty, ChartNote[]>,
  audioFileName: string | null = null,
  filename?: string,
  duration = 0
): void {
  const built = buildMetaJson(meta, charts);
  const name = filename ?? chartFilename();
  const blob = new Blob([buildChartText(built, charts, audioFileName, duration)], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function parseChartSections(text: string): {
  song: Record<string, string>;
  tracks: Map<string, TrackEntry[]>;
} {
  const song: Record<string, string> = {};
  const tracks = new Map<string, TrackEntry[]>();
  const clean = text.replace(/^\uFEFF/, "");

  let currentSection = "";
  let inBlock = false;

  for (const rawLine of clean.split(/\r?\n/)) {
    const line = stripChartLineComment(rawLine.trim());
    if (!line || line.startsWith("//") || line.startsWith(";")) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (currentSection !== "Song") {
        tracks.set(currentSection, []);
      }
      inBlock = false;
      continue;
    }

    if (line === "{") {
      inBlock = true;
      continue;
    }
    if (line === "}") {
      inBlock = false;
      continue;
    }
    if (!inBlock || !currentSection) continue;

    if (currentSection === "Song") {
      const songMatch = line.match(/^(\w+)\s*=\s*(.+)$/);
      if (songMatch) {
        song[songMatch[1]] = parseQuotedValue(songMatch[2]);
      }
      continue;
    }

    const trackMatch = line.match(/^(\d+)\s*=\s*(\w+)(?:\s+(.+))?$/);
    if (trackMatch) {
      const tick = Number(trackMatch[1]);
      const key = trackMatch[2];
      const value = trackMatch[3] ? parseQuotedValue(trackMatch[3]) : "";
      tracks.get(currentSection)?.push({ tick, key, value });
    }
  }

  return { song, tracks };
}

/**
 * Build SongTiming from Clone Hero [SyncTrack].
 *
 * Moonscraper charts usually carry tempo as `B` (milli-BPM) events — including
 * mid-song changes. Older import only used B at tick 0 (or A pairs), so someone
 * else's multi-tempo chart looked like a single BPM and "ignored anchors".
 *
 * Prefer accumulating time from all B events; use A (absolute µs) when present
 * for that tick so exported A+B maps stay exact.
 */
function syncTrackToAnchors(entries: TrackEntry[]): TimingAnchor[] {
  const aByTick = new Map<number, number>();
  const bByTick = new Map<number, number>();

  for (const entry of entries) {
    if (entry.key === "A") {
      const v = parseChartNumber(entry.value);
      if (Number.isFinite(v)) aByTick.set(entry.tick, v);
    }
    if (entry.key === "B") {
      const v = parseChartNumber(entry.value);
      if (Number.isFinite(v) && v > 0) bByTick.set(entry.tick, v);
    }
  }

  const bTicks = [...bByTick.keys()].sort((a, b) => a - b);
  if (bTicks.length >= 1) {
    return anchorsFromChartBpmEvents(bByTick, aByTick);
  }

  const aTicks = [...aByTick.keys()].sort((a, b) => a - b);
  if (aTicks.length >= 2) {
    return aTicks.map((tick) => ({
      beat: tick / RESOLUTION,
      timer: (aByTick.get(tick) ?? 0) / 1_000_000,
    }));
  }

  return anchorsFromBpm(120);
}

/** Convert milli-BPM `B` events (+ optional absolute `A`) into beat/timer anchors. */
function anchorsFromChartBpmEvents(
  bByTick: Map<number, number>,
  aByTick: Map<number, number>
): TimingAnchor[] {
  let ticks = [...bByTick.keys()].sort((a, b) => a - b);
  if (ticks.length === 0) return anchorsFromBpm(120);

  // Tempo before the first B event: treat that BPM as starting at tick 0.
  if (ticks[0] > 0) {
    ticks = [0, ...ticks];
  }

  const milliAt = (tick: number, fallback: number) => {
    const v = bByTick.get(tick);
    return v !== undefined && v > 0 ? v : fallback;
  };

  let prevTick = ticks[0];
  const firstRealB = ticks.find((t) => bByTick.has(t)) ?? prevTick;
  let prevMilli = milliAt(prevTick, bByTick.get(firstRealB) ?? 120000);
  let prevBpm = prevMilli / 1000;
  if (!Number.isFinite(prevBpm) || prevBpm <= 0) prevBpm = 120;

  const startA = aByTick.get(prevTick);
  let timer =
    startA !== undefined && Number.isFinite(startA) ? startA / 1_000_000 : 0;

  const anchors: TimingAnchor[] = [
    {
      beat: prevTick / RESOLUTION,
      timer: Math.round(timer * 1_000_000) / 1_000_000,
    },
  ];

  for (let i = 1; i < ticks.length; i++) {
    const tick = ticks[i];
    const beats = (tick - prevTick) / RESOLUTION;
    const absA = aByTick.get(tick);
    if (absA !== undefined && Number.isFinite(absA)) {
      timer = absA / 1_000_000;
    } else {
      timer += beats * (60 / prevBpm);
    }

    anchors.push({
      beat: tick / RESOLUTION,
      timer: Math.round(timer * 1_000_000) / 1_000_000,
    });

    const nextMilli = bByTick.get(tick);
    if (nextMilli !== undefined && nextMilli > 0) {
      prevBpm = nextMilli / 1000;
    }
    prevTick = tick;
  }

  // Single B event → need a second point so beat↔time math has a span.
  if (anchors.length < 2) {
    const spb = 60 / prevBpm;
    anchors.push({
      beat: anchors[0].beat + 4,
      timer: Math.round((anchors[0].timer + 4 * spb) * 1_000_000) / 1_000_000,
    });
  }

  return sortTimingAnchors(anchors);
}

function eventsToPhases(entries: TrackEntry[]): SongPhase[] {
  const phases = entries
    .filter((entry) => entry.key === "E")
    .sort((a, b) => a.tick - b.tick)
    .map((entry) => {
      const rawName = entry.value.trim();
      return {
        beat: entry.tick / RESOLUTION,
        phase: 1 as const,
        power: 1,
        phaseName: rawName,
      };
    });

  return phases.length > 0
    ? phases
    : [{ beat: 0, phase: 1, power: 1, phaseName: "section Intro" }];
}

function drumEntriesToNotes(entries: TrackEntry[]): ChartNote[] {
  const drumEntries = entries
    .filter((entry) => entry.key === "N")
    .map((entry) => {
      const lane = Number(entry.value.split(/\s+/)[0]);
      return { tick: entry.tick, lane };
    })
    .filter((entry) => Number.isFinite(entry.lane));

  return normalizeChartNotes(chDrumEntriesToNotes(drumEntries, RESOLUTION));
}

export function parseChartFile(raw: string): { meta: MetaJson; charts: Record<Difficulty, ChartNote[]> } {
  const base = createEmptyMeta();
  const { song, tracks } = parseChartSections(raw);

  const charts: Record<Difficulty, ChartNote[]> = {
    easy: [],
    normal: [],
    hard: [],
    extreme: [],
  };

  for (const [section, entries] of tracks) {
    const difficulty = SECTION_TO_DIFFICULTY[section];
    if (difficulty) charts[difficulty] = drumEntriesToNotes(entries);
  }

  const syncEntries = tracks.get("SyncTrack") ?? [];
  const eventEntries = tracks.get("Events") ?? [];
  const offsetMs = Number(song.Offset ?? 0);
  const chartOffset = Number.isFinite(offsetMs) ? offsetMs / 1000 : 0;
  const rawTiming = syncTrackToAnchors(syncEntries);
  const { timing: songTiming, offset: songOffset } = normalizeImportedTiming(
    rawTiming,
    chartOffset
  );

  const meta: MetaJson = {
    ...base,
    NameSong: song.Name ?? base.NameSong,
    NameArtist: song.Artist ?? base.NameArtist,
    NameCharter: song.Charter ?? base.NameCharter,
    FilePath: song.MusicStream ?? "",
    SongOffsetSeconds: songOffset,
    SongTiming: songTiming,
    SongPhases: eventsToPhases(eventEntries).map((phase) => ({
      beat: phase.beat,
      phase: clampPhaseId(phase.phase),
      power: clampPower(phase.power),
      phaseName: phase.phaseName?.trim() || phaseById(phase.phase).label,
    })),
    ChartEasy: charts.easy,
    ChartNormal: charts.normal,
    ChartHard: charts.hard,
    ChartExtreme: charts.extreme,
  };

  return { meta, charts };
}

export function isChartFile(text: string): boolean {
  return /^\uFEFF?\[Song\]/m.test(text);
}