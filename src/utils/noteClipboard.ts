import type { ChartNote } from "../types/meta";
import { laneColumnIndex } from "../types/meta";
import { sortChartNotes } from "./chartNotes";
import { beatToTick, RESOLUTION, snapBeat } from "./resolution";

export const NOTE_CLIPBOARD_MARKER = "drumeditor-notes";

export type NoteClipboardPayload = {
  version: 1;
  notes: ChartNote[];
  /** Beat of the earliest copied note — paste puts this on the strike bar. */
  anchorBeat: number;
};

export function selectionFirstBeat(notes: ChartNote[]): number {
  return Math.min(...notes.map((n) => n.Beat));
}

export function viewportTickRange(
  scrollTick: number,
  pixelsPerTick: number,
  canvasHeight: number,
  strikeOffset = 150,
  laneHeaderH = 44
): { minTick: number; maxTick: number } {
  const sy = canvasHeight - strikeOffset;
  const viewTop = scrollTick + Math.ceil((sy - laneHeaderH) / pixelsPerTick);
  const viewBottom =
    scrollTick - Math.ceil((canvasHeight - sy + 80) / pixelsPerTick) - RESOLUTION;
  return {
    minTick: Math.max(0, viewBottom),
    maxTick: Math.max(0, viewTop),
  };
}

export function notesInTickRange(
  notes: ChartNote[],
  minTick: number,
  maxTick: number
): ChartNote[] {
  const lo = Math.min(minTick, maxTick);
  const hi = Math.max(minTick, maxTick);
  return notes.filter((note) => {
    const tick = beatToTick(note.Beat);
    return tick >= lo && tick <= hi;
  });
}

export function notesInSelectionRect(
  notes: ChartNote[],
  anchorTick: number,
  currentTick: number,
  anchorCol: number,
  currentCol: number
): ChartNote[] {
  const loT = Math.min(anchorTick, currentTick);
  const hiT = Math.max(anchorTick, currentTick);
  const loC = Math.min(anchorCol, currentCol);
  const hiC = Math.max(anchorCol, currentCol);
  return notes.filter((note) => {
    const tick = beatToTick(note.Beat);
    if (tick < loT || tick > hiT) return false;
    const col = laneColumnIndex(note.Id);
    return col >= loC && col <= hiC;
  });
}

export function shiftNotes(notes: ChartNote[], beatDelta: number): ChartNote[] {
  return notes.map((note) => ({
    ...note,
    Beat: Math.max(0, Math.round((note.Beat + beatDelta) * 1000) / 1000),
  }));
}

export function mergeNotes(existing: ChartNote[], incoming: ChartNote[]): ChartNote[] {
  const byCell = new Map<string, ChartNote>();
  for (const note of existing) {
    byCell.set(`${beatToTick(note.Beat)}:${note.Id}`, note);
  }
  for (const note of incoming) {
    byCell.set(`${beatToTick(note.Beat)}:${note.Id}`, note);
  }
  return sortChartNotes([...byCell.values()]);
}

export function serializeClipboard(payload: NoteClipboardPayload): string {
  return JSON.stringify({ [NOTE_CLIPBOARD_MARKER]: payload.version, ...payload });
}

export function parseClipboard(text: string): NoteClipboardPayload | null {
  try {
    const data = JSON.parse(text) as Partial<NoteClipboardPayload> & Record<string, unknown>;
    if (data[NOTE_CLIPBOARD_MARKER] !== 1) return null;
    if (!Array.isArray(data.notes) || data.notes.length === 0) return null;
    const notes = data.notes
      .map((raw) => {
        const note = raw as Partial<ChartNote>;
        if (note.Beat == null || note.Id == null) return null;
        return {
          Beat: Math.max(0, Number(note.Beat)),
          Id: Math.max(0, Math.min(5, Math.round(Number(note.Id)))) as ChartNote["Id"],
          Strength: Math.max(0, Math.min(2, Math.round(Number(note.Strength ?? 1)))) as ChartNote["Strength"],
        };
      })
      .filter((note): note is ChartNote => note !== null);
    if (notes.length === 0) return null;
    const anchorBeat =
      typeof data.anchorBeat === "number"
        ? data.anchorBeat
        : selectionFirstBeat(notes);
    return { version: 1, notes, anchorBeat };
  } catch {
    return null;
  }
}

export function pastePayloadAtBeat(
  payload: NoteClipboardPayload,
  strikeBeat: number,
  snapTicks: number
): ChartNote[] {
  const target = snapBeat(strikeBeat, snapTicks);
  return shiftNotes(payload.notes, target - payload.anchorBeat);
}