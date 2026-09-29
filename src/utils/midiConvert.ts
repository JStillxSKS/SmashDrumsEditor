import type {
  ChartNote,
  Difficulty,
  MetaJson,
  SongPhase,
  TimingAnchor,
} from "../types/meta";
import { NEUTRAL_STRENGTH, sortChartNotes } from "./chartNotes";
import { RESOLUTION } from "./resolution";
import { INDIES_AUDIO_FILE } from "./audioFormat";

/**
 * Standard MIDI File → Smash Drums chart converter, ported rule-for-rule from
 * scripts/midi_to_smash.py so in-editor imports produce the same charts as the
 * desktop converter pipeline the charter validated.
 *
 * Deliberately dependency-free: a hand-rolled SMF parser keeps per-channel,
 * per-track, per-tempo-event detail that high-level MIDI libraries hide.
 *
 * Pipeline (same order as the Python converter):
 *   parse → drum-source pick → velocity floors → dedupe → timing
 *   → snap to 1/16 grid → 1/8 hat limit → 2-pad chord cap → downchart
 */

// GM percussion → Smash instrument Id
// 0 Kick | 1 Snare | 2 Cymbal | 3 Tom | 4 Hi-hat | 5 Clapfire
const GM_TO_SMASH: ReadonlyMap<number, ChartNote["Id"]> = new Map([
  [35, 0], // Acoustic Bass Drum
  [36, 0], // Bass Drum 1
  [37, 1], // Side Stick → snare-ish
  [38, 1], // Acoustic Snare
  [39, 5], // Hand Clap → clapfire
  [40, 1], // Electric Snare
  [41, 3], // Low Floor Tom
  [42, 4], // Closed Hi-Hat
  [43, 3], // High Floor Tom
  [44, 4], // Pedal Hi-Hat
  [45, 3], // Low Tom
  [46, 4], // Open Hi-Hat
  [47, 3], // Low-Mid Tom
  [48, 3], // Hi-Mid Tom
  [49, 2], // Crash Cymbal 1
  [50, 3], // High Tom
  [51, 2], // Ride Cymbal 1
  [52, 2], // Chinese Cymbal
  [53, 2], // Ride Bell
  [54, 5], // Tambourine → clapfire
  [55, 2], // Splash Cymbal
  [56, 5], // Cowbell → clapfire
  [57, 2], // Crash Cymbal 2
  [59, 2], // Ride Cymbal 2
]);

const GM_KICK: ReadonlySet<number> = new Set([35, 36]);
const GM_SNARE: ReadonlySet<number> = new Set([37, 38, 40]);
const GM_HAT: ReadonlySet<number> = new Set([42, 44, 46]);
const GM_CYM: ReadonlySet<number> = new Set([49, 51, 52, 53, 55, 57, 59]);
const GM_TOM: ReadonlySet<number> = new Set([41, 43, 45, 47, 48, 50]);
const GM_CLAP: ReadonlySet<number> = new Set([39, 54, 56]);
const GM_KIT_CORE: ReadonlySet<number> = new Set([
  ...GM_KICK,
  ...GM_SNARE,
  ...GM_HAT,
  ...GM_CYM,
]);

// GM standard drum channel is 10 (1-based) → 9 in 0-based MIDI
const GM_DRUM_CHANNEL = 9;

// GM melodic bass program numbers (0-based) — never treat as drum kit
const GM_BASS_PROGRAMS: ReadonlySet<number> = new Set(Array.from({ length: 8 }, (_, i) => 32 + i));

const DRUM_NAME_RE = /\b(drum|drums|dr\.|kit|perc|percussion|rhythm|drms?)\b/i;
const BASS_NAME_RE = /\b(bass|basses|b\.?g\.?|bass\s*g(uit(ar)?)?|basso|contrabass|upright)\b/i;
const MELODIC_NAME_RE =
  /\b(guitar|gtr|piano|keys|synth|lead|vocal|voice|choir|string|violin|cello|organ|pad|brass|sax|flute|melody|solo|harp)\b/i;

// Drop very quiet hits (ghost notes / bleed become fake toms & clutter)
const DEFAULT_MIN_VELOCITY = 24;
// Toms are especially noisy (bass-guitar pitches land here) — stricter floor
const DEFAULT_TOM_MIN_VELOCITY = 40;

// Smash Drums is not a full kit: more than 2 pads at once is unplayable
const DEFAULT_MAX_CHORD = 2;

// Notes closer than 1/CHORD_WINDOW_SUBDIV of a beat count as one "stack"
// for the chord cap (a physical stroke spreads ~10–30 ms in MIDI).
const CHORD_WINDOW_SUBDIV = 32;

// Max hi-hat density (note subdivision of a whole note): 8 = 1/8 notes
const DEFAULT_HIHAT_SUBDIVISION = 8;
const HIHAT_ID = 4 as ChartNote["Id"];

// Snap every note to the nearest 1/DEFAULT_SPACING_SUBDIV beat so micro-timed
// hits land ON gridlines. 16 = sixteenths, the densest grid the converter uses.
const DEFAULT_SPACING_SUBDIV = 16;

// How close a MIDI tempo change must land to a whole beat to be representable
// by the game (SongTiming anchor beats are ints).
const TEMPO_ANCHOR_TOLERANCE = 0.02;

// Lower number = kept first when thinning a multi-hit chord
// Kick/snare form the groove; cymbal accents next; hats/toms/clapfire last.
const NOTE_PRIORITY: ReadonlyMap<number, number> = new Map([
  [0, 0], // Kick
  [1, 1], // Snare
  [2, 2], // Cymbal
  [5, 3], // Clapfire
  [4, 4], // Hi-hat
  [3, 5], // Tom
]);

const DRUM_MIN_SCORE = 25.0;

