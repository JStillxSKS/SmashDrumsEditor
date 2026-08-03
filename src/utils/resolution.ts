/** Clone Hero / Moonscraper standard chart resolution */
export const RESOLUTION = 480;

/** Default 4/4 — prefer helpers that take a time signature. */
export const BEATS_PER_MEASURE = 4;
export const TICKS_PER_MEASURE = RESOLUTION * BEATS_PER_MEASURE;

/**
 * Default visual subdivision (1/8 note) when snap is coarser than this.
 * Finer snap values (1/16, 1/32, 1/64) draw grid lines at that resolution.
 */
export const VISUAL_GRID_TICKS = 240;

/** Default zoom — 64px per 1/8 row at startup. */
export const FIXED_PIXELS_PER_TICK = 64 / VISUAL_GRID_TICKS;

export const MIN_PIXELS_PER_TICK = 0.12;
export const MAX_PIXELS_PER_TICK = 2;

export function clampPixelsPerTick(ppt: number): number {
  return Math.max(MIN_PIXELS_PER_TICK, Math.min(MAX_PIXELS_PER_TICK, ppt));
}

/** Visual 1/8 row height — snap only affects placement, not zoom. */
export function visualGridRowPixels(pixelsPerTick: number): number {
  return VISUAL_GRID_TICKS * pixelsPerTick;
}

/**
 * Song meter (editor + Clone Hero `TS`).
 * Denominator is a note value (2 / 4 / 8 / 16). One editor beat = one quarter note.
 */
export type TimeSignature = {
  numerator: number;
  denominator: number;
};

export const DEFAULT_TIME_SIGNATURE: TimeSignature = {
  numerator: 4,
  denominator: 4,
};

/** Common meters for the picker. */
export const TIME_SIGNATURE_PRESETS: readonly TimeSignature[] = [
  { numerator: 4, denominator: 4 },
  { numerator: 3, denominator: 4 },
  { numerator: 2, denominator: 4 },
  { numerator: 5, denominator: 4 },
  { numerator: 6, denominator: 4 },
  { numerator: 7, denominator: 4 },
  { numerator: 6, denominator: 8 },
  { numerator: 9, denominator: 8 },
  { numerator: 12, denominator: 8 },
  { numerator: 5, denominator: 8 },
  { numerator: 7, denominator: 8 },
] as const;

const ALLOWED_DENOMINATORS = new Set([2, 4, 8, 16]);

export function formatTimeSignature(ts: TimeSignature): string {
  return `${ts.numerator}/${ts.denominator}`;
}

export function parseTimeSignatureLabel(label: string): TimeSignature | null {
  const m = label.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return null;
  return normalizeTimeSignature({
    numerator: Number(m[1]),
    denominator: Number(m[2]),
  });
}

/** Clamp to a sensible meter (num 1–32, denom 2/4/8/16). */
export function normalizeTimeSignature(
  raw: Partial<TimeSignature> | null | undefined
): TimeSignature {
  const numerator = Math.round(Number(raw?.numerator));
  const denominator = Math.round(Number(raw?.denominator));
  const num = Number.isFinite(numerator)
    ? Math.max(1, Math.min(32, numerator))
    : DEFAULT_TIME_SIGNATURE.numerator;
  const den = ALLOWED_DENOMINATORS.has(denominator)
    ? denominator
    : DEFAULT_TIME_SIGNATURE.denominator;
  return { numerator: num, denominator: den };
}

/**
 * Measure length in quarter-note beats (editor beat = quarter).
 * 4/4 → 4, 3/4 → 3, 6/8 → 3, 7/8 → 3.5
 */
export function beatsPerMeasure(ts: TimeSignature = DEFAULT_TIME_SIGNATURE): number {
  const { numerator, denominator } = normalizeTimeSignature(ts);
  return (numerator * 4) / denominator;
}

/** Ticks spanning one measure under the given meter. */
export function ticksPerMeasure(ts: TimeSignature = DEFAULT_TIME_SIGNATURE): number {
  return Math.round(beatsPerMeasure(ts) * RESOLUTION);
}

/**
 * Moonscraper / Clone Hero `TS` encoding:
 * - `TS N` → N/4 (second value defaults to 2 → 2^2 = 4)
 * - `TS N D` → N / 2^D  (D is log2 of the written denominator)
 */
export function timeSignatureToChartTs(ts: TimeSignature): string {
  const { numerator, denominator } = normalizeTimeSignature(ts);
  const exp = Math.round(Math.log2(denominator));
  if (exp === 2) return `TS ${numerator}`;
  return `TS ${numerator} ${exp}`;
}

