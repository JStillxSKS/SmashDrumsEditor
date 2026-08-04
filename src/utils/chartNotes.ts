import type { ChartNote, Difficulty, MetaJson } from "../types/meta";

/**
 * Editor charting intent.
 * Crystal (0) / Burning (2) are Arcade-only mechanics in Smash Drums.
 * Classic ignores strength — keep Classic charts Neutral only.
 */
export type ChartingMode = "arcade" | "classic";

export const NEUTRAL_STRENGTH = 1 as ChartNote["Strength"];

export function clampDrumId(id: number): ChartNote["Id"] {
  return Math.max(0, Math.min(5, Math.round(id))) as ChartNote["Id"];
}

export function clampDrumStrength(strength: number): ChartNote["Strength"] {
  return Math.max(0, Math.min(2, Math.round(strength))) as ChartNote["Strength"];
}

/** Crystal / Burning — Arcade strength types. Neutral is valid in both modes. */
export function isArcadeOnlyStrength(strength: ChartNote["Strength"]): boolean {
  return strength === 0 || strength === 2;
}

/** Strength to write for a new note under the current charting mode. */
export function strengthForChartingMode(
  strength: ChartNote["Strength"],
  mode: ChartingMode
): ChartNote["Strength"] {
  if (mode === "classic") return NEUTRAL_STRENGTH;
  return clampDrumStrength(strength);
}

export function neutralizeChartNotes(notes: ChartNote[]): ChartNote[] {
  let changed = false;
  const next = notes.map((note) => {
    if (!isArcadeOnlyStrength(note.Strength)) return note;
    changed = true;
    return { ...note, Strength: NEUTRAL_STRENGTH };
  });
  return changed ? next : notes;
}

export function neutralizeCharts(
  charts: Record<Difficulty, ChartNote[]>
): Record<Difficulty, ChartNote[]> {
  const easy = neutralizeChartNotes(charts.easy);
  const normal = neutralizeChartNotes(charts.normal);
  const hard = neutralizeChartNotes(charts.hard);
  const extreme = neutralizeChartNotes(charts.extreme);
  if (
    easy === charts.easy &&
    normal === charts.normal &&
    hard === charts.hard &&
    extreme === charts.extreme
  ) {
    return charts;
  }
  return { easy, normal, hard, extreme };
}

export function countArcadeStrengthNotes(
  charts: Record<Difficulty, ChartNote[]>
): number {
  let count = 0;
  for (const notes of Object.values(charts)) {
    for (const note of notes) {
      if (isArcadeOnlyStrength(note.Strength)) count += 1;
    }
  }
  return count;
}

function readNoteField(
  raw: Partial<ChartNote> & Record<string, unknown>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (value != null && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

export function normalizeChartNote(raw: Partial<ChartNote>): ChartNote | null {
  const extended = raw as Partial<ChartNote> & Record<string, unknown>;
  const beat = readNoteField(extended, "Beat", "beat");
  const id = readNoteField(extended, "Id", "id");
  if (beat == null || id == null) return null;

  return {
    Beat: Math.max(0, beat),
    Strength: clampDrumStrength(readNoteField(extended, "Strength", "strength") ?? 1),
    Id: clampDrumId(id),
  };
}

export function normalizeChartNotes(raw: unknown): ChartNote[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => normalizeChartNote(entry as Partial<ChartNote>))
    .filter((note): note is ChartNote => note !== null)
    .sort((a, b) => a.Beat - b.Beat || a.Id - b.Id || a.Strength - b.Strength);
}

export function sortChartNotes(notes: ChartNote[]): ChartNote[] {
  return [...notes].sort((a, b) => a.Beat - b.Beat || a.Id - b.Id || a.Strength - b.Strength);
}

export function extremeChartRequired(charts: Record<Difficulty, ChartNote[]>): boolean {
  return charts.extreme.length > 0;
}

export function validateIndiesCharts(charts: Record<Difficulty, ChartNote[]>): string[] {
  const issues: string[] = [];
  if (!extremeChartRequired(charts)) {
    issues.push("ChartExtreme is required — add at least one note on Extreme difficulty.");
  }
  return issues;
}

export function chartsIntoMeta(
  meta: MetaJson,
  charts: Record<Difficulty, ChartNote[]>
): MetaJson {
  return {
    ...meta,
    ChartEasy: normalizeChartNotes(charts.easy),
    ChartNormal: normalizeChartNotes(charts.normal),
    ChartHard: normalizeChartNotes(charts.hard),
    ChartExtreme: normalizeChartNotes(charts.extreme),
  };
}