export type MidiImportReport = {
  bpm: number;
  bpmFloat: number;
  midiBpm: number;
  hasTempoChanges: boolean;
  timingMode: "tempo map" | "constant";
  anchorCount: number;
  channelMode: string;
  noteCountRaw: number;
  extremeCount: number;
  hardCount: number;
  normalCount: number;
  easyCount: number;
  skippedQuiet: number;
  skippedChannel: number;
  skippedBassTom: number;
  snappedMoved: number;
  snappedMerged: number;
  hihatDropped: number;
  chordDropped: number;
  chordsThinned: number;
};

export type MidiPackage = {
  meta: MetaJson;
  charts: Record<Difficulty, ChartNote[]>;
  report: MidiImportReport;
};

export function isMidiFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".mid") || name.endsWith(".midi");
}

// ---------------------------------------------------------------------------
// Numeric helpers — Python parity
// ---------------------------------------------------------------------------

/** Python 3 round(): half-to-even. Used everywhere a half-tick could differ. */
function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

function quantizeBeatPy(beat: number): number {
  return roundHalfEven(beat * RESOLUTION) / RESOLUTION;
}

function beatToTickPy(beat: number): number {
  return roundHalfEven(beat * RESOLUTION);
}

function beatInMeasure(beat: number): number {
  const m = beat % 4;
  return m < 0 ? m + 4 : m;
}

function isOnBeat(beat: number): boolean {
  const n = beatInMeasure(beat);
  return Math.abs(n - roundHalfEven(n)) < 1e-6 && roundHalfEven(n) % 2 === 0;
}

function isOffBeat(beat: number): boolean {
  const n = beatInMeasure(beat);
  return Math.abs(n - roundHalfEven(n)) < 1e-6 && roundHalfEven(n) % 2 === 1;
}

// ---------------------------------------------------------------------------
// Note list ops
// ---------------------------------------------------------------------------

function mkNote(beat: number, id: number): ChartNote {
  return { Beat: beat, Id: id as ChartNote["Id"], Strength: NEUTRAL_STRENGTH };
}

function dedupeNotes(notes: ChartNote[]): ChartNote[] {
  const best = new Map<string, ChartNote>();
  for (const n of notes) {
    const key = `${n.Beat}:${n.Id}`;
    const prev = best.get(key);
    if (!prev || n.Strength > prev.Strength) best.set(key, n);
  }
  return sortChartNotes([...best.values()]);
}

/**
 * Snap every note to the nearest 1/subdivision beat. Notes colliding on the
 * same cell + pad are the same physical hit and merge into one. Runs before
 * hat limiting and the chord cap so those see final positions.
 */
function snapToGrid(
  notes: ChartNote[],
  subdivision: number
): { notes: ChartNote[]; moved: number; merged: number } {
  if (subdivision <= 0) return { notes: sortChartNotes(notes), moved: 0, merged: 0 };
  const step = 4 / subdivision; // beats per grid cell (16 → 0.25)
  let moved = 0;
  const out: ChartNote[] = [];
  for (const n of notes) {
    const snapped = roundHalfEven(n.Beat / step) * step;
    if (Math.abs(snapped - n.Beat) > 1e-9) moved += 1;
    out.push(mkNote(snapped, n.Id));
  }
  const before = out.length;
  const deduped = dedupeNotes(out);
  return { notes: deduped, moved, merged: before - deduped.length };
}

function priorityOf(id: ChartNote["Id"]): number {
  return NOTE_PRIORITY.get(id) ?? 99;
}

function prioritySort(notes: ChartNote[]): ChartNote[] {
  return [...notes].sort(
    (a, b) => priorityOf(a.Id) - priorityOf(b.Id) || b.Strength - a.Strength || a.Id - b.Id
  );
}

/**
 * Cap simultaneous notes for Smash playability. Notes within 1/32 beat of the
 * stack's first note count as ONE stack, so a physical stroke that quantized
 * into adjacent beats can't escape the cap as a 3-pad wall.
 */
function capChordSize(
  notes: ChartNote[],
  maxChord: number = DEFAULT_MAX_CHORD
): { notes: ChartNote[]; dropped: number; thinned: number } {
  const cap = Math.max(1, Math.round(maxChord));
  const window = 1 / CHORD_WINDOW_SUBDIV;

  const stacks: ChartNote[][] = [];
  let cur: ChartNote[] = [];
  let curStart = 0;
  const sorted = sortChartNotes(notes);
  for (const n of sorted) {
    if (cur.length > 0 && n.Beat - curStart > window + 1e-9) {
      stacks.push(cur);
      cur = [];
    }
    if (cur.length === 0) curStart = n.Beat;
    cur.push(n);
  }
  if (cur.length > 0) stacks.push(cur);

  const out: ChartNote[] = [];
  let dropped = 0;
  let thinned = 0;
  for (const group of stacks) {
    if (group.length <= cap) {
      out.push(...group);
      continue;
    }
    const ranked = prioritySort(group);
    out.push(...ranked.slice(0, cap));
    dropped += group.length - cap;
    thinned += 1;
  }
  return { notes: sortChartNotes(out), dropped, thinned };
}

function subdivisionToGapBeats(subdivision: number): number {
  return 4 / Math.max(1, Math.round(subdivision));
}

/**
 * Cap hi-hat density (default 1/8 notes). Hats are grouped into subdivision
 * slots; the loudest hat in each slot is kept, then a min-gap pass resolves
 * boundary cases.
 */
