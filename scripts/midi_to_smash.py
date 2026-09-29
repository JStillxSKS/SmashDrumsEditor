#!/usr/bin/env python3
"""
MIDI drums → Smash Drums Editor chart converter.

Converts General MIDI drum tracks into:
  - .indies package (meta.json + optional audio/cover/preview)
  - meta.json, notes.chart, song.ini folder for editing

Every chart is Smash-playable (always applied, not optional):
  - max 2 pads at once (chord thinning)
  - hi-hats at most 1/8 notes (16th spam is dropped)
  - quiet / bleed tom hits filtered harder than other pads

Examples:
  python midi_to_smash.py song_drums.mid
  python midi_to_smash.py song_drums.mid --audio song.ogg
  python midi_to_smash.py a.mid b.mid --out "C:\\Charts"
  python midi_to_smash.py drums.mid --artist "Black Sabbath" --title "Paranoid" --charter "Me"
  python midi_to_smash.py drums.mid --offset 0.05 --bpm 163
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
import sys
import wave
import zipfile
from collections import defaultdict
from pathlib import Path

# Optional deps â€” only required for audio/cover packaging
try:
    import mido
except ImportError:
    print("Missing dependency: mido\n  pip install mido", file=sys.stderr)
    sys.exit(1)

try:
    import numpy as np
except ImportError:
    np = None  # type: ignore

try:
    import soundfile as sf
except ImportError:
    sf = None  # type: ignore

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    Image = ImageDraw = ImageFont = None  # type: ignore

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
# Default: Charts/Songs on Desktop if present, else ./output next to this script
_charts = Path.home() / "Desktop" / "Charts" / "Songs"
_editor_out = Path.home() / "Desktop" / "Smash Drums Editor" / "output"
if _charts.is_dir():
    DEFAULT_OUTPUT = _charts
elif _editor_out.is_dir():
    DEFAULT_OUTPUT = _editor_out
else:
    DEFAULT_OUTPUT = SCRIPT_DIR / "output"

# GM percussion â†’ Smash instrument Id
# 0 Kick | 1 Snare | 2 Cymbal | 3 Tom | 4 Hi-hat | 5 Clapfire
GM_TO_SMASH: dict[int, int] = {
    35: 0,  # Acoustic Bass Drum
    36: 0,  # Bass Drum 1
    37: 1,  # Side Stick â†’ snare-ish
    38: 1,  # Acoustic Snare
    39: 5,  # Hand Clap â†’ clapfire
    40: 1,  # Electric Snare
    41: 3,  # Low Floor Tom
    42: 4,  # Closed Hi-Hat
    43: 3,  # High Floor Tom
    44: 4,  # Pedal Hi-Hat
    45: 3,  # Low Tom
    46: 4,  # Open Hi-Hat
    47: 3,  # Low-Mid Tom
    48: 3,  # Hi-Mid Tom
    49: 2,  # Crash Cymbal 1
    50: 3,  # High Tom
    51: 2,  # Ride Cymbal 1
    52: 2,  # Chinese Cymbal
    53: 2,  # Ride Bell
    54: 5,  # Tambourine â†’ clapfire
    55: 2,  # Splash Cymbal
    56: 5,  # Cowbell â†’ clapfire
    57: 2,  # Crash Cymbal 2
    59: 2,  # Ride Cymbal 2
}

SMASH_NAMES = {0: "Kick", 1: "Snare", 2: "Cymbal", 3: "Tom", 4: "Hi-hat", 5: "Clapfire"}
GM_NAMES = {
    35: "Acoustic BD",
    36: "Bass Drum 1",
    37: "Side Stick",
    38: "Acoustic Snare",
    39: "Hand Clap",
    40: "Electric Snare",
    41: "Low Floor Tom",
    42: "Closed HH",
    43: "High Floor Tom",
    44: "Pedal HH",
    45: "Low Tom",
    46: "Open HH",
    47: "Low-Mid Tom",
    48: "Hi-Mid Tom",
    49: "Crash 1",
    50: "High Tom",
    51: "Ride 1",
    52: "Chinese",
    53: "Ride Bell",
    54: "Tambourine",
    55: "Splash",
    56: "Cowbell",
    57: "Crash 2",
    59: "Ride 2",
}

RESOLUTION = 480
BEATS_PER_MEASURE = 4

# GM standard drum channel is 10 (1-based) → 9 in 0-based MIDI
GM_DRUM_CHANNEL = 9

# Kit-core GM pitches (real drums). Bass guitar lives right in the tom range
# (MIDI 41–50 ≈ E2–D3), so tom pitches alone must never decide "this is drums".
GM_KICK = frozenset({35, 36})
GM_SNARE = frozenset({37, 38, 40})
GM_HAT = frozenset({42, 44, 46})
GM_CYM = frozenset({49, 51, 52, 53, 55, 57, 59})
GM_TOM = frozenset({41, 43, 45, 47, 48, 50})
GM_CLAP = frozenset({39, 54, 56})
GM_KIT_CORE = GM_KICK | GM_SNARE | GM_HAT | GM_CYM  # not toms
GM_PERC_ALL = GM_KIT_CORE | GM_TOM | GM_CLAP

# GM melodic bass program numbers (0-based) — never treat as drum kit
GM_BASS_PROGRAMS = frozenset(range(32, 40))  # Acoustic Bass … Synth Bass 2

# Track-name hints (multi-track MIDIs often put bass + drums on channel 0)
_DRUM_NAME_RE = re.compile(
    r"\b(drum|drums|dr\.|kit|perc|percussion|rhythm|drms?)\b", re.I
)
_BASS_NAME_RE = re.compile(
    r"\b(bass|basses|b\.?g\.?|bass\s*g(uit(ar)?)?|basso|contrabass|upright)\b", re.I
)
_MELODIC_NAME_RE = re.compile(
    r"\b(guitar|gtr|piano|keys|synth|lead|vocal|voice|choir|string|violin|"
    r"cello|organ|pad|brass|sax|flute|melody|solo|harp)\b",
    re.I,
)

# Drop very quiet hits by default (ghost notes / bleed become fake toms & clutter)
DEFAULT_MIN_VELOCITY = 24
# Toms are especially noisy (and bass-guitar pitches land here) — stricter floor
DEFAULT_TOM_MIN_VELOCITY = 40

# Smash Drums is not a full kit: more than 2 pads at once is usually unplayable.
# Real MIDI often stacks kick+snare+hat+crash; we keep the most important pads.
DEFAULT_MAX_CHORD = 2

# Notes closer together than 1/CHORD_WINDOW_SUBDIV of a beat count as one
# "stack" for the chord cap. Exact-beat grouping lets a kick@0.00 + snare@0.02
# + hat@0.03 (all one physical hit in real drumming) escape the cap and become
# a 3-pad wall after quantization. 32 = 1/32 beat (~16 ms at 120 BPM) — tight
# enough to never merge real 16th-note runs (62 ms at 120 BPM).
CHORD_WINDOW_SUBDIV = 32

# Max hi-hat density as note subdivision of a whole note in 4/4:
#   4 = quarters (gap 1.0 beat), 8 = eighths (gap 0.5), 16 = sixteenths (gap 0.25)
# MIDI 16th-note hats become unplayable spam in Smash — default to 1/8s.
DEFAULT_HIHAT_SUBDIVISION = 8
HIHAT_ID = 4

# Smash play is grid-based, but MIDI drumming is micro-timed: flams and
# late hits land a few ms off the grid and cram between gridlines in the
# editor (notes visually "too close together"). Snap every note to the
# nearest 1/N beat by default — 16 = sixteenths, the densest grid the
# converter allows anyway. 0 disables snapping (raw MIDI timing).
DEFAULT_SPACING_SUBDIV = 16


def snap_to_grid(
    notes: list[dict], subdivision: int
) -> tuple[list[dict], int, int]:
    """
    Snap every note to the nearest 1/subdivision beat.

    Max shift is half a grid cell (~11 ms at 165 BPM for 1/16) — inaudible,
    but notes land ON gridlines in the editor instead of between them.
    Notes colliding on the same cell + pad are the same physical hit and
    merge into one. Runs before hat limiting and the chord cap so those
    see final positions.

    Returns (notes, moved_count, merged_count).
    """
    if subdivision <= 0:
        return sort_notes(notes), 0, 0
    step = 4.0 / float(subdivision)  # beats per grid cell (16 -> 0.25)
    out: list[dict] = []
    moved = 0
    for n in notes:
        b = n["Beat"]
        bq = round(b / step) * step
        if abs(bq - b) > 1e-9:
            moved += 1
        out.append({"Beat": float(bq), "Id": n["Id"], "Strength": NORMAL_STRENGTH})
    before = len(out)
    out = dedupe_notes(out)  # same cell + same pad -> one note
    return out, moved, before - len(out)

# Lower number = keep first when thinning a multi-hit chord
# Kick/snare form the groove; cymbal accents next; hats/toms/clapfire last.
NOTE_PRIORITY: dict[int, int] = {
    0: 0,  # Kick
    1: 1,  # Snare
    2: 2,  # Cymbal
    5: 3,  # Clapfire
    4: 4,  # Hi-hat
    3: 5,  # Tom
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Smash note strength (meta.json "Strength") — Smash Drums Editor FILE_FORMATS:
#   0 = Crystal (arcade, hit gently)
#   1 = Neutral (normal)
#   2 = Burning (arcade, hit hard)
# MIDI charts always emit Neutral. Strength 0 is Crystal, not "normal".
NORMAL_STRENGTH = 1


def vel_to_strength(vel: int) -> int:
    """Ignore MIDI velocity; always emit Neutral. Never Crystal or Burning."""
    return NORMAL_STRENGTH


def quantize_beat(beat: float) -> float:
    return int(round(beat * RESOLUTION)) / RESOLUTION


def sort_notes(notes: list[dict]) -> list[dict]:
    return sorted(notes, key=lambda n: (n["Beat"], n["Id"], n["Strength"]))


def dedupe_notes(notes: list[dict]) -> list[dict]:
    best: dict[tuple, dict] = {}
    for n in notes:
        key = (n["Beat"], n["Id"])
        if key not in best or n["Strength"] > best[key]["Strength"]:
            best[key] = n
    return sort_notes(list(best.values()))


def cap_chord_size(
    notes: list[dict], max_chord: int = DEFAULT_MAX_CHORD
) -> tuple[list[dict], int, int]:
    """
    Cap simultaneous notes for Smash playability (always applied).

    Real drum MIDI often has 3–4 hits at once (kick + snare + hat + crash).
    Smash charts must stay at most max_chord pads (default 2).

    Notes within 1/CHORD_WINDOW_SUBDIV of a beat of each other count as ONE
    stack: a physical drum stroke spreads across ~10–30 ms in MIDI, which
    quantization turns into adjacent "beats" that would otherwise escape the
    cap and land as an unhittable 3-pad wall. This never merges distinct
    16th notes (1/4 beat apart) — it only makes the cap stricter.

    When thinning, keep highest-priority pads (kick/snare first; toms are
    dropped first as clutter).

    Returns (notes, dropped_note_count, chords_thinned).
    """
    max_chord = max(1, int(max_chord))
    window = 1.0 / CHORD_WINDOW_SUBDIV

    # Greedy clustering by time: a new stack starts when the gap from the
    # stack's first note exceeds the window.
    stacks: list[list[dict]] = []
    cur: list[dict] = []
    cur_start = 0.0
    for n in sorted(notes, key=lambda n: (n["Beat"], n["Id"])):
        if cur and n["Beat"] - cur_start > window + 1e-9:
            stacks.append(cur)
            cur = []
        if not cur:
            cur_start = n["Beat"]
        cur.append(n)
    if cur:
        stacks.append(cur)

    out: list[dict] = []
    dropped = 0
    thinned = 0
    for group in stacks:
        if len(group) <= max_chord:
            out.extend(group)
            continue
        # Prefer backbone pads, then stronger hits, then stable Id order
        ranked = sorted(
            group,
            key=lambda n: (
                NOTE_PRIORITY.get(n["Id"], 99),
                -int(n.get("Strength", 0)),
                n["Id"],
            ),
        )
        keep = ranked[:max_chord]
        dropped += len(group) - len(keep)
        thinned += 1
        out.extend(keep)
    return sort_notes(out), dropped, thinned


def subdivision_to_gap_beats(subdivision: int) -> float:
    """
    Note subdivision → minimum gap in beats (quarter-note beat).
    8 → 0.5 (eighths), 4 → 1.0 (quarters), 16 → 0.25 (sixteenths).
    """
    subdivision = max(1, int(subdivision))
    return 4.0 / float(subdivision)


def limit_hihat_rate(
    notes: list[dict],
    *,
    subdivision: int = DEFAULT_HIHAT_SUBDIVISION,
    instrument_id: int = HIHAT_ID,
) -> tuple[list[dict], int]:
    """
    Cap hi-hat density for Smash charts (always applied).

    Real MIDI often has constant 16th-note hats. Charts never keep hats denser
    than the subdivision (default 8 = 1/8 notes). Hats are grouped into
    subdivision slots; the loudest hat in each slot is kept.
    Timing is preserved (no grid snap) so kick/snare grooves stay intact.

    Returns (notes, dropped_hihat_count).
    """
    min_gap = subdivision_to_gap_beats(subdivision)

    others = [n for n in notes if n["Id"] != instrument_id]
    hats = [n for n in notes if n["Id"] == instrument_id]
    if not hats:
        return sort_notes(notes), 0

    def hat_score(n: dict, slot_beat: float) -> tuple:
        # Prefer loud hits closest to the slot start (cleaner 1/8 feel)
        return (int(n.get("Strength", 0)), -abs(n["Beat"] - slot_beat))

    # One candidate per slot [i*gap, (i+1)*gap)
    best: dict[int, dict] = {}
    for h in hats:
        slot = int(math.floor(h["Beat"] / min_gap + 1e-9))
        slot_beat = slot * min_gap
        prev = best.get(slot)
        if prev is None or hat_score(h, slot_beat) > hat_score(prev, slot_beat):
            best[slot] = h

    # Enforce min gap for boundary cases (e.g. 0.49 then 0.50)
    kept: list[dict] = []
    for slot in sorted(best):
        h = best[slot]
        if not kept:
            kept.append(h)
            continue
        gap = h["Beat"] - kept[-1]["Beat"]
        if gap + 1e-9 >= min_gap:
            kept.append(h)
        elif hat_score(h, h["Beat"]) > hat_score(kept[-1], kept[-1]["Beat"]):
            kept[-1] = h

    dropped = len(hats) - len(kept)
    return sort_notes(others + kept), dropped


def beat_to_tick(beat: float) -> int:
    return int(round(beat * RESOLUTION))


def beat_in_measure(beat: float) -> float:
    m = beat % BEATS_PER_MEASURE
    return m + BEATS_PER_MEASURE if m < 0 else m


def is_on_beat(beat: float) -> bool:
    n = beat_in_measure(beat)
    return abs(n - round(n)) < 1e-6 and round(n) % 2 == 0


def is_off_beat(beat: float) -> bool:
    n = beat_in_measure(beat)
    return abs(n - round(n)) < 1e-6 and round(n) % 2 == 1


def simplify_id(diff: str, id_: int) -> int:
    if diff == "easy" and id_ in (3, 4, 5):
        return 2
    if diff == "normal" and id_ == 4:
        return 3
    return id_


def apply_density_gate(
    diff: str, beat: float, tick_delta: int, on_beat: bool, off_beat: bool
) -> tuple[bool, bool, bool]:
    on, off = on_beat, off_beat
    if diff == "easy" and tick_delta > RESOLUTION * 3 and not off:
        on = True
    if diff == "normal" and tick_delta > RESOLUTION * 2 and not off:
        on = True
    if diff == "hard" and tick_delta >= RESOLUTION and not off:
        on = True
    if diff == "hard":
        n = beat_in_measure(beat)
        if abs(n * 2 - round(n * 2)) < 1e-6:
            on = True
    return on, off, (not on and not off)


def _priority_sort(notes: list[dict]) -> list[dict]:
    """Smash-first order: kick/snare/cymbal before hat/tom clutter."""
    return sorted(
        notes,
        key=lambda n: (
            NOTE_PRIORITY.get(n["Id"], 99),
            -int(n.get("Strength", 0)),
            n["Id"],
        ),
    )


def pick_notes_at_beat(
    diff: str, beat: float, notes: list[dict], on_beat: bool, off_beat: bool
) -> list[dict]:
    sorted_n = _priority_sort(notes)
    downbeat = abs(beat_in_measure(beat)) < 1e-6
    kick = 0

    def copy_note(note: dict, id_: int) -> dict:
        return {"Beat": note["Beat"], "Id": id_, "Strength": NORMAL_STRENGTH}

    if diff == "easy":
        if not on_beat:
            return []
        for note in sorted_n:
            if note["Id"] == kick and downbeat:
                return [copy_note(note, kick)]
        first = next((n for n in sorted_n if n["Id"] != kick), sorted_n[0] if sorted_n else None)
        if not first:
            return []
        return [copy_note(first, simplify_id(diff, first["Id"]))]

    if diff == "normal":
        if on_beat:
            for note in sorted_n:
                if note["Id"] == kick and downbeat:
                    return [copy_note(note, kick)]
            first = next(
                (n for n in sorted_n if n["Id"] != kick), sorted_n[0] if sorted_n else None
            )
            if not first:
                return []
            return [copy_note(first, simplify_id(diff, first["Id"]))]
        if off_beat:
            ret = []
            for note in sorted_n:
                if note["Id"] == kick:
                    continue
                ret.append(copy_note(note, simplify_id(diff, note["Id"])))
                if len(ret) >= 2:
                    break
            return ret
        return []

    # hard (and any other non easy/normal): max 2 pads, Smash priority
    if on_beat:
        ret = []
        for note in sorted_n:
            if note["Id"] == kick:
                ret.append(copy_note(note, kick))
                break
        for note in sorted_n:
            if note["Id"] == kick:
                continue
            ret.append(copy_note(note, note["Id"]))
            break
        if not ret and sorted_n:
            return [copy_note(sorted_n[0], sorted_n[0]["Id"])]
        return ret
    if off_beat:
        non_kick = [n for n in sorted_n if n["Id"] != kick]
        # Prefer non-kick chords when the stack is busy; otherwise keep best 2
        pool = non_kick if len(sorted_n) > 2 else sorted_n
        return [copy_note(n, n["Id"]) for n in pool[:2]]
    return []


def downchart(extreme: list[dict], diff: str) -> list[dict]:
    by_tick: dict[int, list[dict]] = defaultdict(list)
    for note in extreme:
        by_tick[beat_to_tick(note["Beat"])].append(note)
    out: list[dict] = []
    prev_tick = 0
    for tick in sorted(by_tick):
        beat = tick / RESOLUTION
        tick_delta = tick - prev_tick
        on, off, skip = apply_density_gate(
            diff, beat, tick_delta, is_on_beat(beat), is_off_beat(beat)
        )
        if skip:
            continue
        picked = pick_notes_at_beat(diff, beat, by_tick[tick], on, off)
        out.extend(picked)
        if picked:
            prev_tick = tick
    return sort_notes(out)


def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned or "Untitled Song"


def guess_meta_from_filename(path: Path) -> tuple[str, str]:
    """
    Heuristic title/artist from common demucs / stem naming:
      Artist__Song_drums_....mid
      Artist - Song.mid
      Song.mid
    """
    stem = path.stem
    # strip trailing _drums / _drum / timestamp junk
    stem = re.sub(r"_(drums?|drum|percussion)(_\d+)?$", "", stem, flags=re.I)
    stem = re.sub(r"_\d{10,}$", "", stem)

    if "__" in stem:
        artist, title = stem.split("__", 1)
        return artist.replace("_", " ").strip(), title.replace("_", " ").strip()
    if " - " in stem:
        left, right = stem.split(" - ", 1)
        return left.strip(), right.strip()
    return "Unknown Artist", stem.replace("_", " ").strip()


# ---------------------------------------------------------------------------
# MIDI parse
# ---------------------------------------------------------------------------

def build_song_timing(bpm: float, end_beat: float) -> list[dict]:
    """Constant-tempo map matching Smash Drums Editor (beat 0, 1, end).

    Every anchor BEAT must be a whole number: Smash SongTimingItem.beat is an
    int, and a fractional anchor (e.g. end at 174.4167) looks right in the
    editor but the game coerces it and audio drifts in-headset. The BPM itself
    may be fractional — it lives in the float `timer` values, which is legal.
    """
    spb = 60.0 / bpm
    last = quantize_beat(end_beat)
    end = int(max(4.0, math.ceil(last - 1e-9)))
    return [
        {"beat": 0, "timer": 0.0},
        {"beat": 1, "timer": spb},
        {"beat": end, "timer": end * spb},
    ]


# How close a MIDI tempo change must land to a whole beat to be represented
# exactly in the game (SongTiming anchor beats are ints). 1/50 beat = 10 ms
# at 120 BPM — real tempomaps change on bar lines, well inside this.
TEMPO_ANCHOR_TOLERANCE = 0.02


def timing_from_tempo_map(
    tpb: int, tempo_map: list[tuple[int, int]], last_beat: float
) -> tuple[list[dict], float, float] | None:
    """
    Beat→seconds SongTiming anchors honoring every MIDI tempo change.

    Returns (anchors, duration_sec, eff_bpm) or None when a tempo change
    lands off-integer (the game can't represent it — caller should fall back
    to a constant tempo and warn). All anchor beats are whole numbers; only
    `timer` values are floats.

    Builds a segment list [(beat_start, sec_start, bpm)] from the MIDI tempo
    map, then samples anchors at integer beats: beat 0, beat 1, every beat
    where the tempo changes (within TEMPO_ANCHOR_TOLERANCE), and the end.
    """
    if len({tempo for _, tempo in tempo_map}) < 2:
        return None

    # (beat_start, sec_start, bpm) per constant-tempo segment
    segments: list[tuple[float, float, float]] = []
    sec = 0.0
    prev_tick = 0
    cur_tempo = tempo_map[0][1]
    for tick, tempo in tempo_map[1:]:
        if tick <= prev_tick:
            cur_tempo = tempo  # same-tick redefinition — keep latest
            continue
        segments.append((prev_tick / tpb, sec, 60.0 / (cur_tempo / 1_000_000.0)))
        sec += (tick - prev_tick) * (cur_tempo / 1_000_000.0) / tpb
        prev_tick = tick
        cur_tempo = tempo
    segments.append((prev_tick / tpb, sec, 60.0 / (cur_tempo / 1_000_000.0)))

    def time_at_beat(beat: float) -> float:
        t = 0.0
        for sb, ss, bpm_ in segments:
            if beat < sb - 1e-9:
                break
            t = ss + (beat - sb) * 60.0 / bpm_
        return t

    # Tempo changes must sit on (near) integer beats for the game
    change_beats = [sb for sb, _, _ in segments[1:]]
    for b in change_beats:
        if abs(b - round(b)) > TEMPO_ANCHOR_TOLERANCE:
            return None

    anchors: list[dict] = []
    wanted = {0, 1} | {int(round(b)) for b in change_beats}
    last_int = int(max(4.0, math.ceil(quantize_beat(last_beat + 4.0) - 1e-9)))
    wanted.add(last_int)
    for beat_i in sorted(wanted):
        anchors.append({"beat": beat_i, "timer": time_at_beat(float(beat_i))})

    end_sec = time_at_beat(float(last_int))
    eff_bpm = (last_int / end_sec * 60.0) if end_sec > 0 else 0.0
    return anchors, end_sec, eff_bpm


def _track_name_bonus(name: str) -> float:
    """Score a track/channel name: positive = drums, negative = bass/melody."""
    if not name:
        return 0.0
    if _DRUM_NAME_RE.search(name):
        return 50.0
    if _BASS_NAME_RE.search(name):
        return -80.0
    if _MELODIC_NAME_RE.search(name):
        return -40.0
    return 0.0


def score_source_as_drums(
    notes: list[tuple[int, int, int]],
    *,
    name: str = "",
    program: int | None = None,
    is_gm_drum_channel: bool = False,
) -> float:
    """
    How drum-kit-like is this note source?

    notes: list of (tick, pitch, velocity)
    Bass guitar pitches 41–50 collide with GM toms — a source that is mostly
    those pitches with no kick/snare/hat is bass, not toms.
    """
    if not notes:
        return -999.0

    total = len(notes)
    kicks = hats = snares = cyms = toms = claps = other = 0
    for _, pitch, _ in notes:
        if pitch in GM_KICK:
            kicks += 1
        elif pitch in GM_SNARE:
            snares += 1
        elif pitch in GM_HAT:
            hats += 1
        elif pitch in GM_CYM:
            cyms += 1
        elif pitch in GM_TOM:
            toms += 1
        elif pitch in GM_CLAP:
            claps += 1
        else:
            other += 1

    kit_core = kicks + snares + hats + cyms
    perc = kit_core + toms + claps
    score = 0.0

    if is_gm_drum_channel:
        score += 40.0
    score += _track_name_bonus(name)

    # Melodic bass programs on non-ch10 → almost never drums
    if program is not None and program in GM_BASS_PROGRAMS and not is_gm_drum_channel:
        score -= 100.0
    elif program is not None and not is_gm_drum_channel and program < 128:
        # Other melodic programs (not percussion banks) — mild penalty
        if program not in (0,) and kit_core < max(3, total * 0.15):
            score -= 20.0

    # Kit backbone is required for a high score
    score += min(kicks, 40) * 2.5
    score += min(snares, 40) * 2.0
    score += min(hats, 40) * 1.5
    score += min(cyms, 20) * 1.0
    score += min(claps, 10) * 0.5

    # Tom-only / tom-heavy with no kit core = bass guitar false positives
    if kit_core == 0 and toms > 0:
        score -= 60.0 + min(toms, 50)
    elif toms > 0 and kit_core > 0:
        # Real kits have some toms; don't over-penalize
        tom_ratio = toms / max(1, perc)
        if tom_ratio > 0.55 and kicks + snares < 4:
            score -= 35.0
        else:
            score += min(toms, 15) * 0.3

    # Non-percussion pitches on this source (melody notes)
    if other:
        score -= min(other, 80) * 0.8

    # Fraction of notes that are true kit-core
    if total:
        score += (kit_core / total) * 30.0
        score -= (other / total) * 25.0

    return score


def pick_drum_sources(
    notes_raw: list[tuple[int, int, int, int, int]],
    *,
    track_names: dict[int, str],
    channel_programs: dict[int, int],
    track_programs: dict[int, int],
    forced_channel: int | None,
    all_channels: bool,
    min_vel: int,
) -> tuple[set[tuple[int, int]] | None, str, int | None]:
    """
    Decide which (track_index, channel) sources are real drums.

    notes_raw entries: (tick, note, velocity, channel, track_index)

    Returns:
      active_sources: set of (track_idx, ch) to keep, or None = keep all
      channel_mode: human-readable description
      active_channel: single channel if locked to one, else None
    """
    if forced_channel is not None:
        ch = int(forced_channel)
        if not 0 <= ch <= 15:
            raise ValueError(f"MIDI channel must be 0–15 (got {ch})")
        # Keep every track on that channel
        sources = {(ti, c) for _, _, _, c, ti in notes_raw if c == ch}
        return sources or {(0, ch)}, f"forced ch{ch + 1}", ch

    if all_channels:
        return None, "all channels (--all-channels)", None

    # Group notes by (track, channel)
    by_src: dict[tuple[int, int], list[tuple[int, int, int]]] = defaultdict(list)
    for tick, note, vel, ch, ti in notes_raw:
        by_src[(ti, ch)].append((tick, note, vel))

    if not by_src:
        return None, "all (empty)", None

    scored: list[tuple[float, tuple[int, int], str]] = []
    for (ti, ch), notes in by_src.items():
        name = track_names.get(ti, "")
        prog = track_programs.get(ti)
        if prog is None:
            prog = channel_programs.get(ch)
        sc = score_source_as_drums(
            notes,
            name=name,
            program=prog,
            is_gm_drum_channel=(ch == GM_DRUM_CHANNEL),
        )
        label = name.strip() or f"track{ti}"
        scored.append((sc, (ti, ch), label))

    scored.sort(key=lambda x: (-x[0], x[1][0], x[1][1]))
    best_score, best_src, best_label = scored[0]
    best_ti, best_ch = best_src

    # Prefer GM ch10 if it has any real kit-core hits (not just bass-range toms)
    ch10_core = sum(
        1
        for _, note, vel, ch, _ in notes_raw
        if ch == GM_DRUM_CHANNEL and note in GM_KIT_CORE and vel >= min_vel
    )
    if ch10_core >= 4:
        sources = {
            (ti, ch)
            for _, _, _, ch, ti in notes_raw
            if ch == GM_DRUM_CHANNEL
        }
        return sources, "auto ch10 (kit-core drums)", GM_DRUM_CHANNEL

    # Strong drum-like source → use only sources that score close to best
    # and are clearly kit (not bass)
    DRUM_MIN_SCORE = 25.0
    if best_score >= DRUM_MIN_SCORE:
        keep: set[tuple[int, int]] = set()
        for sc, src, _ in scored:
            # Same channel as best if it's the GM drum channel, or near-best score
            if sc >= max(DRUM_MIN_SCORE, best_score - 20.0):
                keep.add(src)
            elif src[1] == best_ch and sc >= DRUM_MIN_SCORE * 0.6:
                keep.add(src)
        # Always include the winner
        keep.add(best_src)

        # Drop sources that look like bass even if score was middling
        filtered: set[tuple[int, int]] = set()
        for src in keep:
            ti, ch = src
            sc = next(s for s, ssrc, _ in scored if ssrc == src)
            name = track_names.get(ti, "")
            if _BASS_NAME_RE.search(name) and ch != GM_DRUM_CHANNEL:
                continue
            if sc < 0 and src != best_src:
                continue
            filtered.add(src)
        keep = filtered or {best_src}

        chans = sorted({c for _, c in keep})
        if len(keep) == 1:
            mode = (
                f"auto drums ({best_label!r} ch{best_ch + 1}, score {best_score:.0f})"
            )
            return keep, mode, best_ch
        mode = (
            f"auto drums multi ({len(keep)} sources, best {best_label!r} "
            f"ch{best_ch + 1} score {best_score:.0f}; chs "
            f"{','.join(str(c + 1) for c in chans)})"
        )
        return keep, mode, None

    # Weak scores: still avoid pure bass sources. Keep only non-negative scores
    # or the single least-bad source if everything is negative.
    positive = {src for sc, src, _ in scored if sc >= 0}
    if positive:
        return positive, f"auto non-bass sources ({len(positive)})", None

    # Last resort: single best source only (never "all channels" — that maps bass→toms)
    return (
        {best_src},
        f"auto best-effort ({best_label!r} ch{best_ch + 1}, score {best_score:.0f})",
        best_ch,
    )


def parse_midi(
    path: Path,
    bpm_override: float | None = None,
    *,
    min_velocity: int = DEFAULT_MIN_VELOCITY,
    tom_min_velocity: int | None = None,
    channel: int | None = None,
    all_channels: bool = False,
) -> dict:
    """
    Parse a MIDI file into Smash Extreme notes.

    Drum source selection (always on unless --all-channels / --channel):
      - Prefer GM drum channel 10 when it has real kit hits (kick/snare/hat/cym).
      - Else pick track/channel sources that score like a drum kit.
      - Bass guitar / melodic tracks are rejected so their pitches 41–50
        never become phantom toms.

    Quiet hits under min_velocity are dropped; toms use a stricter floor.
    """
    mid = mido.MidiFile(path)
    tpb = mid.ticks_per_beat
    tempo_events: list[tuple[int, int]] = [(0, 500000)]
    # (abs_tick, note, velocity, channel, track_index)
    notes_raw: list[tuple[int, int, int, int, int]] = []
    track_names: dict[int, str] = {}
    # last program change seen per channel / per track
    channel_programs: dict[int, int] = {}
    track_programs: dict[int, int] = {}

    for ti, track in enumerate(mid.tracks):
        abs_tick = 0
        for msg in track:
            abs_tick += msg.time
            if msg.type == "set_tempo":
                tempo_events.append((abs_tick, msg.tempo))
            elif msg.type == "track_name":
                track_names[ti] = (msg.name or "").strip()
            elif msg.type == "program_change":
                ch = getattr(msg, "channel", 0)
                channel_programs[ch] = int(msg.program)
                track_programs[ti] = int(msg.program)
            elif msg.type == "note_on" and msg.velocity > 0:
                ch = getattr(msg, "channel", 0)
                notes_raw.append((abs_tick, msg.note, msg.velocity, ch, ti))

    tempo_events.sort(key=lambda x: x[0])
    tempo_map: list[tuple[int, int]] = []
    for t, tempo in tempo_events:
        if tempo_map and tempo_map[-1][0] == t:
            tempo_map[-1] = (t, tempo)
        else:
            tempo_map.append((t, tempo))

    def tick_to_seconds(tick: int) -> float:
        sec = 0.0
        cur_tempo = tempo_map[0][1]
        prev = 0
        for t, tempo in tempo_map:
            if t >= tick:
                break
            sec += (t - prev) * (cur_tempo / 1_000_000.0) / tpb
            prev = t
            cur_tempo = tempo
        sec += (tick - prev) * (cur_tempo / 1_000_000.0) / tpb
        return sec

    midi_bpm = 60_000_000.0 / tempo_map[0][1]
    bpm = float(bpm_override) if bpm_override else midi_bpm

    # Toms always use at least DEFAULT_TOM_MIN_VELOCITY (watch for phantom toms).
    # Caller may raise the floor further; never lower it below the default.
    min_vel = max(1, int(min_velocity))
    if tom_min_velocity is None:
        tom_floor = DEFAULT_TOM_MIN_VELOCITY
    else:
        tom_floor = max(DEFAULT_TOM_MIN_VELOCITY, int(tom_min_velocity))
    tom_floor = max(min_vel, int(tom_floor))

    active_sources, channel_mode, active_channel = pick_drum_sources(
        notes_raw,
        track_names=track_names,
        channel_programs=channel_programs,
        track_programs=track_programs,
        forced_channel=channel,
        all_channels=all_channels,
        min_vel=min_vel,
    )

    # Precompute which kept sources actually look like a kit (for tom gating)
    source_scores: dict[tuple[int, int], float] = {}
    by_src_notes: dict[tuple[int, int], list[tuple[int, int, int]]] = defaultdict(list)
    for tick, note, vel, ch, ti in notes_raw:
        by_src_notes[(ti, ch)].append((tick, note, vel))
    for src, notes in by_src_notes.items():
        ti, ch = src
        source_scores[src] = score_source_as_drums(
            notes,
            name=track_names.get(ti, ""),
            program=track_programs.get(ti, channel_programs.get(ch)),
            is_gm_drum_channel=(ch == GM_DRUM_CHANNEL),
        )

    extreme: list[dict] = []
    unmapped: dict[int, int] = defaultdict(int)
    gm_counts: dict[int, int] = defaultdict(int)
    skipped_quiet = 0
    skipped_channel = 0
    skipped_bass_tom = 0
    channel_counts: dict[int, int] = defaultdict(int)
    # wall-clock seconds for kick/snare (alignment)
    align_times: list[float] = []

    for tick, note, vel, ch, ti in notes_raw:
        channel_counts[ch] += 1
        src = (ti, ch)
        if active_sources is not None and src not in active_sources:
            skipped_channel += 1
            continue

        smash_id = GM_TO_SMASH.get(note)
        if smash_id is None:
            unmapped[note] += 1
            continue

        # Extra tom guard: even on a kept source, drop tom pitches if this
        # source has no kit-core backbone (bass guitar riff in 41–50 range).
        if smash_id == 3:  # Tom
            sc = source_scores.get(src, 0.0)
            notes_here = by_src_notes.get(src, [])
            core_hits = sum(1 for _, p, _ in notes_here if p in GM_KIT_CORE)
            if core_hits < 2 and ch != GM_DRUM_CHANNEL:
                skipped_bass_tom += 1
                continue
            if sc < 15.0 and ch != GM_DRUM_CHANNEL and core_hits < 8:
                skipped_bass_tom += 1
                continue

        floor = tom_floor if smash_id == 3 else min_vel
        if vel < floor:
            skipped_quiet += 1
            continue

        gm_counts[note] += 1
        beat = quantize_beat(tick / tpb)
        extreme.append(
            {
                "Beat": float(beat),
                "Id": smash_id,
                "Strength": NORMAL_STRENGTH,  # Neutral; never Crystal (0) or Burning (2)
            }
        )
        if note in (35, 36, 38, 40):  # kick / snare for alignment
            align_times.append(tick_to_seconds(tick))

    extreme = dedupe_notes(extreme)
    last_beat = extreme[-1]["Beat"] if extreme else 0.0
    last_tick = max((t for t, _, _, _, _ in notes_raw), default=0)
    midi_duration = tick_to_seconds(last_tick)
    duration_sec = last_beat * 60.0 / bpm if bpm > 0 else midi_duration
    song_timing = build_song_timing(bpm, last_beat + 4)

    return {
        "bpm": int(round(bpm)),
        "bpm_float": bpm,
        "midi_bpm": midi_bpm,
        "has_tempo_changes": len({t for _, t in tempo_map}) > 1,
        "eff_bpm": (
            (last_tick / tpb) / midi_duration * 60.0
            if midi_duration > 0
            else midi_bpm
        ),
        "tpb": tpb,
        "extreme": extreme,
        "unmapped": dict(unmapped),
        "gm_counts": dict(gm_counts),
        "duration_sec": duration_sec,
        "midi_duration_sec": midi_duration,
        "last_beat": last_beat,
        "song_timing": song_timing,
        "note_count_raw": len(notes_raw),
        "align_times": align_times,
        "tempo_map": tempo_map,
        "channel_mode": channel_mode,
        "active_channel": active_channel,
        "channel_counts": dict(channel_counts),
        "skipped_quiet": skipped_quiet,
        "skipped_channel": skipped_channel,
        "skipped_bass_tom": skipped_bass_tom,
        "min_velocity": min_vel,
        "tom_min_velocity": tom_floor,
        "track_names": dict(track_names),
    }


def align_midi_to_audio(
    align_times: list[float],
    midi_bpm: float,
    audio_path: Path,
    bpm_hint: float | None = None,
) -> dict | None:
    """
    Find BPM + lag so MIDI kick/snare line up with audio onsets.
    Returns {bpm, lag_sec, score} or None if deps/audio missing / score too weak.
    audio_time â‰ˆ midi_time * (midi_bpm / bpm) + lag_sec
    """
    if sf is None or np is None or not align_times:
        return None
    try:
        data, sr = sf.read(str(audio_path), always_2d=True)
    except Exception:
        return None

    mono = data.mean(axis=1).astype(np.float32)
    hop = max(1, int(sr * 0.01))
    n = len(mono) // hop
    if n < 100:
        return None
    frames = mono[: n * hop].reshape(n, hop)
    env = np.sqrt((frames * frames).mean(axis=1))
    nov = np.maximum(0.0, np.diff(env, prepend=env[0]))
    peak = float(nov.max()) or 1.0
    nov = nov / peak
    audio_dur = len(mono) / float(sr)
    frame_dt = hop / float(sr)

    # Precompute a sliding ±3-frame max so scoring each candidate
    # (bpm, lag) is a vectorized array lookup instead of a Python loop
    # over every drum hit (~5M iterations per song before this).
    from numpy.lib.stride_tricks import sliding_window_view

    padded = np.concatenate(
        [np.zeros(3, dtype=nov.dtype), nov, np.zeros(3, dtype=nov.dtype)]
    )
    win_max = sliding_window_view(padded, 7)  # win_max[i] == max(nov[i-3:i+4])

    # Use early/mid hits for a stable lock (skip extreme tail)
    times = np.array(align_times, dtype=np.float64)
    if len(times) > 500:
        times = times[:500]

    def score(lag: float, bpm: float) -> float:
        scale = midi_bpm / bpm
        mt = times * scale + lag
        idx = np.round(mt / frame_dt).astype(np.int64)
        valid = (idx >= 0) & (idx < len(nov)) & (mt < audio_dur)
        idx = idx[valid]
        if len(idx) < 20:
            return 0.0
        # nov is non-negative, so zero-padding at the edges cannot
        # overstate the clamped-window max this replaces.
        return float(win_max[idx].max(axis=1).sum()) / len(idx)

    center = float(bpm_hint) if bpm_hint else midi_bpm
    bpm_lo = max(40.0, center - 12.0)
    bpm_hi = min(280.0, center + 12.0)

    best = (0.0, 0.0, midi_bpm)  # score, lag, bpm
    for bpm in np.linspace(bpm_lo, bpm_hi, 49):
        for lag in np.linspace(-1.0, 8.0, 181):
            sc = score(float(lag), float(bpm))
            if sc > best[0]:
                best = (sc, float(lag), float(bpm))

    # Refine around best
    sc0, lag0, bpm0 = best
    for bpm in np.linspace(bpm0 - 0.6, bpm0 + 0.6, 25):
        if bpm <= 0:
            continue
        for lag in np.linspace(lag0 - 0.08, lag0 + 0.08, 33):
            sc = score(float(lag), float(bpm))
            if sc > best[0]:
                best = (sc, float(lag), float(bpm))

    baseline = score(0.0, midi_bpm)
    sc, lag, bpm = best
    # Require a meaningful improvement over naive MIDI tempo @ 0 lag
    if sc < 0.25 or sc < baseline * 1.05:
        return {
            "bpm": midi_bpm,
            "lag_sec": 0.0,
            "score": sc,
            "baseline": baseline,
            "accepted": False,
        }

    return {
        "bpm": bpm,
        "lag_sec": lag,
        "score": sc,
        "baseline": baseline,
        "accepted": True,
    }


def apply_timing_fix(
    notes: list[dict],
    *,
    bpm: float,
    beat_shift: float = 0.0,
) -> tuple[list[dict], list[dict], float, float]:
    """Shift notes by beat_shift, rebuild SongTiming. Returns notes, timing, last_beat, duration."""
    shifted = []
    for n in notes:
        b = quantize_beat(n["Beat"] + beat_shift)
        if b < 0:
            continue
        shifted.append(
            {"Beat": float(b), "Id": n["Id"], "Strength": NORMAL_STRENGTH}
        )
    shifted = sort_notes(shifted)
    last_beat = shifted[-1]["Beat"] if shifted else 0.0
    timing = build_song_timing(bpm, last_beat + 4)
    duration = last_beat * 60.0 / bpm if bpm > 0 else 0.0
    return shifted, timing, last_beat, duration


# ---------------------------------------------------------------------------
# Serialize
# ---------------------------------------------------------------------------

def format_meta(meta: dict) -> str:
    def fmt_beat(b: float) -> str:
        return f"{b:.1f}" if float(b).is_integer() else str(b)

    def fmt_timer(t: float) -> str:
        return "0.0" if t == 0 else str(t)

    def note_block(notes: list[dict]) -> str:
        if not notes:
            return "[]"
        lines = ["["]
        for i, n in enumerate(notes):
            comma = "," if i < len(notes) - 1 else ""
            lines += [
                "        {",
                f'            "Beat": {fmt_beat(n["Beat"])},',
                f'            "Strength": {NORMAL_STRENGTH},',
                f'            "Id": {n["Id"]}',
                f"        }}{comma}",
            ]
        lines.append("    ]")
        return "\n".join(lines)

    def timing_block(anchors: list[dict]) -> str:
        lines = ["["]
        for i, a in enumerate(anchors):
            comma = "," if i < len(anchors) - 1 else ""
            b = a["beat"]
            b_s = str(int(b)) if float(b).is_integer() else str(b)
            lines += [
                "        {",
                f'            "beat": {b_s},',
                f'            "timer": {fmt_timer(a["timer"])}',
                f"        }}{comma}",
            ]
        lines.append("    ]")
        return "\n".join(lines)

    def phase_block(phases: list[dict]) -> str:
        if not phases:
            return "[]"
        lines = ["["]
        for i, p in enumerate(phases):
            comma = "," if i < len(phases) - 1 else ""
            lines += [
                "        {",
                f'            "beat": {fmt_beat(p["beat"])},',
                f'            "phase": {p["phase"]},',
                f'            "power": {p["power"]},',
                f'            "phaseName": {json.dumps(p["phaseName"])}',
                f"        }}{comma}",
            ]
        lines.append("    ]")
        return "\n".join(lines)

    offset = meta["SongOffsetSeconds"]
    offset_s = f"{offset:.1f}" if float(offset).is_integer() else str(offset)

    return "\n".join(
        [
            "{",
            f'    "NameArtist": {json.dumps(meta["NameArtist"])},',
            f'    "NameSong": {json.dumps(meta["NameSong"])},',
            f'    "NameCharter": {json.dumps(meta["NameCharter"])},',
            f'    "FilePath": {json.dumps(meta["FilePath"])},',
            f'    "SongOffsetSeconds": {offset_s},',
            f'    "SongTiming": {timing_block(meta["SongTiming"])},',
            f'    "SongPhases": {phase_block(meta["SongPhases"])},',
            f'    "ChartEasy": {note_block(meta["ChartEasy"])},',
            f'    "ChartNormal": {note_block(meta["ChartNormal"])},',
            f'    "ChartHard": {note_block(meta["ChartHard"])},',
            f'    "ChartExtreme": {note_block(meta["ChartExtreme"])}',
            "}",
            "",
        ]
    )


def write_chart_file(path: Path, meta: dict, bpm: int) -> None:
    lines = [
        "[Song]",
        "{",
        f'  Name = "{meta["NameSong"]}"',
        f'  Artist = "{meta["NameArtist"]}"',
        f'  Charter = "{meta["NameCharter"]}"',
        "  Offset = 0",
        f"  Resolution = {RESOLUTION}",
        "  Player2 = bass",
        "  Difficulty = 0",
        "  PreviewStart = 0",
        "  PreviewEnd = 0",
        '  Genre = "rock"',
        '  MediaType = "cd"',
        '  MusicStream = "song.ogg"',
        "}",
        "[SyncTrack]",
        "{",
        "  0 = TS 4",
        f"  0 = B {int(bpm * 1000)}",
        "}",
        "[Events]",
        "{",
        '  0 = E "section Intro"',
        "}",
    ]

    def smash_to_ch(id_: int) -> list[tuple[int, bool]]:
        return {
            0: [(0, False)],
            1: [(1, False)],
            2: [(3, True)],
            3: [(4, False)],
            4: [(2, True)],
        }.get(id_, [])

    for name, notes in (
        ("EasyDrums", meta["ChartEasy"]),
        ("MediumDrums", meta["ChartNormal"]),
        ("HardDrums", meta["ChartHard"]),
        ("ExpertDrums", meta["ChartExtreme"]),
    ):
        lines += [f"[{name}]", "{"]
        by_tick: dict[int, list[dict]] = defaultdict(list)
        for n in notes:
            by_tick[beat_to_tick(n["Beat"])].append(n)
        for tick in sorted(by_tick):
            seen: set[tuple[int, bool]] = set()
            for n in by_tick[tick]:
                for lane, is_cym in smash_to_ch(n["Id"]):
                    key = (lane, is_cym)
                    if key in seen:
                        continue
                    seen.add(key)
                    lines.append(f"  {tick} = N {lane} 0")
                    if is_cym:
                        lines.append(f"  {tick} = N {lane + 64} 0")
        lines.append("}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_song_ini(path: Path, meta: dict, duration: float) -> None:
    path.write_text(
        f"""[song]
