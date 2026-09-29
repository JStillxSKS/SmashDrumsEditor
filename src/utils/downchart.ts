import type { ChartNote } from "../types/meta";
import { sortChartNotes } from "./chartNotes";
import {
  BEATS_PER_MEASURE,
  RESOLUTION,
  beatToTick,
  beatsPerMeasure,
  type TimeSignature,
} from "./resolution";

export type LowerDifficulty = "hard" | "normal" | "easy";

const KICK: ChartNote["Id"] = 0;

/**
 * Thinning order for stacked notes — canonical order shared with the MIDI
 * converter (scripts/midi_to_smash.py): kick/snare form the groove, cymbal
 * accents next, hats/toms/clapfire are dropped first.
 */
const SMASH_NOTE_PRIORITY: Record<ChartNote["Id"], number> = {
  0: 0, // Kick
  1: 1, // Snare
  2: 2, // Cymbal
  5: 3, // Clapfire
  4: 4, // Hi-hat
  3: 5, // Tom
};

/** Beat index within a measure (0 … beatsPerBar). */
function beatInMeasure(beat: number, beatsPerBar = BEATS_PER_MEASURE): number {
  const bar = beatsPerBar > 0 ? beatsPerBar : BEATS_PER_MEASURE;
  const m = beat % bar;
  return m < 0 ? m + bar : m;
}

function isOnBeat(beat: number, beatsPerBar = BEATS_PER_MEASURE): boolean {
  const n = beatInMeasure(beat, beatsPerBar);
  return Math.abs(n - Math.round(n)) < 1e-6 && Math.round(n) % 2 === 0;
}

function isOffBeat(beat: number, beatsPerBar = BEATS_PER_MEASURE): boolean {
  const n = beatInMeasure(beat, beatsPerBar);
  return Math.abs(n - Math.round(n)) < 1e-6 && Math.round(n) % 2 === 1;
}

function applyDensityGate(
  diff: LowerDifficulty,
  beat: number,
  tickDelta: number,
  onBeat: boolean,
  offBeat: boolean,
  beatsPerBar = BEATS_PER_MEASURE
): { onBeat: boolean; offBeat: boolean; skip: boolean } {
  let on = onBeat;
  let off = offBeat;

  if (diff === "easy" && tickDelta > RESOLUTION * 3 && !off) on = true;
  if (diff === "normal" && tickDelta > RESOLUTION * 2 && !off) on = true;
  if (diff === "hard" && tickDelta >= RESOLUTION && !off) on = true;

  if (diff === "hard") {
    const n = beatInMeasure(beat, beatsPerBar);
    if (Math.abs(n * 2 - Math.round(n * 2)) < 1e-6) on = true;
  }

  const skip = !on && !off;
  return { onBeat: on, offBeat: off, skip };
}

function simplifyId(diff: LowerDifficulty, id: ChartNote["Id"]): ChartNote["Id"] {
  if (diff === "easy" && (id === 3 || id === 4 || id === 5)) return 2;
  if (diff === "normal" && id === 4) return 3;
  return id;
}

function copyNote(note: ChartNote, id: ChartNote["Id"]): ChartNote {
  return { Beat: note.Beat, Id: id, Strength: note.Strength };
}