function limitHihatRate(
  notes: ChartNote[],
  subdivision: number = DEFAULT_HIHAT_SUBDIVISION,
  instrumentId: ChartNote["Id"] = HIHAT_ID
): { notes: ChartNote[]; dropped: number } {
  const minGap = subdivisionToGapBeats(subdivision);

  const others: ChartNote[] = [];
  const hats: ChartNote[] = [];
  for (const n of notes) {
    if (n.Id === instrumentId) hats.push(n);
    else others.push(n);
  }
  if (hats.length === 0) return { notes: sortChartNotes(notes), dropped: 0 };

  // Prefer loud hits closest to the slot start (cleaner 1/8 feel)
  const hatScore = (n: ChartNote, slotBeat: number): [number, number] => [
    n.Strength,
    -Math.abs(n.Beat - slotBeat),
  ];
  const hatBetter = (a: [number, number], b: [number, number]): boolean =>
    a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1];

  // One candidate per slot [i*gap, (i+1)*gap)
  const best = new Map<number, ChartNote>();
  for (const h of hats) {
    const slot = Math.floor(h.Beat / minGap + 1e-9);
    const slotBeat = slot * minGap;
    const prev = best.get(slot);
    if (!prev || hatBetter(hatScore(h, slotBeat), hatScore(prev, slotBeat))) {
      best.set(slot, h);
    }
  }

  // Enforce min gap for boundary cases (e.g. 0.49 then 0.50)
  const kept: ChartNote[] = [];
  for (const slot of [...best.keys()].sort((a, b) => a - b)) {
    const h = best.get(slot)!;
    if (kept.length === 0) {
      kept.push(h);
      continue;
    }
    const gap = h.Beat - kept[kept.length - 1].Beat;
    if (gap + 1e-9 >= minGap) {
      kept.push(h);
    } else if (h.Strength > kept[kept.length - 1].Strength) {
      kept[kept.length - 1] = h;
    }
  }

  return { notes: sortChartNotes([...others, ...kept]), dropped: hats.length - kept.length };
}

// ---------------------------------------------------------------------------
// Downchart (ports scripts/midi_to_smash.py — priority order is canonical)
// ---------------------------------------------------------------------------

type LowerDiff = "hard" | "normal" | "easy";

function simplifyId(diff: LowerDiff, id: ChartNote["Id"]): ChartNote["Id"] {
  if (diff === "easy" && (id === 3 || id === 4 || id === 5)) return 2;
  if (diff === "normal" && id === 4) return 3;
  return id;
}

function applyDensityGate(
  diff: LowerDiff,
  beat: number,
  tickDelta: number,
  onBeat: boolean,
  offBeat: boolean
): { onBeat: boolean; offBeat: boolean; skip: boolean } {
  let on = onBeat;
  const off = offBeat;
  if (diff === "easy" && tickDelta > RESOLUTION * 3 && !off) on = true;
  if (diff === "normal" && tickDelta > RESOLUTION * 2 && !off) on = true;
  if (diff === "hard" && tickDelta >= RESOLUTION && !off) on = true;
  if (diff === "hard") {
    const n = beatInMeasure(beat);
    if (Math.abs(n * 2 - roundHalfEven(n * 2)) < 1e-6) on = true;
  }
  return { onBeat: on, offBeat: off, skip: !on && !off };
}

function pickNotesAtBeat(
  diff: LowerDiff,
  beat: number,
  notes: ChartNote[],
  onBeat: boolean,
  offBeat: boolean
): ChartNote[] {
  const sortedN = prioritySort(notes);
  const downbeat = Math.abs(beatInMeasure(beat)) < 1e-6;

  if (diff === "easy") {
    if (!onBeat) return [];
    for (const note of sortedN) {
      if (note.Id === 0 && downbeat) return [mkNote(note.Beat, 0)];
    }
    const first = sortedN.find((n) => n.Id !== 0) ?? sortedN[0];
    if (!first) return [];
    return [mkNote(first.Beat, simplifyId(diff, first.Id))];
  }

  if (diff === "normal") {
    if (onBeat) {
      for (const note of sortedN) {
        if (note.Id === 0 && downbeat) return [mkNote(note.Beat, 0)];
      }
      const first = sortedN.find((n) => n.Id !== 0) ?? sortedN[0];
      if (!first) return [];
      return [mkNote(first.Beat, simplifyId(diff, first.Id))];
    }
    if (offBeat) {
      const ret: ChartNote[] = [];
      for (const note of sortedN) {
        if (note.Id === 0) continue;
        ret.push(mkNote(note.Beat, simplifyId(diff, note.Id)));
        if (ret.length >= 2) break;
      }
      return ret;
    }
    return [];
  }

  // hard: max 2 pads, Smash priority
  if (onBeat) {
    const ret: ChartNote[] = [];
    for (const note of sortedN) {
      if (note.Id === 0) {
        ret.push(mkNote(note.Beat, 0));
        break;
      }
    }
    for (const note of sortedN) {
      if (note.Id === 0) continue;
      ret.push(mkNote(note.Beat, note.Id));
      break;
    }
    if (ret.length === 0 && sortedN.length > 0) {
      return [mkNote(sortedN[0].Beat, sortedN[0].Id)];
    }
    return ret;
  }
  if (offBeat) {
    const nonKick = sortedN.filter((n) => n.Id !== 0);
    const pool = sortedN.length > 2 ? nonKick : sortedN;
    return pool.slice(0, 2).map((n) => mkNote(n.Beat, n.Id));
  }
  return [];
}