/** Parse Moonscraper `TS` value string (after the key), e.g. `"4"` or `"6 3"`. */
export function chartTsToTimeSignature(value: string): TimeSignature {
  const parts = value.trim().split(/\s+/).map(Number);
  const numerator = Number.isFinite(parts[0]) && parts[0] > 0 ? Math.round(parts[0]) : 4;
  const exp =
    parts.length >= 2 && Number.isFinite(parts[1]) ? Math.round(parts[1]) : 2;
  const denominator = 2 ** Math.max(0, Math.min(4, exp));
  return normalizeTimeSignature({ numerator, denominator });
}

/** First TS event on the SyncTrack (lowest tick), or 4/4. */
export function timeSignatureFromSyncEntries(
  entries: { tick?: number; key: string; value: string }[]
): TimeSignature {
  const ts = entries
    .filter((e) => e.key === "TS")
    .sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0));
  if (ts.length === 0) return { ...DEFAULT_TIME_SIGNATURE };
  return chartTsToTimeSignature(ts[0].value);
}

export function snapOptions(ts: TimeSignature = DEFAULT_TIME_SIGNATURE) {
  const measureTicks = ticksPerMeasure(ts);
  return [
    { ticks: measureTicks, label: `1/1 (Measure ${formatTimeSignature(ts)})` },
    { ticks: 480, label: "1/4 (Beat)" },
    { ticks: 240, label: "1/8" },
    { ticks: 120, label: "1/16" },
    { ticks: 60, label: "1/32" },
    { ticks: 30, label: "1/64" },
  ] as const;
}

/** @deprecated Prefer snapOptions(timeSignature) */
export const SNAP_OPTIONS = snapOptions(DEFAULT_TIME_SIGNATURE);

/**
 * Tick step for highway grid lines.
 * - Snap 1/16–1/64 → draw every snap (you can see those ticks)
 * - Snap 1/8 or 1/4 → draw 1/8 lines
 * - Snap measure → draw beat lines so the bar isn’t empty
 */
export function visualGridStep(
  snapTicks: number,
  ts: TimeSignature = DEFAULT_TIME_SIGNATURE
): number {
  const snap = Math.max(1, Math.round(snapTicks) || VISUAL_GRID_TICKS);
  const measure = ticksPerMeasure(ts);
  if (snap >= measure) return RESOLUTION;
  if (snap >= VISUAL_GRID_TICKS) return VISUAL_GRID_TICKS;
  return snap;
}

/** Snap levels ordered coarse → fine (for −/+ buttons). */
export function snapLevels(ts: TimeSignature = DEFAULT_TIME_SIGNATURE): number[] {
  return snapOptions(ts).map((o) => o.ticks);
}

/** Step snap coarser (dir −1) or finer (dir +1). */
export function stepSnapTicks(
  current: number,
  direction: -1 | 1,
  ts: TimeSignature = DEFAULT_TIME_SIGNATURE
): number {
  const levels = snapLevels(ts);
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < levels.length; i++) {
    const d = Math.abs(levels[i] - current);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  const next = Math.max(0, Math.min(levels.length - 1, best + direction));
  return levels[next];
}

export function snapLabel(ticks: number, ts: TimeSignature = DEFAULT_TIME_SIGNATURE): string {
  const match = snapOptions(ts).find((o) => o.ticks === ticks);
  if (match) return match.label;
  return `${ticks}t`;
}

export function beatToTick(beat: number): number {
  return Math.round(beat * RESOLUTION);
}

export function tickToBeat(tick: number): number {
  return tick / RESOLUTION;
}

export function snapTick(rawTick: number, snapTicks: number): number {
  if (snapTicks <= 0) return Math.max(0, Math.round(rawTick));
  return Math.max(0, Math.round(rawTick / snapTicks) * snapTicks);
}

export function snapBeat(beat: number, snapTicks: number): number {
  return tickToBeat(snapTick(beatToTick(beat), snapTicks));
}

export function beatsEqual(a: number, b: number): boolean {
  return beatToTick(a) === beatToTick(b);
}

export function formatTick(
  tick: number,
  ts: TimeSignature = DEFAULT_TIME_SIGNATURE
): string {
  const tpm = ticksPerMeasure(ts);
  if (tpm <= 0) {
    return `B${Math.floor(tick / RESOLUTION)}`;
  }
  const measure = Math.floor(tick / tpm);
  const within = tick % tpm;
  const beatInMeasure = Math.floor(within / RESOLUTION);
  const sub = within % RESOLUTION;
  // For meters with non-integer quarter-beats (e.g. 7/8), show tick remainder after whole beats.
  if (sub === 0) return `M${measure}:B${beatInMeasure}`;
  return `M${measure}:B${beatInMeasure}+${sub}`;
}
