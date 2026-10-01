import type { ChartNote, TimingAnchor } from "../types/meta";
import { NEUTRAL_STRENGTH, sortChartNotes } from "./chartNotes";
import {
  BEATS_PER_MEASURE,
  beatsPerMeasure,
  type TimeSignature,
} from "./resolution";
import { bpmAtBeat } from "./timing";

export type LowerDifficulty = "hard" | "normal" | "easy";

/**
 * Difficulty downcharting: Extreme → Hard → Normal → Easy.
 *
 * Ported rule-for-rule from Auto-Charter's charter/downchart.py, which
 * implements the official Harmonix / Rock Band Network drum reduction
 * guidelines. Each tier is derived from the previous one (cascading), so
 * Easy ⊆ Normal ⊆ Hard. Strength is preserved from the source note, except
 * Hard's accent demotion (Burning snare → Neutral).
 *
 *   Hard   No 16th-note rolls at ≥ 140 BPM (same-lane 0.25-beat runs thinned
 *          to 8ths); no constant 8ths at ≥ 170 BPM (thinned to quarters);
 *          kick runs denser than 8ths keep every other hit; all kicks removed
 *          inside fills; every other snare accent (Burning) demoted to
 *          Neutral; never two crash cymbals in one stack; chords capped at
 *          2 notes (kick + highest-priority pad).
 *   Normal Quarter-note grid at ≥ 140 BPM, eighth-note grid below; kicks on
 *          quarter beats only at ≥ 105 BPM (midpoint of the RBN 100–110
 *          band); at most one kick per bar at ≥ 170 BPM; no three-limb hits
 *          (kick+snare+cymbal drops the kick); fills one-handable (one note
 *          per 8th); hi-hats become toms; a crash keeps its kick only on a
 *          bar downbeat.
 *   Easy   Quarter-note grid only; one kick per bar at ≥ 170 BPM; every
 *          chord collapses to a single note (kick on bar downbeats, else the
 *          highest-priority pad); toms, hats and clapfire become cymbals.
 *
 * Repeat-grouping: bars are grouped by pattern signature — the tuple of
 * (16th-grid position in bar, Id) — and each group is reduced once using its
 * densest member (most notes, then highest local BPM); the same kept
 * positions/ids are then applied to every member, so a riff that repeats
 * sounds identical every time. BPM-dependent rules use the representative's
 * local tempo (from `timing`) for the whole group; without `timing` a
 * constant 120 BPM is assumed.
 *
 * Fill bars come from a port of Auto-Charter's charter/fills.py heuristic
 * (backbeat dropout + tom share + density delta + lane-histogram distance),
 * detected on the Extreme chart before any reduction.
 */

// --- Lane ids (Auto-Charter charter/types.py) -------------------------------
const KICK = 0 as ChartNote["Id"];
const SNARE = 1 as ChartNote["Id"];
const CYMBAL = 2 as ChartNote["Id"];
const TOM = 3 as ChartNote["Id"];
// 4 = Hi-hat, 5 = Clapfire (referenced via simplifyId only)

const BURNING_STRENGTH = 2 as ChartNote["Strength"];

/** Lower number = kept first when thinning a stack (kick/snare = groove). */
const NOTE_PRIORITY: Record<ChartNote["Id"], number> = {
  0: 0, // Kick
  1: 1, // Snare
  2: 2, // Cymbal
  5: 3, // Clapfire
  4: 4, // Hi-hat
  3: 5, // Tom
};

const _TOL = 1e-6;
const STACK_WINDOW = 1 / 32; // notes within 1/32 beat count as one chord stack
const MIN_RUN = 3; // a "run"/"roll" is at least 3 evenly spaced hits

const HARD_16TH_ROLL_BPM = 140;
const HARD_8TH_CAP_BPM = 170;
const NORMAL_QUARTER_GRID_BPM = 140;
const NORMAL_KICK_QUARTER_BPM = 105; // midpoint of the RBN "100-110 BPM" band
const ONE_KICK_PER_BAR_BPM = 170;
const FILL_NOTE_GAP = 0.5;
const FALLBACK_BPM = 120;

