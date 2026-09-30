import type { TimingAnchor } from "../types/meta";
import { chartToAudioTime } from "./offset";
import { RESOLUTION, beatToTick } from "./resolution";
import { beatToTime, timeToBeat } from "./timing";

export type WavePeak = { tick: number; amp: number };

/** Mirrored envelope half-width as a fraction of container width at waveScale 1 */
export const WAVE_WIDTH_FRAC = 0.4;

function measureAtTime(
  data: Float32Array,
  duration: number,
  audioTime: number,
  window: number
): number {
  const center = Math.floor((audioTime / duration) * data.length);
  let peak = 0;
  let sumSq = 0;
  let count = 0;

  for (let i = center - window; i <= center + window; i++) {
    if (i < 0 || i >= data.length) continue;
    const v = Math.abs(data[i]);
    peak = Math.max(peak, v);
    sumSq += v * v;
    count++;
  }

  if (count === 0) return 0;
  const rms = Math.sqrt(sumSq / count);
  return peak * 0.38 + rms * 0.62;
}

function smoothPeaks(peaks: WavePeak[], radius = 2): WavePeak[] {
  if (peaks.length < 3 || radius <= 0) return peaks;

  return peaks.map((peak, i) => {
    let sum = 0;
    let weight = 0;
    for (let d = -radius; d <= radius; d++) {
      const j = i + d;
      if (j < 0 || j >= peaks.length) continue;
      const w = radius + 1 - Math.abs(d);
      sum += peaks[j].amp * w;
      weight += w;
    }
    return { tick: peak.tick, amp: weight > 0 ? sum / weight : peak.amp };
  });
}

export function buildWaveformByTick(
  buffer: AudioBuffer,
  anchors: TimingAnchor[],
  offsetSeconds: number,
  tickStep = 16
): WavePeak[] {
  const data = buffer.getChannelData(0);
  const duration = buffer.duration;
  if (duration <= 0) return [];

  const endBeat = timeToBeat(duration + offsetSeconds, anchors);
  const maxTick = beatToTick(Math.max(0, endBeat)) + RESOLUTION;
  const peaks: WavePeak[] = [];
  const secondsPerTick =
    beatToTime(tickStep / RESOLUTION, anchors) - beatToTime(0, anchors) ||
    tickStep / RESOLUTION / 2;
  const window = Math.max(
    2,
    Math.floor((data.length / duration) * secondsPerTick * 0.85)
  );

  let maxAmp = 0;
  for (let tick = 0; tick <= maxTick; tick += tickStep) {
    const chartTime = beatToTime(tick / RESOLUTION, anchors);
    if (chartTime < offsetSeconds) {
      peaks.push({ tick, amp: 0 });
      continue;
    }
    const audioTime = chartToAudioTime(chartTime, offsetSeconds);
    const amp = measureAtTime(data, duration, audioTime, window);
    maxAmp = Math.max(maxAmp, amp);
    peaks.push({ tick, amp });
  }

  if (maxAmp <= 0) return peaks;

  // Normalize against a high percentile instead of the global max, so drum
  // transients reach the top of the range instead of being squashed by the
  // loudest moment of the song (the "plosives aren't visible" fix).
  const sorted = peaks.map((p) => p.amp).sort((a, b) => a - b);
  const norm = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] || maxAmp;
  const scale = norm > 0 ? norm : maxAmp;

  const normalized = peaks.map((p) => ({ tick: p.tick, amp: Math.min(1, p.amp / scale) }));
  return smoothPeaks(normalized, 2);
}