function downchartDifficulty(extreme: ChartNote[], diff: LowerDiff): ChartNote[] {
  const byTick = new Map<number, ChartNote[]>();
  for (const note of extreme) {
    const tick = beatToTickPy(note.Beat);
    const list = byTick.get(tick);
    if (list) list.push(note);
    else byTick.set(tick, [note]);
  }

  const out: ChartNote[] = [];
  let prevTick = 0;
  for (const tick of [...byTick.keys()].sort((a, b) => a - b)) {
    const beat = tick / RESOLUTION;
    const tickDelta = tick - prevTick;
    const gate = applyDensityGate(
      diff,
      beat,
      tickDelta,
      isOnBeat(beat),
      isOffBeat(beat)
    );
    if (gate.skip) continue;
    const picked = pickNotesAtBeat(diff, beat, byTick.get(tick)!, gate.onBeat, gate.offBeat);
    out.push(...picked);
    if (picked.length > 0) prevTick = tick;
  }
  return sortChartNotes(out);
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** Constant-tempo map (beat 0, 1, end) — integer beats, float timers. */
function buildSongTiming(bpm: number, endBeat: number): TimingAnchor[] {
  const spb = 60 / bpm;
  const last = quantizeBeatPy(endBeat);
  const end = Math.max(4, Math.ceil(last - 1e-9));
  return [
    { beat: 0, timer: 0 },
    { beat: 1, timer: spb },
    { beat: end, timer: end * spb },
  ];
}

type TempoSegment = { beatStart: number; secStart: number; bpm: number };

/**
 * Beat→seconds anchors honoring every MIDI tempo change, or null when a
 * tempo change lands off-integer (the game can't represent it — caller
 * falls back to a constant tempo).
 */
function timingFromTempoMap(
  tpb: number,
  tempoMap: Array<[number, number]>,
  lastBeat: number
): { anchors: TimingAnchor[]; durationSec: number; effBpm: number } | null {
  const distinctTempos = new Set(tempoMap.map(([, tempo]) => tempo));
  if (distinctTempos.size < 2) return null;

  // (beatStart, secStart, bpm) per constant-tempo segment
  const segments: TempoSegment[] = [];
  let sec = 0;
  let prevTick = 0;
  let curTempo = tempoMap[0][1];
  for (let i = 1; i < tempoMap.length; i++) {
    const [tick, tempo] = tempoMap[i];
    if (tick <= prevTick) {
      curTempo = tempo; // same-tick redefinition — keep latest
      continue;
    }
    segments.push({ beatStart: prevTick / tpb, secStart: sec, bpm: 60 / (curTempo / 1_000_000) });
    sec += ((tick - prevTick) * (curTempo / 1_000_000)) / tpb;
    prevTick = tick;
    curTempo = tempo;
  }
  segments.push({ beatStart: prevTick / tpb, secStart: sec, bpm: 60 / (curTempo / 1_000_000) });

  const timeAtBeat = (beat: number): number => {
    let t = 0;
    for (const seg of segments) {
      if (beat < seg.beatStart - 1e-9) break;
      t = seg.secStart + ((beat - seg.beatStart) * 60) / seg.bpm;
    }
    return t;
  };

  // Tempo changes must sit on (near) integer beats for the game
  const changeBeats = segments.slice(1).map((s) => s.beatStart);
  for (const b of changeBeats) {
    if (Math.abs(b - roundHalfEven(b)) > TEMPO_ANCHOR_TOLERANCE) return null;
  }

  const wanted = new Set<number>([0, 1]);
  for (const b of changeBeats) wanted.add(roundHalfEven(b));
  const lastInt = Math.max(4, Math.ceil(quantizeBeatPy(lastBeat + 4.0) - 1e-9));
  wanted.add(lastInt);

  const anchors: TimingAnchor[] = [];
  for (const beatI of [...wanted].sort((a, b) => a - b)) {
    anchors.push({ beat: beatI, timer: timeAtBeat(beatI) });
  }

  const endSec = timeAtBeat(lastInt);
  const effBpm = endSec > 0 ? (lastInt / endSec) * 60 : 0;
  return { anchors, durationSec: endSec, effBpm };
}

/** Rebuild SongTiming after a beat shift (audio-lock path kept for parity). */
function applyTimingFix(
  notes: ChartNote[],
  bpm: number,
  beatShift: number
): { notes: ChartNote[]; timing: TimingAnchor[]; lastBeat: number; durationSec: number } {
  const shifted: ChartNote[] = [];
  for (const n of notes) {
    const b = quantizeBeatPy(n.Beat + beatShift);
    if (b < 0) continue;
    shifted.push(mkNote(b, n.Id));
  }
  const sorted = sortChartNotes(shifted);
  const lastBeat = sorted.length > 0 ? sorted[sorted.length - 1].Beat : 0;
  const timing = buildSongTiming(bpm, lastBeat + 4);
  const durationSec = bpm > 0 ? (lastBeat * 60) / bpm : 0;
  return { notes: sorted, timing, lastBeat, durationSec };
}

// ---------------------------------------------------------------------------
// Drum-source scoring / picking
// ---------------------------------------------------------------------------

function trackNameBonus(name: string): number {
  if (!name) return 0;
  if (DRUM_NAME_RE.test(name)) return 50;
  if (BASS_NAME_RE.test(name)) return -80;
  if (MELODIC_NAME_RE.test(name)) return -40;
  return 0;
}

/**
 * How drum-kit-like is this note source? Bass guitar pitches 41–50 collide
 * with GM toms — a source that is mostly those pitches with no kick/snare/hat
 * is bass, not toms.
 */
function scoreSourceAsDrums(
  notes: Array<[number, number, number]>,
  opts: { name: string; program: number | null; isGmDrumChannel: boolean }
): number {
  if (notes.length === 0) return -999;

  const total = notes.length;
  let kicks = 0;
  let hats = 0;
  let snares = 0;
  let cyms = 0;
  let toms = 0;
  let claps = 0;
  let other = 0;
  for (const [, pitch] of notes) {
    if (GM_KICK.has(pitch)) kicks += 1;
    else if (GM_SNARE.has(pitch)) snares += 1;
    else if (GM_HAT.has(pitch)) hats += 1;
    else if (GM_CYM.has(pitch)) cyms += 1;
    else if (GM_TOM.has(pitch)) toms += 1;
    else if (GM_CLAP.has(pitch)) claps += 1;
    else other += 1;
  }

  const kitCore = kicks + snares + hats + cyms;
  const perc = kitCore + toms + claps;
  let score = 0;

  if (opts.isGmDrumChannel) score += 40;
  score += trackNameBonus(opts.name);

  // Melodic bass programs on non-ch10 → almost never drums
  if (opts.program != null && GM_BASS_PROGRAMS.has(opts.program) && !opts.isGmDrumChannel) {
    score -= 100;
  } else if (opts.program != null && !opts.isGmDrumChannel && opts.program < 128) {
    // Other melodic programs (not percussion banks) — mild penalty
    if (opts.program !== 0 && kitCore < Math.max(3, total * 0.15)) score -= 20;
  }

  // Kit backbone is required for a high score
  score += Math.min(kicks, 40) * 2.5;
  score += Math.min(snares, 40) * 2.0;
  score += Math.min(hats, 40) * 1.5;
  score += Math.min(cyms, 20) * 1.0;
  score += Math.min(claps, 10) * 0.5;

  // Tom-only / tom-heavy with no kit core = bass guitar false positives
  if (kitCore === 0 && toms > 0) {
    score -= 60 + Math.min(toms, 50);
  } else if (toms > 0 && kitCore > 0) {
    const tomRatio = toms / Math.max(1, perc);
    if (tomRatio > 0.55 && kicks + snares < 4) score -= 35;
    else score += Math.min(toms, 15) * 0.3;
  }

  // Non-percussion pitches on this source (melody notes)
  if (other > 0) score -= Math.min(other, 80) * 0.8;

  // Fraction of notes that are true kit-core
  if (total > 0) {
    score += (kitCore / total) * 30;
    score -= (other / total) * 25;
  }

  return score;
}

type SourceKey = string; // `${trackIndex}:${channel}`

const srcKey = (ti: number, ch: number): SourceKey => `${ti}:${ch}`;

type SourcePick = {
  /** Sources to keep, or null = keep everything (--all-channels) */
  sources: Set<SourceKey> | null;
  mode: string;
  activeChannel: number | null;
};

function pickDrumSources(parsed: {
  notesRaw: Array<[number, number, number, number, number]>;
  trackNames: Map<number, string>;
  channelPrograms: Map<number, number>;
  trackPrograms: Map<number, number>;
  forcedChannel: number | null;
  allChannels: boolean;
  minVel: number;
}): SourcePick {
  const { notesRaw, trackNames, channelPrograms, trackPrograms } = parsed;

  if (parsed.forcedChannel != null) {
    const ch = Math.round(parsed.forcedChannel);
    if (ch < 0 || ch > 15) throw new Error(`MIDI channel must be 0–15 (got ${ch})`);
    const sources = new Set<SourceKey>();
    for (const [, , , c, ti] of notesRaw) {
      if (c === ch) sources.add(srcKey(ti, c));
    }
    if (sources.size === 0) sources.add(srcKey(0, ch));
    return { sources, mode: `forced ch${ch + 1}`, activeChannel: ch };
  }

  if (parsed.allChannels) {
    return { sources: null, mode: "all channels (--all-channels)", activeChannel: null };
  }

  // Group notes by (track, channel)
  const bySrc = new Map<SourceKey, Array<[number, number, number]>>();
  for (const [tick, note, vel, ch, ti] of notesRaw) {
    const key = srcKey(ti, ch);
    const list = bySrc.get(key);
    if (list) list.push([tick, note, vel]);
    else bySrc.set(key, [[tick, note, vel]]);
  }

  if (bySrc.size === 0) {
    return { sources: null, mode: "all (empty)", activeChannel: null };
  }

  const scored: Array<{ score: number; key: SourceKey; ti: number; ch: number; label: string }> =
    [];
  for (const [key, srcNotes] of bySrc) {
    const [tiS, chS] = key.split(":");
    const ti = Number(tiS);
    const ch = Number(chS);
    const name = trackNames.get(ti) ?? "";
    let program: number | null = trackPrograms.get(ti) ?? null;
    if (program == null) program = channelPrograms.get(ch) ?? null;
    const score = scoreSourceAsDrums(srcNotes, {
      name,
      program,
      isGmDrumChannel: ch === GM_DRUM_CHANNEL,
    });
    const label = name.trim() || `track${ti}`;
    scored.push({ score, key, ti, ch, label });
  }

  scored.sort((a, b) => b.score - a.score || a.ti - b.ti || a.ch - b.ch);
  const best = scored[0];

  // Prefer GM ch10 if it has any real kit-core hits (not just bass-range toms)
  const ch10Core = notesRaw.filter(
    ([, note, vel, ch]) => ch === GM_DRUM_CHANNEL && GM_KIT_CORE.has(note) && vel >= parsed.minVel
  ).length;
  if (ch10Core >= 4) {
    const sources = new Set<SourceKey>();
    for (const [, , , ch, ti] of notesRaw) {
      if (ch === GM_DRUM_CHANNEL) sources.add(srcKey(ti, ch));
    }
    return {
      sources,
      mode: "auto ch10 (kit-core drums)",
      activeChannel: GM_DRUM_CHANNEL,
    };
  }

  // Strong drum-like source → keep near-best sources that are clearly kit
  if (best.score >= DRUM_MIN_SCORE) {
    const keep = new Set<SourceKey>();
    for (const s of scored) {
      if (s.score >= Math.max(DRUM_MIN_SCORE, best.score - 20)) keep.add(s.key);
      else if (s.ch === best.ch && s.score >= DRUM_MIN_SCORE * 0.6) keep.add(s.key);
    }
    keep.add(best.key);

    // Drop sources that look like bass even if score was middling
    const filtered = new Set<SourceKey>();
    for (const key of keep) {
      const s = scored.find((e) => e.key === key)!;
      const name = trackNames.get(s.ti) ?? "";
      if (BASS_NAME_RE.test(name) && s.ch !== GM_DRUM_CHANNEL) continue;
      if (s.score < 0 && key !== best.key) continue;
      filtered.add(key);
    }
    const finalKeep = filtered.size > 0 ? filtered : new Set([best.key]);

    const chans = [...new Set([...finalKeep].map((k) => Number(k.split(":")[1])))].sort(
      (a, b) => a - b
    );
    if (finalKeep.size === 1) {
      return {
        sources: finalKeep,
        mode: `auto drums ('${best.label}' ch${best.ch + 1}, score ${Math.round(best.score)})`,
        activeChannel: best.ch,
      };
    }
    return {
      sources: finalKeep,
      mode:
        `auto drums multi (${finalKeep.size} sources, best '${best.label}' ` +
        `ch${best.ch + 1} score ${Math.round(best.score)}; chs ` +
        `${chans.map((c) => c + 1).join(",")})`,
      activeChannel: null,
    };
  }

  // Weak scores: still avoid pure bass sources
  const positive = scored.filter((s) => s.score >= 0).map((s) => s.key);
  if (positive.length > 0) {
    return {
      sources: new Set(positive),
      mode: `auto non-bass sources (${positive.length})`,
      activeChannel: null,
    };
  }

  // Last resort: single best source only (never "all channels" — that maps bass→toms)
  return {
    sources: new Set([best.key]),
    mode: `auto best-effort ('${best.label}' ch${best.ch + 1}, score ${Math.round(best.score)})`,
    activeChannel: best.ch,
  };
}

// ---------------------------------------------------------------------------
// Standard MIDI File parser
// ---------------------------------------------------------------------------

type RawNoteEvent = [number, number, number, number, number]; // tick, note, vel, channel, track

type ParsedSmf = {
  format: number;
  ticksPerBeat: number;
  notes: RawNoteEvent[];
  trackNames: Map<number, string>;
  channelPrograms: Map<number, number>;
  trackPrograms: Map<number, number>;
  tempoMap: Array<[number, number]>; // [absTick, µs per quarter]
};

function readVarLen(view: DataView, state: { pos: number }): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    if (state.pos >= view.byteLength) throw new Error("Unexpected end of MIDI file");
    const b = view.getUint8(state.pos++);
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) return value;
  }
  return value;
}