// --- Fill detection (charter/fills.py) --------------------------------------
const BACKBEAT_POSITIONS = [1.0, 3.0]; // beats 2 and 4 of a 4/4 bar, in beats
const BACKBEAT_TOL = 0.26;
const FILL_THRESHOLD = 0.5;
const MIN_FILL_EVENTS = 3;
const W_BACKBEAT = 0.35;
const W_TOM = 0.25;
const W_DENSITY = 0.25;
const W_HIST = 0.15;
const N_LANES = 6;

/** Python 3 round(): half-to-even. Half-cell positions must match exactly. */
function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Python % semantics — result takes the divisor's sign (always ≥ 0 here). */
function pyMod(a: number, n: number): number {
  const m = a % n;
  return m < 0 ? m + n : m;
}

/** Python statistics.median (average of the two middle values when even). */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function cosineDistance(a: number[], b: number[]): number {
  let na = 0;
  let nb = 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    na += a[i] * a[i];
    nb += b[i] * b[i];
    dot += a[i] * b[i];
  }
  na = Math.sqrt(na);
  nb = Math.sqrt(nb);
  if (na < 1e-9 || nb < 1e-9) return 0;
  return 1 - dot / (na * nb);
}

/**
 * Acoustic per-bar fill scoring — a bar looks like a fill when the groove
 * breaks: the backbeat drops out (strongest cue), hits route to toms,
 * density spikes vs the typical bar, and the lane histogram shifts vs the
 * previous bar. Returns the 0-based fill bar indices.
 */
function detectFillBars(notes: ChartNote[], beatsPerBar: number): Set<number> {
  const fillBars = new Set<number>();
  if (notes.length === 0) return fillBars;

  const byBar = new Map<number, ChartNote[]>();
  for (const n of notes) {
    const b = Math.floor(n.Beat / beatsPerBar);
    const list = byBar.get(b) ?? [];
    list.push(n);
    byBar.set(b, list);
  }

  const barNumbers = [...byBar.keys()];
  const firstBar = Math.min(...barNumbers);
  const lastBar = Math.max(...barNumbers);
  const counts: number[] = [];
  for (let b = firstBar; b <= lastBar; b++) counts.push(byBar.get(b)?.length ?? 0);
  const medianCount = median(counts.filter((c) => c > 0));

  const vecs = new Map<number, number[]>();
  for (const [b, evs] of byBar) {
    const v = new Array<number>(N_LANES).fill(0);
    for (const e of evs) {
      if (e.Id >= 0 && e.Id < N_LANES) v[e.Id] += 1;
    }
    vecs.set(b, v);
  }

  for (let b = firstBar; b <= lastBar; b++) {
    const evs = byBar.get(b) ?? [];
    if (evs.length === 0) continue;

    const hasBackbeat = (pos: number) =>
      evs.some(
        (e) => e.Id === SNARE && Math.abs(pyMod(e.Beat, beatsPerBar) - pos) <= BACKBEAT_TOL
      );
    const dropout = BACKBEAT_POSITIONS.every(hasBackbeat) ? 0 : 1;
    const tomShare = evs.filter((e) => e.Id === TOM).length / evs.length;
    const densityDelta = Math.max(0, (evs.length - medianCount) / Math.max(medianCount, 1));
    const histDist = cosineDistance(
      vecs.get(b)!,
      vecs.get(b - 1) ?? new Array<number>(N_LANES).fill(0)
    );

    const score = Math.min(
      Math.max(
        W_BACKBEAT * dropout +
          W_TOM * tomShare +
          W_DENSITY * Math.min(densityDelta, 1) +
          W_HIST * histDist,
        0
      ),
      1
    );
    if (score >= FILL_THRESHOLD && evs.length >= MIN_FILL_EVENTS) fillBars.add(b);
  }
  return fillBars;
}

