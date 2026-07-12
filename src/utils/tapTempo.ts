import { normalizeSongBpm } from "./timing";

export const TAP_TEMPO_MIN_TAPS = 4;
export const TAP_TEMPO_MAX_TAPS = 24;
/** Ignore double-taps faster than this (seconds). */
export const TAP_TEMPO_MIN_INTERVAL = 0.18;
/** Drop intervals slower than this (seconds) — below ~40 BPM. */
export const TAP_TEMPO_MAX_INTERVAL = 1.6;

export type TapTempoEstimate = {
  bpm: number;
  /** Raw average of median-based BPM before whole-number snap */
  rawBpm: number;
  intervals: number[];
  tapCount: number;
  /** True when enough taps for a stable whole-number BPM */
  ready: boolean;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Chart-time taps → whole-number BPM via median inter-tap interval.
 * Uses song timeline seconds (not wall clock) so playback speed does not skew BPM.
 */
export function estimateBpmFromTapTimes(tapChartTimes: number[]): TapTempoEstimate | null {
  if (tapChartTimes.length < 2) {
    return {
      bpm: 120,
      rawBpm: 120,
      intervals: [],
      tapCount: tapChartTimes.length,
      ready: false,
    };
  }

  const sorted = [...tapChartTimes].sort((a, b) => a - b);
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const dt = sorted[i] - sorted[i - 1];
    if (dt >= TAP_TEMPO_MIN_INTERVAL && dt <= TAP_TEMPO_MAX_INTERVAL) {
      intervals.push(dt);
    }
  }

  if (intervals.length === 0) {
    return {
      bpm: 120,
      rawBpm: 120,
      intervals: [],
      tapCount: sorted.length,
      ready: false,
    };
  }

  const med = median(intervals);
  if (med <= 0) return null;

  let rawBpm = 60 / med;
  // Prefer mid-tempo whole numbers when half/double is ambiguous
  while (rawBpm < 70) rawBpm *= 2;
  while (rawBpm > 200) rawBpm /= 2;

  const bpm = normalizeSongBpm(rawBpm);
  return {
    bpm,
    rawBpm: Math.round(rawBpm * 10) / 10,
    intervals,
    tapCount: sorted.length,
    ready: sorted.length >= TAP_TEMPO_MIN_TAPS && intervals.length >= TAP_TEMPO_MIN_TAPS - 1,
  };
}

/**
 * After applying a new constant BPM, compute an offset delta so `tapChartTime`
 * lands on the nearest beat grid line (locks first tap to the grid).
 */
export function offsetDeltaToSnapTapToBeat(
  tapChartTime: number,
  beatAtTap: number,
  secondsPerBeat: number
): number {
  if (!Number.isFinite(tapChartTime) || !Number.isFinite(secondsPerBeat) || secondsPerBeat <= 0) {
    return 0;
  }
  // chartTime during play = audio + offset; beat ≈ chartTime / spb for constant tempo.
  // Shift offset so this tap lands on the nearest whole beat.
  const nearestBeat = Math.round(beatAtTap);
  const errorBeats = beatAtTap - nearestBeat;
  return -errorBeats * secondsPerBeat;
}
