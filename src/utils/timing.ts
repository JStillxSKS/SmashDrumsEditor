import type { ChartNote, Difficulty, MetaJson, TimingAnchor } from "../types/meta";
import { RESOLUTION } from "./resolution";

export function sortTimingAnchors(anchors: TimingAnchor[]): TimingAnchor[] {
  return [...anchors].sort((a, b) => a.beat - b.beat || a.timer - b.timer);
}

export function beatToTime(beat: number, anchors: TimingAnchor[]): number {
  if (anchors.length === 0) return 0;
  const sorted = [...anchors].sort((a, b) => a.beat - b.beat);

  if (beat <= sorted[0].beat) {
    if (sorted.length < 2) return sorted[0].timer;
    const [a, b] = sorted;
    return a.timer + ((beat - a.beat) * (b.timer - a.timer)) / (b.beat - a.beat);
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (beat >= a.beat && beat <= b.beat) {
      const ratio = (beat - a.beat) / (b.beat - a.beat);
      return a.timer + ratio * (b.timer - a.timer);
    }
  }

  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  return last.timer + ((beat - last.beat) * (last.timer - prev.timer)) / (last.beat - prev.beat);
}

export function timeToBeat(time: number, anchors: TimingAnchor[]): number {
  if (anchors.length === 0) return 0;
  const sorted = [...anchors].sort((a, b) => a.beat - b.beat);

  if (time <= sorted[0].timer) {
    if (sorted.length < 2) return sorted[0].beat;
    const [a, b] = sorted;
    return a.beat + ((time - a.timer) * (b.beat - a.beat)) / (b.timer - a.timer);
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (time >= a.timer && time <= b.timer) {
      const ratio = (time - a.timer) / (b.timer - a.timer);
      return a.beat + ratio * (b.beat - a.beat);
    }
  }

  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  return last.beat + ((time - last.timer) * (last.beat - prev.beat)) / (last.timer - prev.timer);
}

export function bpmFromAnchors(anchors: TimingAnchor[]): number {
  const sorted = [...anchors].sort((a, b) => a.beat - b.beat);
  if (sorted.length < 2) return 120;
  const span = sorted[1].timer - sorted[0].timer;
  const beats = sorted[1].beat - sorted[0].beat;
  if (span <= 0 || beats <= 0) return 120;
  return normalizeSongBpm((beats / span) * 60);
}

/** Whole-number song BPM (40–300), matching the toolbar field. */
export function normalizeSongBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120;
  return Math.round(Math.max(40, Math.min(300, bpm)));
}

/** Snap a beat to the internal tick grid (480 ticks/beat). */
export function quantizeBeat(beat: number): number {
  if (!Number.isFinite(beat)) return 0;
  return Math.max(0, Math.round(beat * RESOLUTION) / RESOLUTION);
}

/**
 * Constant-tempo map matching common Indies packs:
 * beat 0, beat 1 (defines BPM), and an end anchor.
 */
export function buildConstantBpmTiming(bpm: number, endBeat = 4): TimingAnchor[] {
  const whole = normalizeSongBpm(bpm);
  const spb = 60 / whole;
  const end = Math.max(4, quantizeBeat(endBeat));
  if (end <= 1) {
    return [
      { beat: 0, timer: 0 },
      { beat: 1, timer: spb },
    ];
  }
  return [
    { beat: 0, timer: 0 },
    { beat: 1, timer: spb },
    { beat: end, timer: end * spb },
  ];
}

/** Minimal two-point map (beat 0 → 4). Prefer buildConstantBpmTiming for full songs. */
export function anchorsFromBpm(bpm: number): TimingAnchor[] {
  const whole = normalizeSongBpm(bpm);
  const spb = 60 / whole;
  return [
    { beat: 0, timer: 0 },
    { beat: 4, timer: 4 * spb },
  ];
}

/** Map a beat through absolute time so hits stay locked to the audio. */
export function remapBeatAcrossTiming(
  beat: number,
  oldTiming: TimingAnchor[],
  newTiming: TimingAnchor[]
): number {
  const time = beatToTime(beat, oldTiming);
  return quantizeBeat(timeToBeat(time, newTiming));
}