// --- Reduction engine ---------------------------------------------------------

type WorkNote = {
  beat: number;
  orig: ChartNote["Id"];
  out: ChartNote["Id"];
  strength: ChartNote["Strength"];
  /** 16th-grid position within the bar; signature and replication key. */
  pos: number;
  demote: boolean;
};

function posKey(beat: number, beatsPerBar: number): number {
  return roundHalfEven(pyMod(beat, beatsPerBar) * 4) / 4;
}

function priorityOf(id: ChartNote["Id"]): number {
  return NOTE_PRIORITY[id] ?? 99;
}

/** Python _rank tuple: (priority, -Strength, Id, Beat), ascending. */
function compareRank(a: WorkNote, b: WorkNote): number {
  return (
    priorityOf(a.orig) - priorityOf(b.orig) ||
    b.strength - a.strength ||
    a.orig - b.orig ||
    a.beat - b.beat
  );
}

function onGrid(beat: number, grid: number): boolean {
  const r = beat / grid;
  return Math.abs(r - roundHalfEven(r)) < _TOL;
}

function isDownbeat(beat: number, beatsPerBar: number): boolean {
  return pyMod(beat, beatsPerBar) < _TOL;
}

/** Chord stacks: a new stack starts >1/32 beat after the previous one. */
function stacksOf(notes: WorkNote[]): WorkNote[][] {
  const sorted = [...notes].sort((a, b) => a.beat - b.beat || a.orig - b.orig);
  const stacks: WorkNote[][] = [];
  let cur: WorkNote[] = [];
  let start = 0;
  for (const n of sorted) {
    if (cur.length > 0 && n.beat - start > STACK_WINDOW + _TOL) {
      stacks.push(cur);
      cur = [];
    }
    if (cur.length === 0) start = n.beat;
    cur.push(n);
  }
  if (cur.length > 0) stacks.push(cur);
  return stacks;
}

/** Keep every other note in same-lane runs (≥ MIN_RUN) spaced `gap`. */
function thinRuns(notes: WorkNote[], gap: number): WorkNote[] {
  const byLane = new Map<ChartNote["Id"], WorkNote[]>();
  for (const n of notes) {
    const list = byLane.get(n.orig) ?? [];
    list.push(n);
    byLane.set(n.orig, list);
  }
  const out: WorkNote[] = [];
  for (const laneNotes of byLane.values()) {
    laneNotes.sort((a, b) => a.beat - b.beat);
    let i = 0;
    while (i < laneNotes.length) {
      let j = i;
      while (
        j + 1 < laneNotes.length &&
        Math.abs(laneNotes[j + 1].beat - laneNotes[j].beat - gap) <= _TOL
      ) {
        j++;
      }
      const run = laneNotes.slice(i, j + 1);
      if (run.length >= MIN_RUN) {
        for (let k = 0; k < run.length; k += 2) out.push(run[k]);
      } else {
        out.push(...run);
      }
      i = j + 1;
    }
  }
  return out;
}

/** Keep every other kick in kick runs denser than 0.5-beat gaps. */
function thinKickRuns(notes: WorkNote[]): WorkNote[] {
  const kicks = notes.filter((n) => n.orig === KICK).sort((a, b) => a.beat - b.beat);
  const rest = notes.filter((n) => n.orig !== KICK);
  const kept: WorkNote[] = [];
  let i = 0;
  while (i < kicks.length) {
    let j = i;
    while (j + 1 < kicks.length && kicks[j + 1].beat - kicks[j].beat < 0.5 - _TOL) {
      j++;
    }
    const run = kicks.slice(i, j + 1);
    if (run.length >= MIN_RUN) {
      for (let k = 0; k < run.length; k += 2) kept.push(run[k]);
    } else {
      kept.push(...run);
    }
    i = j + 1;
  }
  return [...rest, ...kept];
}