name = {meta['NameSong']}
artist = {meta['NameArtist']}
charter = {meta['NameCharter']}
genre = rock
preview_start_time = 0
song_length = {int(duration * 1000)}
diff_drums = 0
delay = {int(round(meta["SongOffsetSeconds"] * 1000))}
loading_phrase = Converted from MIDI drums
""",
        encoding="utf-8",
    )


def make_cover_png(path: Path, title: str, artist: str) -> None:
    if Image is None:
        return
    size = 500
    img = Image.new("RGB", (size, size), (18, 18, 22))
    draw = ImageDraw.Draw(img)
    for y in range(size):
        c = int(18 + (y / size) * 40)
        draw.line([(0, y), (size, y)], fill=(c, 10, 10))
    draw.rectangle([30, 30, size - 30, size - 30], outline=(220, 40, 40), width=4)
    try:
        font_big = ImageFont.truetype("arial.ttf", 42)
        font_sm = ImageFont.truetype("arial.ttf", 28)
    except Exception:
        font_big = ImageFont.load_default()
        font_sm = font_big

    def center_text(text: str, y: int, font, fill) -> None:
        bbox = draw.textbbox((0, 0), text, font=font)
        w = bbox[2] - bbox[0]
        draw.text(((size - w) / 2, y), text[:40], font=font, fill=fill)

    center_text(title, 200, font_big, (255, 255, 255))
    center_text(artist, 260, font_sm, (200, 200, 200))
    center_text("Smash Drums", 340, font_sm, (160, 160, 160))
    img.save(path, "PNG")


def make_preview_wav(audio_path: Path, out_path: Path, seconds: int = 12, out_rate: int = 22050) -> None:
    if sf is None or np is None:
        # silent placeholder
        with wave.open(str(out_path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(out_rate)
            w.writeframes(b"\x00\x00" * out_rate * seconds)
        return
    data, sr = sf.read(str(audio_path), always_2d=True)
    mono = data.mean(axis=1)
    n = int(seconds * sr)
    clip = mono[:n]
    if len(clip) < n:
        clip = np.pad(clip, (0, n - len(clip)))
    x_old = np.linspace(0, 1, len(clip), endpoint=False)
    x_new = np.linspace(0, 1, int(seconds * out_rate), endpoint=False)
    resampled = np.interp(x_new, x_old, clip).astype(np.float32)
    pcm_i16 = (np.clip(resampled, -1, 1) * 32767.0).astype(np.int16)
    with wave.open(str(out_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(out_rate)
        w.writeframes(pcm_i16.tobytes())


def find_sidecar_audio(midi_path: Path) -> Path | None:
    """Look for song.ogg / song.mp3 / matching stems next to the MIDI."""
    parent = midi_path.parent
    stem = midi_path.stem
    base = re.sub(r"_(drums?|drum|percussion)(_\d+)?$", "", stem, flags=re.I)
    base = re.sub(r"_\d{10,}$", "", base)
    candidates = [
        parent / f"{base}.ogg",
        parent / f"{base}.mp3",
        parent / f"{base}.wav",
        parent / f"{base}.flac",
        parent / "song.ogg",
        parent / "song.mp3",
        parent / "audio.ogg",
        parent / f"{stem}.ogg",
    ]
    # also try without _drums and with " - " style
    for p in candidates:
        if p.exists():
            return p
    # any non-drum ogg in same folder with similar name
    for p in parent.glob("*.ogg"):
        if "drum" not in p.stem.lower():
            if base.lower() in p.stem.lower() or p.stem.lower() in base.lower():
                return p
    return None


def copy_as_ogg(src: Path, dst: Path) -> bool:
    """Package audio as a REAL Ogg Vorbis file.

    Indies packages expect audio.ogg — writing MP3/WAV bytes into an .ogg
    filename produces a file the game/editor cannot decode. Ogg sources are
    copied as-is; anything else is transcoded (soundfile, else ffmpeg).

    Returns True when audio.ogg is guaranteed-decodable Ogg.
    """
    if src.suffix.lower() == ".ogg":
        dst.write_bytes(src.read_bytes())
        return True
    if sf is not None:
        # Isolated in a subprocess on purpose: a broken libsndfile vorbis
        # encoder can hard-crash (native stack overflow) the whole process,
        # which would abort the conversion. A crashed child just fails here
        # and we fall through to ffmpeg / the raw-copy fallback.
        code = (
            "import sys, soundfile as sf; "
            "d, sr = sf.read(sys.argv[1], always_2d=True); "
            "sf.write(sys.argv[2], d, sr, format='OGG', subtype='VORBIS')"
        )
        try:
            r = subprocess.run(
                [sys.executable, "-c", code, str(src), str(dst)],
                capture_output=True,
                timeout=300,
            )
            if r.returncode == 0 and dst.exists() and dst.stat().st_size > 0:
                return True
        except Exception:
            pass
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        try:
            subprocess.run(
                [ffmpeg, "-y", "-v", "error", "-i", str(src),
                 "-c:a", "libvorbis", str(dst)],
                check=True,
                capture_output=True,
            )
            if dst.exists() and dst.stat().st_size > 0:
                return True
        except Exception:
            pass
    # Last resort: ship the original bytes under the expected name plus an
    # honest sidecar. If audio.ogg won't play in-game, load the sidecar.
    dst.write_bytes(src.read_bytes())
    sidecar = dst.with_name(f"source_audio{src.suffix.lower()}")
    sidecar.write_bytes(src.read_bytes())
    print(
        f"  WARNING: could not transcode {src.name} to Ogg — audio.ogg "
        f"contains raw {src.suffix} bytes. Install ffmpeg for a proper "
        f"conversion, or load {sidecar.name} in the editor."
    )
    return False


# ---------------------------------------------------------------------------
# Convert one file
# ---------------------------------------------------------------------------

def convert_one(
    midi_path: Path,
    *,
    out_root: Path,
    artist: str | None,
    title: str | None,
    charter: str,
    audio: Path | None,
    offset: float,
    bpm: float | None,
    no_downchart: bool,
    open_folder: bool,
    align: bool = True,
    force: bool = True,
    min_velocity: int = DEFAULT_MIN_VELOCITY,
    tom_min_velocity: int | None = None,
    channel: int | None = None,
    all_channels: bool = False,
    spacing: int = DEFAULT_SPACING_SUBDIV,
) -> Path:
    midi_path = midi_path.resolve()
    if not midi_path.exists():
        raise FileNotFoundError(f"MIDI not found: {midi_path}")
    if midi_path.suffix.lower() not in {".mid", ".midi"}:
        raise ValueError(f"Not a MIDI file: {midi_path}")

    # Always Smash-playable — not optional
    max_chord = DEFAULT_MAX_CHORD
    hihat_subdivision = DEFAULT_HIHAT_SUBDIVISION

    g_artist, g_title = guess_meta_from_filename(midi_path)
    artist = (artist or g_artist).strip() or "Unknown Artist"
    title = (title or g_title).strip() or midi_path.stem

    # Parse with MIDI-native tempo first; BPM override / align applied after
    parsed = parse_midi(
        midi_path,
        bpm_override=None,
        min_velocity=min_velocity,
        tom_min_velocity=tom_min_velocity,
        channel=channel,
        all_channels=all_channels,
    )
    extreme = parsed["extreme"]
    if not extreme:
        hint = ""
        if parsed.get("skipped_channel") or parsed.get("skipped_quiet"):
            hint = (
                f" (dropped {parsed.get('skipped_channel', 0)} other-channel, "
                f"{parsed.get('skipped_quiet', 0)} quiet hits — try --all-channels "
                f"or --min-velocity 1)"
            )
        raise RuntimeError(f"No mappable drum notes in {midi_path.name}{hint}")

    safe_guess = sanitize_filename(title)
    audio_src = audio
    if audio_src is None or not Path(audio_src).exists():
        audio_src = find_sidecar_audio(midi_path)
    if (audio_src is None or not Path(audio_src).exists()) and (out_root / safe_guess / "audio.ogg").exists():
        audio_src = out_root / safe_guess / "audio.ogg"

    bpm_final = float(bpm) if bpm is not None else float(parsed["midi_bpm"])
    beat_shift = 0.0
    song_offset = float(offset)
    align_info: dict | None = None

    # Auto tempo fit when possible. Classic symptom of wrong MIDI tempo:
    # offset lines up the start, then notes fall behind â†’ BPM is too low.
    # We fix BPM from the audio and only apply a beat-shift lag when the
    # lock is strong AND the user did not set --offset themselves.
    if align and audio_src and Path(audio_src).exists() and bpm is None:
        print(f"  Fitting tempo to audio: {audio_src.name} ...")
        # Multi-tempo MIDIs: the fit works on seconds, so center the search
        # on the song's average rate rather than the first tempo event.
        ref_bpm = (
            parsed["eff_bpm"] if parsed["has_tempo_changes"] else parsed["midi_bpm"]
        )
        align_info = align_midi_to_audio(
            parsed["align_times"],
            ref_bpm,
            audio_src,
            bpm_hint=ref_bpm,
        )
        if align_info and align_info.get("accepted"):
            bpm_final = float(align_info["bpm"])
            lag = float(align_info["lag_sec"])
            # If user already provided an offset, only correct BPM (no lag shift)
            # so their start lock still roughly holds.
            if abs(song_offset) < 1e-6 and abs(lag) > 0.02:
                beat_shift = lag * bpm_final / 60.0
                print(
                    f"  Tempo fit: BPM {parsed['midi_bpm']:.2f} â†’ {bpm_final:.2f}, "
                    f"lag {lag:+.3f}s (beat shift {beat_shift:+.3f}), "
                    f"score {align_info['score']:.3f}"
                )
            else:
                print(
                    f"  Tempo fit: BPM {parsed['midi_bpm']:.2f} â†’ {bpm_final:.2f} "
                    f"(score {align_info['score']:.3f}). "
                    f"Lag {lag:+.3f}s left to Song Offset / your manual offset."
                )
        elif align_info:
            print(
                f"  Tempo fit weak (score {align_info['score']:.3f} vs baseline "
                f"{align_info['baseline']:.3f}) â€” keeping MIDI tempo {parsed['midi_bpm']:.2f}. "
                f"If notes fall behind, raise BPM a few points (e.g. --bpm 163)."
            )
        else:
            print("  Tempo fit skipped (could not analyse audio).")

    # Timing. The game requires whole-number anchor beats, and honors the
    # full anchor list — so when the MIDI has tempo changes that land on
    # whole beats we emit them exactly instead of flattening to one BPM
    # (which silently drifts mid-song). Overridden/fitted BPM wins instead.
    align_accepted = bool(align_info and align_info.get("accepted"))
    tempo_map_fit = None
    if bpm is None and not align_accepted and abs(beat_shift) < 1e-9:
        tempo_map_fit = timing_from_tempo_map(
            parsed["tpb"], parsed["tempo_map"], parsed["last_beat"]
        )
    if tempo_map_fit is not None:
        song_timing, duration_sec, eff_bpm = tempo_map_fit
        last = extreme[-1]["Beat"] if extreme else 0.0
        bpm_report = eff_bpm
        parsed["timing_mode"] = "tempo map"
    else:
        if parsed["has_tempo_changes"] and bpm is None and not align_accepted:
            print(
                "  Note: MIDI tempo changes don't land on whole beats, which "
                "the game can't represent (SongTiming beats are integers). "
                "Using a constant BPM — check sync in-game."
            )
        extreme, song_timing, last, duration_sec = apply_timing_fix(
            extreme, bpm=bpm_final, beat_shift=beat_shift
        )
        bpm_report = bpm_final
        parsed["timing_mode"] = "constant"
    # User --offset is silent lead-in (chart before audio). Applied as SongOffsetSeconds.
    # When we already beat-shifted for audio lag, leave offset as user-specified only.
    parsed["bpm"] = int(round(bpm_report))
    parsed["bpm_float"] = bpm_report
    parsed["song_timing"] = song_timing
    parsed["last_beat"] = last
    parsed["duration_sec"] = duration_sec

    # Snap to the note grid (default 1/16) so micro-timed MIDI hits (flams,
    # late snares) land ON gridlines instead of cramming between them. Runs
    # before hat limiting / chord cap so those see final positions.
    extreme, snapped_moved, snapped_merged = snap_to_grid(extreme, spacing)
    parsed["spacing_subdivision"] = spacing
    parsed["spacing_moved"] = snapped_moved
    parsed["spacing_merged"] = snapped_merged

    # Always Smash-playable: 1/8 max hats, max 2 pads per stack, tom floor
    # already applied in parse_midi. Hat limiting can leave two pads on a
    # busy beat, so chord cap runs after.
    extreme_before_cap = len(extreme)
    extreme, hihat_dropped = limit_hihat_rate(
        extreme, subdivision=hihat_subdivision
    )
    extreme, chord_dropped, chords_thinned = cap_chord_size(extreme, max_chord)
    parsed["max_chord"] = max_chord
    parsed["chord_dropped"] = chord_dropped
    parsed["chords_thinned"] = chords_thinned
    parsed["extreme_before_cap"] = extreme_before_cap
    parsed["hihat_subdivision"] = hihat_subdivision
    parsed["hihat_dropped"] = hihat_dropped

    if no_downchart:
        hard = list(extreme)
        normal = list(extreme)
        easy = list(extreme)
    else:
        hard = downchart(extreme, "hard")
        normal = downchart(extreme, "normal")
        easy = downchart(extreme, "easy")

    # Hard rule: every note Neutral. Smash 0 = Crystal, 2 = Burning.
    for chart in (extreme, hard, normal, easy):
        for n in chart:
            n["Strength"] = NORMAL_STRENGTH

    phases = [
        {"beat": 0.0, "phase": 1, "power": 0.6, "phaseName": "Intro"},
        {"beat": 16.0 + beat_shift, "phase": 2, "power": 0.7, "phaseName": "Verse"},
        {"beat": 80.0 + beat_shift, "phase": 4, "power": 0.9, "phaseName": "CHORUS"},
        {"beat": 144.0 + beat_shift, "phase": 2, "power": 0.7, "phaseName": "Verse"},
        {"beat": 208.0 + beat_shift, "phase": 4, "power": 0.9, "phaseName": "CHORUS"},
        {"beat": 272.0 + beat_shift, "phase": 6, "power": 0.85, "phaseName": "Solo"},
        {"beat": 336.0 + beat_shift, "phase": 4, "power": 0.9, "phaseName": "CHORUS"},
        {"beat": 400.0 + beat_shift, "phase": 7, "power": 0.7, "phaseName": "Outro"},
    ]
    phases = [
        {**p, "beat": float(quantize_beat(p["beat"]))}
        for p in phases
        if p["beat"] <= last + 4
    ] or [{"beat": 0.0, "phase": 1, "power": 0.7, "phaseName": "Intro"}]

    meta = {
        "NameArtist": artist,
        "NameSong": title,
        "NameCharter": charter,
        "FilePath": "audio.ogg",
        "SongOffsetSeconds": song_offset,
        "SongTiming": song_timing,
        "SongPhases": phases,
        "ChartEasy": easy,
        "ChartNormal": normal,
        "ChartHard": hard,
        "ChartExtreme": extreme,
    }

    safe = sanitize_filename(title)
    out_root.mkdir(parents=True, exist_ok=True)
    folder = out_root / safe
    if not force and folder.exists() and any(folder.iterdir()):
        n = 2
        while (out_root / f"{safe} ({n})").exists():
            n += 1
        folder = out_root / f"{safe} ({n})"
        safe = folder.name
    folder.mkdir(parents=True, exist_ok=True)
    indies_path = out_root / f"{safe}.indies"

    meta_text = format_meta(meta)
    (folder / "meta.json").write_text(meta_text, encoding="utf-8")
    write_chart_file(folder / "notes.chart", meta, parsed["bpm"])
    write_song_ini(folder / "song.ini", meta, parsed["duration_sec"])

    cover_path = folder / "cover.png"
    make_cover_png(cover_path, title, artist)

    # Prefer explicit/found audio; also reuse already-packaged audio.ogg in out folder
    if audio_src is None or not audio_src.exists():
        packaged = folder / "audio.ogg"
        if packaged.exists():
            audio_src = packaged

    audio_dst = folder / "audio.ogg"
    preview_path = folder / "preview.wav"
    has_audio = False
    if audio_src and audio_src.exists():
        if audio_src.resolve() != audio_dst.resolve():
            copy_as_ogg(audio_src, audio_dst)
        make_preview_wav(audio_src, preview_path)
        has_audio = True
    else:
        with wave.open(str(preview_path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(22050)
            w.writeframes(b"\x00\x00" * 22050 * 12)

    with zipfile.ZipFile(indies_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("meta.json", meta_text)
        if has_audio and audio_dst.exists():
            zf.write(audio_dst, "audio.ogg")
        if cover_path.exists():
            zf.write(cover_path, "cover.png")
        zf.write(preview_path, "preview.wav")

    # Report
    def count_ids(notes: list[dict]) -> str:
        c: dict[int, int] = defaultdict(int)
        for n in notes:
            c[n["Id"]] += 1
        parts = [f"{SMASH_NAMES[i]}={c[i]}" for i in sorted(c)]
        return ", ".join(parts) if parts else "(empty)"

    print()
    print("=" * 60)
    print(f"  {artist} — {title}")
    print("=" * 60)
    print(f"  MIDI:     {midi_path}")
    print(f"  Channel:  {parsed.get('channel_mode', 'all')}")
    print(
        f"  Velocity: min {parsed.get('min_velocity', min_velocity)}, "
        f"tom min {parsed.get('tom_min_velocity', tom_min_velocity or DEFAULT_TOM_MIN_VELOCITY)}"
        f"  (dropped quiet={parsed.get('skipped_quiet', 0)}, "
        f"other src={parsed.get('skipped_channel', 0)}, "
        f"bass→tom={parsed.get('skipped_bass_tom', 0)})"
    )
    mc = parsed.get("max_chord", max_chord)
    print(
        f"  Chords:   max {mc} pads per stack (always; stacks = notes within "
        f"1/{CHORD_WINDOW_SUBDIV} beat)  "
        f"(thinned {parsed.get('chords_thinned', 0)} stacks, "
        f"dropped {parsed.get('chord_dropped', 0)} notes; "
        f"{parsed.get('extreme_before_cap', len(extreme))} → {len(extreme)})"
    )
    sp = int(parsed.get("spacing_subdivision", spacing))
    if sp > 0:
        sp_label = {4: "1/4", 8: "1/8", 16: "1/16", 32: "1/32"}.get(sp, f"1/{sp}")
        print(
            f"  Spacing:  {sp_label} grid (snapped {parsed.get('spacing_moved', 0)}, "
            f"merged {parsed.get('spacing_merged', 0)} same-cell duplicates)"
        )
    else:
        print("  Spacing:  off (raw MIDI timing)")
    hat_sub = int(parsed.get("hihat_subdivision", hihat_subdivision))
    hat_drop = parsed.get("hihat_dropped", 0)
    gap = subdivision_to_gap_beats(hat_sub)
    label = {4: "1/4", 8: "1/8", 16: "1/16"}.get(hat_sub, f"1/{hat_sub}")
    print(
        f"  Hi-hats:  max {label} notes (always)  "
        f"(min gap {gap:g} beat, dropped {hat_drop})"
    )
    print(f"  BPM:      {parsed['bpm_float']:.3f}  (MIDI file said {parsed['midi_bpm']:.2f})")
    if parsed.get("timing_mode") == "tempo map":
        print(
            f"  Timing:   tempo map ({len(parsed['song_timing'])} anchors, "
            f"all integer beats)"
        )
    else:
        print("  Timing:   constant BPM (3 anchors, integer beats)")
    if beat_shift:
        print(f"  Beat shift: {beat_shift:+.3f} (audio lock)")
    print(f"  Duration: {parsed['duration_sec']:.1f}s  |  last beat {parsed['last_beat']}")
    print(f"  Offset:   {song_offset}s")
    print(f"  Audio:    {audio_src if has_audio else '(none — load Song in editor)'}")
    print()
    print("  Source GM notes:")
    for n, cnt in sorted(parsed["gm_counts"].items(), key=lambda x: -x[1]):
        mapped = GM_TO_SMASH.get(n)
        dest = SMASH_NAMES.get(mapped, "?") if mapped is not None else "SKIPPED"
        print(f"    {n:3d} {GM_NAMES.get(n, 'unknown'):16s} x{cnt:<5d} → {dest}")
    if parsed["unmapped"]:
        print("  Unmapped (skipped):", parsed["unmapped"])
    print()
    print(f"  Extreme: {len(extreme):4d}  ({count_ids(extreme)})")
    print(f"  Hard:    {len(hard):4d}  ({count_ids(hard)})")
    print(f"  Normal:  {len(normal):4d}  ({count_ids(normal)})")
    print(f"  Easy:    {len(easy):4d}  ({count_ids(easy)})")
    print()
    print(f"  Folder:  {folder}")
    print(f"  Indies:  {indies_path}")
    print()
    print("  Open in Smash Drums Editor → Import → pick the .indies file")
    if not has_audio:
        print("  Then load Song audio if hits should play with music.")
    print("=" * 60)

    if open_folder:
        try:
            import os

            os.startfile(folder)  # type: ignore[attr-defined]
        except Exception:
            pass

    return indies_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="midi_to_smash",
        description="Convert MIDI drum tracks into Smash Drums Editor charts (.indies).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  midi_to_smash.py drums.mid
  midi_to_smash.py drums.mid --audio song.ogg
  midi_to_smash.py a.mid b.mid c.mid
  midi_to_smash.py drums.mid --artist "Tool" --title "Parabola" --charter "You"
  midi_to_smash.py drums.mid --offset 0.08 --bpm 160

Drag & drop MIDI files onto Convert MIDI to Smash.bat on your Desktop.
""",
    )
    p.add_argument(
        "midi",
        nargs="+",
        type=Path,
        help="One or more .mid / .midi drum files",
    )
    p.add_argument(
        "--audio",
        "-a",
        type=Path,
        default=None,
        help="Full-mix audio (ogg preferred). Auto-detects song.ogg next to MIDI if omitted.",
    )
    p.add_argument("--artist", default=None, help="Artist name (default: guess from filename)")
    p.add_argument("--title", default=None, help="Song title (default: guess from filename)")
    p.add_argument("--charter", "-c", default="MIDI Convert", help="Charter name")
    p.add_argument(
        "--offset",
        type=float,
        default=0.0,
        help="Song offset in seconds (positive = chart waits for audio)",
    )
    p.add_argument(
        "--bpm",
        type=float,
        default=None,
        help="Override BPM (default: read from MIDI tempo)",
    )
    p.add_argument(
        "--out",
        "-o",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output directory (default: {DEFAULT_OUTPUT})",
    )
    p.add_argument(
        "--no-downchart",
        action="store_true",
        help="Copy Extreme notes into Hard/Normal/Easy instead of thinning",
    )
    p.add_argument(
        "--open",
        action="store_true",
        help="Open the output folder when done (Windows)",
    )
    p.add_argument(
        "--inspect",
        action="store_true",
        help="Only print MIDI note stats, do not convert",
    )
    p.add_argument(
        "--no-align",
        action="store_true",
        help="Do not auto-fit BPM/lag against audio (use MIDI tempo as-is)",
    )
    p.add_argument(
        "--spacing",
        type=int,
        default=DEFAULT_SPACING_SUBDIV,
        metavar="N",
        help=(
            "Snap every note to the nearest 1/N beat so micro-timed hits land "
            "on gridlines (default 16 = sixteenths — the densest grid the "
            "converter allows). Use 0 to keep raw MIDI timing."
        ),
    )
    p.add_argument(
        "--no-force",
        action="store_true",
        help="Do not overwrite existing output folder (create Song (2) instead)",
    )
    p.add_argument(
        "--min-velocity",
        type=int,
        default=DEFAULT_MIN_VELOCITY,
        metavar="N",
        help=(
            f"Ignore note-ons quieter than N (1–127). "
            f"Cuts ghost hits / bleed. Default: {DEFAULT_MIN_VELOCITY}. Use 1 to keep everything."
        ),
    )
    p.add_argument(
        "--tom-min-velocity",
        type=int,
        default=None,
        metavar="N",
        help=(
            f"Raise the tom velocity floor only (always at least "
            f"{DEFAULT_TOM_MIN_VELOCITY}). Phantom toms / bleed use this. "
            f"Cannot go below {DEFAULT_TOM_MIN_VELOCITY}."
        ),
    )
    p.add_argument(
        "--all-channels",
        action="store_true",
        help="Read every MIDI channel (default: prefer GM drum channel 10 when present)",
    )
    p.add_argument(
        "--channel",
        type=int,
        default=None,
        metavar="N",
        help="Force a single MIDI channel 0–15 (overrides --all-channels). GM drums = 9.",
    )
    return p


