export type Difficulty = "easy" | "normal" | "hard" | "extreme";

export type PlacementMode = "phase" | "anchor" | "copy" | null;

export type ChartNote = {
  Beat: number;
  Strength: 0 | 1 | 2;
  Id: 0 | 1 | 2 | 3 | 4 | 5;
};

export type TimingAnchor = {
  beat: number;
  timer: number;
};

export type PhaseId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type SongPhase = {
  beat: number;
  phase: PhaseId;
  power: number;
  phaseName: string;
};

export type PhasePlacement = {
  phase: PhaseId;
  power: number;
  phaseName: string;
};

export const PHASE_TYPES: { id: PhaseId; label: string; color: string }[] = [
  { id: 1, label: "Intro", color: "#94a3b8" },
  { id: 2, label: "Verse", color: "#60a5fa" },
  { id: 3, label: "Prechorus", color: "#fbbf24" },
  { id: 4, label: "CHORUS", color: "#ffb800" },
  { id: 5, label: "Bridge", color: "#a78bfa" },
  { id: 6, label: "Solo", color: "#fb923c" },
  { id: 7, label: "Outro", color: "#64748b" },
];

export function phaseById(id: number) {
  return PHASE_TYPES.find((p) => p.id === id) ?? PHASE_TYPES[0];
}

export function clampPhaseId(n: number): PhaseId {
  return Math.max(1, Math.min(7, Math.round(n))) as PhaseId;
}

export function clampPower(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function sortSongPhases(phases: SongPhase[]): SongPhase[] {
  return [...phases].sort((a, b) => a.beat - b.beat);
}

export function getActivePhase(phases: SongPhase[], beat: number): SongPhase {
  const sorted = sortSongPhases(phases);
  let active = sorted[0];
  for (const ph of sorted) {
    if (beat >= ph.beat) active = ph;
  }
  return active;
}

/** Phase whose start beat was just crossed between two playhead positions */
export function findCrossedPhase(
  prevBeat: number,
  beat: number,
  phases: SongPhase[]
): SongPhase | null {
  if (prevBeat >= beat) return null;
  for (const ph of sortSongPhases(phases)) {
    if (prevBeat < ph.beat && beat >= ph.beat) return ph;
  }
  return null;
}

/** Editor-only key for tracking in-flight hit animations */
export function noteHitKey(note: ChartNote): string {
  return `${note.Beat}:${note.Id}:${note.Strength}`;
}

/** Notes struck as the playhead crosses their beat (forward playback only) */
export function findCrossedNotes(
  prevBeat: number,
  beat: number,
  notes: ChartNote[]
): ChartNote[] {
  if (prevBeat >= beat) return [];
  return notes.filter((note) => prevBeat < note.Beat && beat >= note.Beat);
}

export type MetaJson = {
  NameArtist: string;
  NameSong: string;
  NameCharter: string;
  FilePath: string;
  SongOffsetSeconds: number;
  SongTiming: TimingAnchor[];
  SongPhases: SongPhase[];
  ChartEasy: ChartNote[];
  ChartNormal: ChartNote[];
  ChartHard: ChartNote[];
  ChartExtreme: ChartNote[];
};

/**
 * Indies meta.json `Id` values (EditorDrumId).
 * Ground truth: Stacked Actors — e.g. beat 12 = Id 1+2 (snare+cymbal),
 * beat 13+ = Id 1+4 (snare+hi-hat). CH import remap: chartLaneMapping.ts.
 */
export const DRUM_INSTRUMENTS: Record<
  ChartNote["Id"],
  { name: string; color: string; description: string }
> = {
  0: { name: "Bass", color: "#0055ff", description: "blue drum" },
  1: { name: "Snare", color: "#ff2222", description: "red drum" },
  2: { name: "Cymbal", color: "#ffcc00", description: "yellow cymbal" },
  3: { name: "Tom", color: "#00cc44", description: "green drum" },
  4: { name: "Hi-Hat", color: "#ff66cc", description: "pink cymbal" },
  5: { name: "Clapfire", color: "#ff8800", description: "clapfire" },
};

/** Moonscraper / Clone Hero cymbal notes use lane + 64 (e.g. yellow cymbal = 66). */
export const CH_CYMBAL_OFFSET = 64;

export type DrumLane = {
  id: ChartNote["Id"];
  name: string;
  /** Short highway label shown under the instrument name */
  label: string;
  color: string;
  key: string;
  /** Clone Hero ExpertDrums pad 0–4 (kick, snare, yellow, blue, green). */
  chLane: number;
  /** Export as `chLane + CH_CYMBAL_OFFSET` when true. */
  chCymbal: boolean;
  /** False = no CH pad (omitted from notes.chart export). */
  chExport: boolean;
};

/**
 * Left-to-right Smash highway: hi-hat, snare, bass, cymbal, tom, clapfire.
 * Ids match Stacked Actors meta.json (pink=4, red=1, blue=0, yellow=2, green=3).
 */
export const DRUM_LANES: DrumLane[] = [
  {
    id: 4,
    name: DRUM_INSTRUMENTS[4].name,
    label: "Pink hi-hat",
    color: DRUM_INSTRUMENTS[4].color,
    key: "1",
    chLane: 2,
    chCymbal: true,
    chExport: true,
  },
  {
    id: 1,
    name: DRUM_INSTRUMENTS[1].name,
    label: "Red snare",
    color: DRUM_INSTRUMENTS[1].color,
    key: "2",
    chLane: 1,
    chCymbal: false,
    chExport: true,
  },
  {
    id: 0,
    name: DRUM_INSTRUMENTS[0].name,
    label: "Blue kick",
    color: DRUM_INSTRUMENTS[0].color,
    key: "3",
    chLane: 0,
    chCymbal: false,
    chExport: true,
  },
  {
    id: 2,
    name: DRUM_INSTRUMENTS[2].name,
    label: "Yellow cymbal",
    color: DRUM_INSTRUMENTS[2].color,
    key: "4",
    chLane: 3,
    chCymbal: true,
    chExport: true,
  },
  {
    id: 3,
    name: DRUM_INSTRUMENTS[3].name,
    label: "Green tom",
    color: DRUM_INSTRUMENTS[3].color,
    key: "5",
    chLane: 4,
    chCymbal: false,
    chExport: true,
  },
  {
    id: 5,
    name: DRUM_INSTRUMENTS[5].name,
    label: "Orange clapfire",
    color: DRUM_INSTRUMENTS[5].color,
    key: "6",
    chLane: 0,
    chCymbal: false,
    chExport: false,
  },
];

export type DrumId = (typeof DRUM_LANES)[number]["id"];

export function laneColumnIndex(id: DrumId): number {
  const col = DRUM_LANES.findIndex((l) => l.id === id);
  return col >= 0 ? col : 0;
}

export function laneIdFromColumn(column: number): DrumId {
  return DRUM_LANES[Math.max(0, Math.min(DRUM_LANES.length - 1, column))].id;
}

export function laneById(id: DrumId) {
  return DRUM_LANES.find((l) => l.id === id)!;
}

export const STRENGTHS = [
  { value: 0 as const, label: "Crystal" },
  { value: 1 as const, label: "Neutral" },
  { value: 2 as const, label: "Burning" },
] as const;

export const DIFFICULTIES: { key: Difficulty; label: string }[] = [
  { key: "easy", label: "Easy" },
  { key: "normal", label: "Normal" },
  { key: "hard", label: "Hard" },
  { key: "extreme", label: "Extreme" },
];