function oneKickPerBar(notes: WorkNote[], beatsPerBar: number): WorkNote[] {
  const kicks = notes.filter((n) => n.orig === KICK);
  if (kicks.length <= 1) return notes;
  const downbeats = kicks.filter((n) => isDownbeat(n.beat, beatsPerBar));
  const pool = downbeats.length > 0 ? downbeats : kicks;
  let keep = pool[0];
  for (const k of pool) {
    if (k.beat < keep.beat) keep = k;
  }
  return notes.filter((n) => n.orig !== KICK || n === keep);
}

/** Greedily keep the first (highest-priority) note per min_gap window. */
function oneNotePerGap(notes: WorkNote[], minGap: number): WorkNote[] {
  const sorted = [...notes].sort((a, b) => a.beat - b.beat || compareRank(a, b));
  const kept: WorkNote[] = [];
  for (const n of sorted) {
    if (kept.length > 0 && n.beat - kept[kept.length - 1].beat < minGap - _TOL) continue;
    kept.push(n);
  }
  return kept;
}

/** Lane simplification for lower difficulties (tom/hat/clap → cymbal). */
function simplifyId(diff: LowerDifficulty, id: ChartNote["Id"]): ChartNote["Id"] {
  if (diff === "easy" && (id === 3 || id === 4 || id === 5)) return 2 as ChartNote["Id"];
  if (diff === "normal" && id === 4) return 3 as ChartNote["Id"];
  return id;
}

// --- Tier rules (one bar's notes; local bpm; fill flag) -----------------------

function hardBar(work: WorkNote[], bpm: number, isFill: boolean): WorkNote[] {
  let w = work;
  if (bpm >= HARD_16TH_ROLL_BPM) w = thinRuns(w, 0.25);
  if (bpm >= HARD_8TH_CAP_BPM) w = thinRuns(w, 0.5);
  if (isFill) {
    w = w.filter((n) => n.orig !== KICK);
  } else {
    w = thinKickRuns(w);
  }
  const accents = w
    .filter((n) => n.orig === SNARE && n.strength === BURNING_STRENGTH)
    .sort((a, b) => a.beat - b.beat);
  for (let i = 1; i < accents.length; i += 2) {
    accents[i].demote = true; // demote every other accent, keep the first
  }
  const out: WorkNote[] = [];
  for (const stack of stacksOf(w)) {
    let s = stack;
    const cymbals = s.filter((n) => n.orig === CYMBAL);
    if (cymbals.length > 1) {
      // no double crashes: keep strongest (then earliest, then lowest id)
      let keep = cymbals[0];
      for (const c of cymbals) {
        if (
          c.strength > keep.strength ||
          (c.strength === keep.strength && c.beat < keep.beat) ||
          (c.strength === keep.strength && c.beat === keep.beat && c.orig < keep.orig)
        ) {
          keep = c;
        }
      }
      s = [...s.filter((n) => n.orig !== CYMBAL), keep];
    }
    if (s.length > 2) {
      // kick + highest-priority other
      const kicks = s.filter((n) => n.orig === KICK);
      const pads = s.filter((n) => n.orig !== KICK).sort(compareRank);
      s = kicks.length > 0 ? [...kicks.slice(0, 1), ...pads.slice(0, 1)] : pads.slice(0, 2);
    }
    out.push(...s);
  }
  return out;
}