function pickNotesAtBeat(
  diff: LowerDifficulty,
  beat: number,
  notes: ChartNote[],
  onBeat: boolean,
  offBeat: boolean,
  beatsPerBar = BEATS_PER_MEASURE
): ChartNote[] {
  const sorted = [...notes].sort(
    (a, b) =>
      SMASH_NOTE_PRIORITY[a.Id] - SMASH_NOTE_PRIORITY[b.Id] ||
      b.Strength - a.Strength ||
      a.Id - b.Id
  );
  const downbeat = Math.abs(beatInMeasure(beat, beatsPerBar)) < 1e-6;

  if (diff === "easy") {
    if (!onBeat) return [];
    for (const note of sorted) {
      if (note.Id === KICK && downbeat) return [copyNote(note, KICK)];
    }
    const first = sorted.find((n) => n.Id !== KICK) ?? sorted[0];
    if (!first) return [];
    return [copyNote(first, simplifyId(diff, first.Id))];
  }

  if (diff === "normal") {
    if (onBeat) {
      for (const note of sorted) {
        if (note.Id === KICK && downbeat) return [copyNote(note, KICK)];
      }
      const first = sorted.find((n) => n.Id !== KICK) ?? sorted[0];
      if (!first) return [];
      return [copyNote(first, simplifyId(diff, first.Id))];
    }
    if (offBeat) {
      const ret: ChartNote[] = [];
      for (const note of sorted) {
        if (note.Id === KICK) continue;
        ret.push(copyNote(note, simplifyId(diff, note.Id)));
        if (ret.length >= 2) break;
      }
      return ret;
    }
    return [];
  }

  // hard
  if (onBeat) {
    const ret: ChartNote[] = [];
    for (const note of sorted) {
      if (note.Id === KICK) {
        ret.push(copyNote(note, KICK));
        break;
      }
    }
    for (const note of sorted) {
      if (note.Id === KICK) continue;
      ret.push(copyNote(note, note.Id));
      break;
    }
    if (ret.length === 0 && sorted.length > 0) {
      return [copyNote(sorted[0], sorted[0].Id)];
    }
    return ret;
  }

  if (offBeat) {
    const nonKick = sorted.filter((n) => n.Id !== KICK);
    const pool = sorted.length > 2 ? nonKick : sorted;
    return pool.slice(0, 2).map((n) => copyNote(n, n.Id));
  }

  return [];
}

function downchartDifficulty(
  extreme: ChartNote[],
  diff: LowerDifficulty,
  beatsPerBar = BEATS_PER_MEASURE
): ChartNote[] {
  const byTick = new Map<number, ChartNote[]>();
  for (const note of extreme) {
    const tick = beatToTick(note.Beat);
    const list = byTick.get(tick) ?? [];
    list.push(note);
    byTick.set(tick, list);
  }

  const ticks = [...byTick.keys()].sort((a, b) => a - b);
  const out: ChartNote[] = [];
  let prevTick = 0;

  for (const tick of ticks) {
    const beat = tick / RESOLUTION;
    const notes = byTick.get(tick)!;
    const tickDelta = tick - prevTick;
    const gate = applyDensityGate(
      diff,
      beat,
      tickDelta,
      isOnBeat(beat, beatsPerBar),
      isOffBeat(beat, beatsPerBar),
      beatsPerBar
    );
    if (gate.skip) continue;

    const picked = pickNotesAtBeat(
      diff,
      beat,
      notes,
      gate.onBeat,
      gate.offBeat,
      beatsPerBar
    );
    out.push(...picked);
    if (picked.length > 0) prevTick = tick;
  }

  return sortChartNotes(out);
}

/** Generate Hard, Normal, and Easy charts from Extreme (Moonscraper / EasyChartGenerator style). */
export function generateLowerDifficulties(
  extreme: ChartNote[],
  timeSignature?: TimeSignature
): Record<LowerDifficulty, ChartNote[]> {
  const bar = timeSignature ? beatsPerMeasure(timeSignature) : BEATS_PER_MEASURE;
  return {
    hard: downchartDifficulty(extreme, "hard", bar),
    normal: downchartDifficulty(extreme, "normal", bar),
    easy: downchartDifficulty(extreme, "easy", bar),
  };
}

/** Fill empty lower difficulties from Extreme; leaves hand-edited charts untouched. */
export function chartsWithAutoDownchart(
  charts: Record<"easy" | "normal" | "hard" | "extreme", ChartNote[]>,
  timeSignature?: TimeSignature
): Record<"easy" | "normal" | "hard" | "extreme", ChartNote[]> {
  if (charts.extreme.length === 0) return charts;

  const needs =
    charts.hard.length === 0 || charts.normal.length === 0 || charts.easy.length === 0;
  if (!needs) return charts;

  const generated = generateLowerDifficulties(charts.extreme, timeSignature);
  return {
    extreme: charts.extreme,
    hard: charts.hard.length > 0 ? charts.hard : generated.hard,
    normal: charts.normal.length > 0 ? charts.normal : generated.normal,
    easy: charts.easy.length > 0 ? charts.easy : generated.easy,
  };
}