function parseSmf(bytes: Uint8Array): ParsedSmf {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const state = { pos: 0 };

  const readAscii = (n: number): string => {
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(view.getUint8(state.pos++));
    return s;
  };

  if (readAscii(4) !== "MThd") throw new Error("Not a Standard MIDI File (missing MThd header)");
  const headerLen = view.getUint32(state.pos);
  state.pos += 4;
  const format = view.getUint16(state.pos);
  state.pos += 2;
  const numTracks = view.getUint16(state.pos);
  state.pos += 2;
  const division = view.getUint16(state.pos);
  state.pos += 2;
  // Skip any header padding (headerLen > 6)
  state.pos += headerLen - 6;

  if (format === 2) throw new Error("MIDI format 2 is not supported");
  if ((division & 0x8000) !== 0) {
    throw new Error("SMPTE-time MIDI files are not supported (only ticks-per-beat)");
  }
  const ticksPerBeat = division;

  const notes: RawNoteEvent[] = [];
  const trackNames = new Map<number, string>();
  const channelPrograms = new Map<number, number>();
  const trackPrograms = new Map<number, number>();
  // (tick, µs/quarter) — seeded with the MIDI default like the Python parser
  const tempoEvents: Array<[number, number]> = [[0, 500000]];

  const textDecoder = new TextDecoder("utf-8");

  for (let ti = 0; ti < numTracks; ti++) {
    if (state.pos + 8 > view.byteLength) break;
    const chunkId = readAscii(4);
    const chunkLen = view.getUint32(state.pos);
    state.pos += 4;
    const trackEnd = state.pos + chunkLen;
    if (chunkId !== "MTrk") {
      state.pos = trackEnd;
      continue;
    }

    let absTick = 0;
    let runningStatus = 0;
    while (state.pos < trackEnd) {
      absTick += readVarLen(view, state);
      let status = view.getUint8(state.pos);
      if (status === 0xff) {
        state.pos++;
        const metaType = view.getUint8(state.pos++);
        const len = readVarLen(view, state);
        const dataStart = state.pos;
        if (metaType === 0x03) {
          trackNames.set(ti, textDecoder.decode(bytes.subarray(dataStart, dataStart + len)).trim());
        } else if (metaType === 0x51 && len === 3) {
          const usPerQuarter =
            (view.getUint8(dataStart) << 16) |
            (view.getUint8(dataStart + 1) << 8) |
            view.getUint8(dataStart + 2);
          tempoEvents.push([absTick, usPerQuarter]);
        }
        state.pos = dataStart + len;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        // SysEx — skip
        state.pos++;
        const len = readVarLen(view, state);
        state.pos += len;
        continue;
      }
      if (status >= 0x80) {
        runningStatus = status;
        state.pos++;
      } else if (runningStatus === 0) {
        throw new Error("Corrupt MIDI file (running status without a status byte)");
      } else {
        status = runningStatus;
      }

      const type = status & 0xf0;
      const channel = status & 0x0f;
      if (type === 0x90) {
        const note = view.getUint8(state.pos++);
        const velocity = view.getUint8(state.pos++);
        if (velocity > 0) notes.push([absTick, note, velocity, channel, ti]);
      } else if (type === 0xc0) {
        const program = view.getUint8(state.pos++);
        channelPrograms.set(channel, program);
        trackPrograms.set(ti, program);
      } else if (type === 0xd0) {
        state.pos += 1; // channel pressure — 1 data byte
      } else {
        state.pos += 2; // note off / poly pressure / CC / pitch bend — 2 data bytes
      }
    }
    state.pos = trackEnd;
  }

  // Merge tempo events: stable sort by tick; same-tick redefinitions keep the last
  tempoEvents.sort((a, b) => a[0] - b[0]);
  const tempoMap: Array<[number, number]> = [];
  for (const [tick, tempo] of tempoEvents) {
    if (tempoMap.length > 0 && tempoMap[tempoMap.length - 1][0] === tick) {
      tempoMap[tempoMap.length - 1] = [tick, tempo];
    } else {
      tempoMap.push([tick, tempo]);
    }
  }

  return {
    format,
    ticksPerBeat,
    notes,
    trackNames,
    channelPrograms,
    trackPrograms,
    tempoMap,
  };
}