function normalBar(
  work: WorkNote[],
  bpm: number,
  isFill: boolean,
  beatsPerBar: number
): WorkNote[] {
  // Below 140 BPM the 8th grid already keeps kick/snare "and" off-beats.
  const grid = bpm >= NORMAL_QUARTER_GRID_BPM ? 1.0 : 0.5;
  let w = work.filter((n) => onGrid(n.beat, grid));
  if (bpm >= NORMAL_KICK_QUARTER_BPM) {
    w = w.filter((n) => n.orig !== KICK || onGrid(n.beat, 1.0));
  }
  if (bpm >= ONE_KICK_PER_BAR_BPM) w = oneKickPerBar(w, beatsPerBar);
  if (isFill) w = oneNotePerGap(w, FILL_NOTE_GAP);
  const out: WorkNote[] = [];
  for (const stack of stacksOf(w)) {
    let s = stack;
    if (s.length > 2) {
      // no 3-limb hits
      const kicks = s.filter((n) => n.orig === KICK);
      const pads = s.filter((n) => n.orig !== KICK).sort(compareRank);
      if (kicks.length > 0 && pads.length >= 2) {
        s = pads.slice(0, 2); // kick+snare+cymbal: drop the kick
      } else if (kicks.length > 0) {
        s = [...kicks.slice(0, 1), ...pads.slice(0, 1)];
      } else {
        s = pads.slice(0, 2);
      }
    }
    if (s.some((n) => n.orig === CYMBAL) && !isDownbeat(s[0].beat, beatsPerBar)) {
      s = s.filter((n) => n.orig !== KICK); // off-beat crash: no kick
    }
    out.push(...s);
  }
  for (const n of out) n.out = simplifyId("normal", n.orig);
  return out;
}

function easyBar(work: WorkNote[], bpm: number, beatsPerBar: number): WorkNote[] {
  let w = work.filter((n) => onGrid(n.beat, 1.0));
  if (bpm >= ONE_KICK_PER_BAR_BPM) w = oneKickPerBar(w, beatsPerBar);
  const out: WorkNote[] = [];
  for (const stack of stacksOf(w)) {
    // every stack collapses to a single note
    if (stack.length === 1) {
      out.push(stack[0]);
      continue;
    }
    const kicks = stack.filter((n) => n.orig === KICK);
    const pads = stack.filter((n) => n.orig !== KICK).sort(compareRank);
    if (isDownbeat(stack[0].beat, beatsPerBar) && kicks.length > 0) {
      out.push(kicks[0]);
    } else if (pads.length > 0) {
      out.push(pads[0]);
    } else {
      out.push(kicks[0]);
    }
  }
  for (const n of out) n.out = simplifyId("easy", n.orig);
  return out;
}