def inspect_midi(
    path: Path,
    *,
    min_velocity: int = DEFAULT_MIN_VELOCITY,
    tom_min_velocity: int | None = None,
    channel: int | None = None,
    all_channels: bool = False,
) -> None:
    parsed = parse_midi(
        path,
        min_velocity=min_velocity,
        tom_min_velocity=tom_min_velocity,
        channel=channel,
        all_channels=all_channels,
    )
    print(f"\n{path.name}")
    print(f"  ticks/beat: {parsed['tpb']}")
    print(f"  BPM:        {parsed['midi_bpm']:.3f}")
    print(f"  duration:   {parsed['midi_duration_sec']:.2f}s")
    print(f"  note-ons:   {parsed['note_count_raw']}")
    print(f"  channel:    {parsed['channel_mode']}")
    print(
        f"  velocity:   min {parsed['min_velocity']}, tom min {parsed['tom_min_velocity']} "
        f"(quiet skipped {parsed['skipped_quiet']}, other src {parsed['skipped_channel']}, "
        f"bass→tom {parsed.get('skipped_bass_tom', 0)})"
    )
    if parsed.get("has_tempo_changes"):
        n_tempos = len({t for _, t in parsed["tempo_map"]})
        fit = timing_from_tempo_map(
            parsed["tpb"], parsed["tempo_map"], parsed["last_beat"]
        )
        status = (
            "game-representable (integer-beat anchors)"
            if fit
            else "NOT game-representable (tempo changes off whole beats)"
        )
        print(
            f"  tempos:     {n_tempos} distinct, avg {parsed['eff_bpm']:.1f} BPM — {status}"
        )
    if parsed.get("track_names"):
        names = ", ".join(
            f"t{ti}={n!r}" for ti, n in sorted(parsed["track_names"].items()) if n
        )
        if names:
            print(f"  tracks:     {names}")
    if parsed["channel_counts"]:
        ch_parts = [
            f"ch{ch + 1}={cnt}"
            for ch, cnt in sorted(parsed["channel_counts"].items(), key=lambda x: -x[1])
        ]
        print(f"  by channel: {', '.join(ch_parts)}")
    print("  notes (kept):")
    for n, cnt in sorted(parsed["gm_counts"].items(), key=lambda x: -x[1]):
        mapped = GM_TO_SMASH.get(n)
        dest = SMASH_NAMES.get(mapped, "?") if mapped is not None else "SKIP"
        print(f"    {n:3d} {GM_NAMES.get(n, '?'):16s} x{cnt:<5d} → {dest}")
    if parsed["unmapped"]:
        print("  unmapped (on active channel):", parsed["unmapped"])


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    midis: list[Path] = []
    for m in args.midi:
        if m.is_dir():
            midis.extend(sorted(m.glob("*.mid")))
            midis.extend(sorted(m.glob("*.midi")))
        else:
            midis.append(m)

    if not midis:
        parser.error("No MIDI files found")

    if args.inspect:
        for m in midis:
            try:
                inspect_midi(
                    m,
                    min_velocity=args.min_velocity,
                    tom_min_velocity=args.tom_min_velocity,
                    channel=args.channel,
                    all_channels=args.all_channels,
                )
            except Exception as e:
                print(f"ERROR {m}: {e}", file=sys.stderr)
        return 0

    if args.audio and len(midis) > 1:
        print("Note: --audio applies to every MIDI when converting multiple files.")

    errors = 0
    for m in midis:
        try:
            convert_one(
                m,
                out_root=args.out.resolve(),
                artist=args.artist,
                title=args.title if len(midis) == 1 else None,
                charter=args.charter,
                audio=args.audio,
                offset=args.offset,
                bpm=args.bpm,
                no_downchart=args.no_downchart,
                open_folder=args.open and len(midis) == 1,
                align=not args.no_align,
                force=not args.no_force,
                min_velocity=args.min_velocity,
                tom_min_velocity=args.tom_min_velocity,
                channel=args.channel,
                all_channels=args.all_channels,
                spacing=args.spacing,
            )
        except Exception as e:
            errors += 1
            print(f"ERROR converting {m}: {e}", file=sys.stderr)

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