// ---------------------------------------------------------------------------
// Parse → Extreme notes
// ---------------------------------------------------------------------------

type ParsedMidi = {
  tpb: number;
  extreme: ChartNote[];
  lastBeat: number;
  midiBpm: number;
  hasTempoChanges: boolean;
  tempoMap: Array<[number, number]>;
  channelMode: string;
  noteCountRaw: number;
  skippedQuiet: number;
  skippedChannel: number;
  skippedBassTom: number;
  minVelocity: number;
  tomMinVelocity: number;
};

function parseMidiBytes(bytes: Uint8Array, opts: {
  minVelocity?: number;
  tomMinVelocity?: number;
  channel?: number | null;
  allChannels?: boolean;
}): ParsedMidi {
  const smf = parseSmf(bytes);
  const tpb = smf.ticksPerBeat;
  const tempoMap = smf.tempoMap;
  const notesRaw = smf.notes;

  const midiBpm = 60_000_000 / tempoMap[0][1];

  const minVel = Math.max(1, Math.round(opts.minVelocity ?? DEFAULT_MIN_VELOCITY));
  // Toms never go below the default floor (watch for phantom toms)
  const tomFloor = Math.max(
    minVel,
    Math.max(DEFAULT_TOM_MIN_VELOCITY, Math.round(opts.tomMinVelocity ?? DEFAULT_TOM_MIN_VELOCITY))
  );

  const sourcePick = pickDrumSources({
    notesRaw,
    trackNames: smf.trackNames,
    channelPrograms: smf.channelPrograms,
    trackPrograms: smf.trackPrograms,
    forcedChannel: opts.channel ?? null,
    allChannels: opts.allChannels ?? false,
    minVel,
  });

  // Precompute per-source kit scores for the tom guard
  const bySrc = new Map<SourceKey, Array<[number, number, number]>>();
  for (const [tick, note, vel, ch, ti] of notesRaw) {
    const key = srcKey(ti, ch);
    const list = bySrc.get(key);
    if (list) list.push([tick, note, vel]);
    else bySrc.set(key, [[tick, note, vel]]);
  }
  const sourceScores = new Map<SourceKey, number>();
  for (const [key, srcNotes] of bySrc) {
    const ti = Number(key.split(":")[0]);
    const ch = Number(key.split(":")[1]);
    let program: number | null = smf.trackPrograms.get(ti) ?? null;
    if (program == null) program = smf.channelPrograms.get(ch) ?? null;
    sourceScores.set(
      key,
      scoreSourceAsDrums(srcNotes, {
        name: smf.trackNames.get(ti) ?? "",
        program,
        isGmDrumChannel: ch === GM_DRUM_CHANNEL,
      })
    );
  }

  const extreme: ChartNote[] = [];
  let skippedQuiet = 0;
  let skippedChannel = 0;
  let skippedBassTom = 0;

  for (const [tick, note, vel, ch, ti] of notesRaw) {
    if (sourcePick.sources !== null && !sourcePick.sources.has(srcKey(ti, ch))) {
      skippedChannel += 1;
      continue;
    }
    const smashId = GM_TO_SMASH.get(note);
    if (smashId == null) continue; // unmapped percussion — silently skipped

    // Extra tom guard: drop tom pitches from sources with no kit-core backbone
    if (smashId === 3) {
      const srcNotes = bySrc.get(srcKey(ti, ch)) ?? [];
      const coreHits = srcNotes.filter(([, p]) => GM_KIT_CORE.has(p)).length;
      if (coreHits < 2 && ch !== GM_DRUM_CHANNEL) {
        skippedBassTom += 1;
        continue;
      }
      if ((sourceScores.get(srcKey(ti, ch)) ?? 0) < 15 && ch !== GM_DRUM_CHANNEL && coreHits < 8) {
        skippedBassTom += 1;
        continue;
      }
    }

    const floor = smashId === 3 ? tomFloor : minVel;
    if (vel < floor) {
      skippedQuiet += 1;
      continue;
    }

    extreme.push(mkNote(quantizeBeatPy(tick / tpb), smashId));
  }

  const deduped = dedupeNotes(extreme);
  const lastBeat = deduped.length > 0 ? deduped[deduped.length - 1].Beat : 0;

  return {
    tpb,
    extreme: deduped,
    lastBeat,
    midiBpm,
    hasTempoChanges: new Set(tempoMap.map(([, t]) => t)).size > 1,
    tempoMap,
    channelMode: sourcePick.mode,
    noteCountRaw: notesRaw.length,
    skippedQuiet,
    skippedChannel,
    skippedBassTom,
    minVelocity: minVel,
    tomMinVelocity: tomFloor,
  };
}