function reduceBar(
  work: WorkNote[],
  bpm: number,
  isFill: boolean,
  tier: LowerDifficulty,
  beatsPerBar: number
): WorkNote[] {
  if (tier === "hard") return hardBar(work, bpm, isFill);
  if (tier === "normal") return normalBar(work, bpm, isFill, beatsPerBar);
  return easyBar(work, bpm, beatsPerBar);
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

function reduceTier(
  notes: ChartNote[],
  bpmAt: (beat: number) => number,
  fillBars: Set<number>,
  tier: LowerDifficulty,
  beatsPerBar: number
): ChartNote[] {
  const bars = new Map<number, ChartNote[]>();
  for (const n of notes) {
    const b = Math.floor(n.Beat / beatsPerBar);
    const list = bars.get(b) ?? [];
    list.push(n);
    bars.set(b, list);
  }

  // Group bars by (pattern signature, fill flag). Fill status joins the key:
  // fill rules (no kicks, one-handable) must fire even when a fill bar's
  // pattern matches a groove bar.
  const groups = new Map<string, number[]>();
  for (const b of [...bars.keys()].sort((a, b2) => a - b2)) {
    const sig = bars
      .get(b)!
      .slice()
      .sort((x, y) => x.Beat - y.Beat || x.Id - y.Id)
      .map((n) => `${posKey(n.Beat, beatsPerBar)}:${n.Id}`)
      .join("|");
    const key = `${sig}#${fillBars.has(b) ? "F" : "G"}`;
    const list = groups.get(key) ?? [];
    list.push(b);
    groups.set(key, list);
  }

  const out: ChartNote[] = [];
  for (const members of groups.values()) {
    // Representative: most notes, then highest local BPM (first wins ties).
    let rep = members[0];
    for (const b of members) {
      const repNotes = bars.get(rep)!;
      const bNotes = bars.get(b)!;
      if (bNotes.length > repNotes.length) {
        rep = b;
      } else if (
        bNotes.length === repNotes.length &&
        bpmAt(b * beatsPerBar) > bpmAt(rep * beatsPerBar)
      ) {
        rep = b;
      }
    }

    const work: WorkNote[] = bars.get(rep)!.map((n) => ({
      beat: n.Beat,
      orig: n.Id,
      out: n.Id,
      strength: n.Strength,
      pos: posKey(n.Beat, beatsPerBar),
      demote: false,
    }));
    const kept = reduceBar(
      work,
      bpmAt(rep * beatsPerBar),
      fillBars.has(rep),
      tier,
      beatsPerBar
    );
    const decisions = kept.map((n) => ({
      pos: n.pos,
      orig: n.orig,
      out: n.out,
      demote: n.demote,
    }));

    for (const bar of members) {
      const lookup = new Map<string, ChartNote[]>();
      for (const n of bars.get(bar)!) {
        const key = `${posKey(n.Beat, beatsPerBar)}:${n.Id}`;
        const list = lookup.get(key) ?? [];
        list.push(n);
        lookup.set(key, list);
      }
      const base = bar * beatsPerBar;
      for (const d of decisions) {
        const pool = lookup.get(`${d.pos}:${d.orig}`);
        if (!pool || pool.length === 0) continue;
        const src = pool.shift()!;
        let strength = src.Strength;
        if (d.demote && strength === BURNING_STRENGTH) strength = NEUTRAL_STRENGTH;
        out.push({ Beat: base + d.pos, Id: d.out, Strength: strength });
      }
    }
  }
  return dedupeNotes(out);
}

/** Generate Hard, Normal, and Easy charts from Extreme (Harmonix RBN rules). */
export function generateLowerDifficulties(
  extreme: ChartNote[],
  timeSignature?: TimeSignature,
  timing?: TimingAnchor[]
): Record<LowerDifficulty, ChartNote[]> {
  const bar = timeSignature ? beatsPerMeasure(timeSignature) : BEATS_PER_MEASURE;
  const beatsPerBar = bar > 0 ? bar : BEATS_PER_MEASURE;
  const bpmAt =
    timing && timing.length > 0
      ? (beat: number) => bpmAtBeat(beat, timing)
      : () => FALLBACK_BPM;
  const fillBars = detectFillBars(extreme, beatsPerBar);
  // Cascading: each tier is derived from the previous one.
  const hard = reduceTier(extreme, bpmAt, fillBars, "hard", beatsPerBar);
  const normal = reduceTier(hard, bpmAt, fillBars, "normal", beatsPerBar);
  const easy = reduceTier(normal, bpmAt, fillBars, "easy", beatsPerBar);
  return { hard, normal, easy };
}

/** Fill empty lower difficulties from Extreme; leaves hand-edited charts untouched. */
export function chartsWithAutoDownchart(
  charts: Record<"easy" | "normal" | "hard" | "extreme", ChartNote[]>,
  timeSignature?: TimeSignature,
  timing?: TimingAnchor[]
): Record<"easy" | "normal" | "hard" | "extreme", ChartNote[]> {
  if (charts.extreme.length === 0) return charts;

  const needs =
    charts.hard.length === 0 || charts.normal.length === 0 || charts.easy.length === 0;
  if (!needs) return charts;

  const generated = generateLowerDifficulties(charts.extreme, timeSignature, timing);
  return {
    extreme: charts.extreme,
    hard: charts.hard.length > 0 ? charts.hard : generated.hard,
    normal: charts.normal.length > 0 ? charts.normal : generated.normal,
    easy: charts.easy.length > 0 ? charts.easy : generated.easy,
  };
}