/**
 * Apply a new constant whole-number BPM.
 *
 * Notes and phases keep their beat numbers (grid-locked). Only the tempo map
 * changes, so hits move with the grid relative to the audio — the usual way to
 * fix "lines up at the start, drifts a notch by the end".
 *
 * Smash / Indies expect integer BPM; fractional tempos are not used.
 */
export function applyConstantBpmChange(
  meta: MetaJson,
  charts: Record<Difficulty, ChartNote[]>,
  bpm: number
): { meta: MetaJson; charts: Record<Difficulty, ChartNote[]>; changed: boolean } {
  const whole = normalizeSongBpm(bpm);
  const oldTiming = sortTimingAnchors(meta.SongTiming);

  if (oldTiming.length >= 2 && bpmFromAnchors(oldTiming) === whole) {
    // Already this integer BPM — do not rebuild anchors (avoids tiny timer jitter).
    return { meta, charts, changed: false };
  }

  const endBeat = Math.max(4, quantizeBeat(maxContentBeat(meta, charts) + 4));
  const newTiming = buildConstantBpmTiming(whole, endBeat);

  return {
    meta: { ...meta, SongTiming: newTiming },
    charts,
    changed: true,
  };
}

export function bpmAtAnchor(anchors: TimingAnchor[], index: number): number {
  const sorted = sortTimingAnchors(anchors);
  if (sorted.length < 2) return 120;

  if (index < sorted.length - 1) {
    const a = sorted[index];
    const b = sorted[index + 1];
    const span = b.timer - a.timer;
    const beats = b.beat - a.beat;
    if (span > 0 && beats > 0) return (beats / span) * 60;
  }

  if (index > 0) {
    const a = sorted[index - 1];
    const b = sorted[index];
    const span = b.timer - a.timer;
    const beats = b.beat - a.beat;
    if (span > 0 && beats > 0) return (beats / span) * 60;
  }

  return 120;
}

export function maxContentBeat(
  meta: MetaJson,
  charts: Record<Difficulty, ChartNote[]>
): number {
  let max = 0;
  for (const anchor of meta.SongTiming) max = Math.max(max, anchor.beat);
  for (const phase of meta.SongPhases) max = Math.max(max, phase.beat);
  for (const notes of Object.values(charts)) {
    for (const note of notes) max = Math.max(max, note.Beat);
  }
  return max;
}

/** Ensure a closing anchor exists through the last charted beat. */
export function ensureEndAnchor(
  anchors: TimingAnchor[],
  endBeat: number
): TimingAnchor[] {
  const sorted = sortTimingAnchors(anchors);
  if (sorted.length === 0) return anchorsFromBpm(120);

  const last = sorted[sorted.length - 1];
  if (last.beat >= endBeat - 1 / 480) return sorted;

  return [
    ...sorted,
    { beat: endBeat, timer: beatToTime(endBeat, sorted) },
  ];
}

/** Collapse per-beat anchors into tempo-change points for [SyncTrack]. */
export function simplifyAnchorsForSync(
  anchors: TimingAnchor[],
  toleranceBpm = 0.25
): TimingAnchor[] {
  const sorted = sortTimingAnchors(anchors);
  if (sorted.length <= 2) return sorted;

  const result: TimingAnchor[] = [sorted[0]];
  let lastBpm = bpmAtAnchor(sorted, 0);

  for (let i = 1; i < sorted.length; i++) {
    const bpm = bpmAtAnchor(sorted, i);
    if (Math.abs(bpm - lastBpm) > toleranceBpm) {
      result.push(sorted[i]);
      lastBpm = bpm;
    }
  }

  const tail = sorted[sorted.length - 1];
  const prev = result[result.length - 1];
  if (Math.abs(prev.beat - tail.beat) > 1 / 480 || Math.abs(prev.timer - tail.timer) > 0.001) {
    result.push(tail);
  }

  return result.length >= 2 ? result : sorted.slice(0, 2);
}

export function prepareSyncAnchors(
  meta: MetaJson,
  charts: Record<Difficulty, ChartNote[]>
): TimingAnchor[] {
  const endBeat = Math.max(maxContentBeat(meta, charts), 4);
  return simplifyAnchorsForSync(ensureEndAnchor(meta.SongTiming, endBeat));
}