// ---------------------------------------------------------------------------
// Meta helpers
// ---------------------------------------------------------------------------

/** Heuristic title/artist from demucs / stem naming: Artist__Song_drums_....mid */
export function guessMetaFromFilename(filename: string): [string, string] {
  let stem = filename.replace(/\.(mid|midi)$/i, "");
  stem = stem.replace(/_(drums?|drum|percussion)(_\d+)?$/i, "");
  stem = stem.replace(/_\d{10,}$/, "");

  if (stem.includes("__")) {
    const [artist, title] = stem.split("__", 2);
    return [artist.replace(/_/g, " ").trim(), (title ?? "").replace(/_/g, " ").trim()];
  }
  if (stem.includes(" - ")) {
    const idx = stem.indexOf(" - ");
    return [stem.slice(0, idx).trim(), stem.slice(idx + 3).trim()];
  }
  return ["Unknown Artist", stem.replace(/_/g, " ").trim()];
}

/** Audio filenames to look for next to a MIDI (same heuristic as the Python converter). */
export function midiSidecarAudioCandidates(filename: string): string[] {
  const stem = filename.replace(/\.(mid|midi)$/i, "");
  const base = stem.replace(/_(drums?|drum|percussion)(_\d+)?$/i, "").replace(/_\d{10,}$/, "");
  return [
    `${base}.ogg`,
    `${base}.mp3`,
    `${base}.wav`,
    `${base}.flac`,
    "song.ogg",
    "song.mp3",
    "audio.ogg",
    `${stem}.ogg`,
  ];
}

function buildPhases(lastBeat: number): SongPhase[] {
  const template: Array<Omit<SongPhase, "beat"> & { beat: number }> = [
    { beat: 0, phase: 1, power: 0.6, phaseName: "Intro" },
    { beat: 16, phase: 2, power: 0.7, phaseName: "Verse" },
    { beat: 80, phase: 4, power: 0.9, phaseName: "CHORUS" },
    { beat: 144, phase: 2, power: 0.7, phaseName: "Verse" },
    { beat: 208, phase: 4, power: 0.9, phaseName: "CHORUS" },
    { beat: 272, phase: 6, power: 0.85, phaseName: "Solo" },
    { beat: 336, phase: 4, power: 0.9, phaseName: "CHORUS" },
    { beat: 400, phase: 7, power: 0.7, phaseName: "Outro" },
  ];
  const phases = template
    .filter((p) => p.beat <= lastBeat + 4)
    .map((p) => ({ ...p, beat: quantizeBeatPy(p.beat) }));
  return phases.length > 0
    ? phases
    : [{ beat: 0, phase: 1, power: 0.7, phaseName: "Intro" }];
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * Convert a MIDI file into an editor-ready package (meta + all difficulties).
 * Throws with a human-readable message when the file can't be converted.
 */
export async function midiFileToPackage(file: File): Promise<MidiPackage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = parseMidiBytes(bytes, {});

  if (parsed.extreme.length === 0) {
    let hint = "";
    if (parsed.skippedChannel > 0 || parsed.skippedQuiet > 0) {
      hint =
        ` (dropped ${parsed.skippedChannel} other-channel, ${parsed.skippedQuiet} quiet hits — ` +
        `the drums may live on another channel)`;
    }
    throw new Error(`No mappable drum notes in ${file.name}${hint}`);
  }

  // Timing. The game requires whole-number anchor beats, and honors the full
  // anchor list — so when the MIDI has tempo changes that land on whole beats
  // we emit them exactly instead of flattening to one BPM (which drifts).
  let extreme = parsed.extreme;
  let timing: TimingAnchor[];
  let last: number;
  let bpmFloat: number;
  let timingMode: "tempo map" | "constant";

  const tempoMapFit = parsed.hasTempoChanges
    ? timingFromTempoMap(parsed.tpb, parsed.tempoMap, parsed.lastBeat)
    : null;

  if (tempoMapFit) {
    timing = tempoMapFit.anchors;
    bpmFloat = tempoMapFit.effBpm;
    timingMode = "tempo map";
    last = extreme.length > 0 ? extreme[extreme.length - 1].Beat : 0;
  } else {
    bpmFloat = parsed.midiBpm;
    const fixed = applyTimingFix(extreme, bpmFloat, 0);
    extreme = fixed.notes;
    timing = fixed.timing;
    last = fixed.lastBeat;
    timingMode = "constant";
  }

  // Snap to the 1/16 grid (micro-timed hits land ON gridlines), then the
  // always-on playability rules: 1/8 max hats, max 2 pads per stack.
  const snapped = snapToGrid(extreme, DEFAULT_SPACING_SUBDIV);
  extreme = snapped.notes;

  const hatLimited = limitHihatRate(extreme, DEFAULT_HIHAT_SUBDIVISION);
  extreme = hatLimited.notes;

  const chordCapped = capChordSize(extreme, DEFAULT_MAX_CHORD);
  extreme = chordCapped.notes;

  const hard = downchartDifficulty(extreme, "hard");
  const normal = downchartDifficulty(extreme, "normal");
  const easy = downchartDifficulty(extreme, "easy");

  const [gArtist, gTitle] = guessMetaFromFilename(file.name);
  const artist = gArtist.trim() || "Unknown Artist";
  const title = gTitle.trim() || file.name.replace(/\.(mid|midi)$/i, "");

  const meta: MetaJson = {
    NameArtist: artist,
    NameSong: title,
    NameCharter: "MIDI Convert",
    FilePath: INDIES_AUDIO_FILE,
    SongOffsetSeconds: 0,
    TimeSignature: { numerator: 4, denominator: 4 },
    SongTiming: timing,
    SongPhases: buildPhases(last),
    ChartEasy: easy,
    ChartNormal: normal,
    ChartHard: hard,
    ChartExtreme: extreme,
  };

  const charts: Record<Difficulty, ChartNote[]> = { easy, normal, hard, extreme };

  return {
    meta,
    charts,
    report: {
      bpm: Math.round(bpmFloat),
      bpmFloat,
      midiBpm: parsed.midiBpm,
      hasTempoChanges: parsed.hasTempoChanges,
      timingMode,
      anchorCount: timing.length,
      channelMode: parsed.channelMode,
      noteCountRaw: parsed.noteCountRaw,
      extremeCount: extreme.length,
      hardCount: hard.length,
      normalCount: normal.length,
      easyCount: easy.length,
      skippedQuiet: parsed.skippedQuiet,
      skippedChannel: parsed.skippedChannel,
      skippedBassTom: parsed.skippedBassTom,
      snappedMoved: snapped.moved,
      snappedMerged: snapped.merged,
      hihatDropped: hatLimited.dropped,
      chordDropped: chordCapped.dropped,
      chordsThinned: chordCapped.thinned,
    },
  };
}
