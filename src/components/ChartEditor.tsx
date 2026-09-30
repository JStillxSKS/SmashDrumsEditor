import { useCallback, useEffect, useRef, useState } from "react";
import type { ChartNote, DrumId, SongPhase, TimingAnchor } from "../types/meta";
import {
  DRUM_LANES,
  findCrossedNotes,
  findCrossedPhase,
  laneById,
  laneColumnIndex,
  laneIdFromColumn,
  noteHitKey,
  phaseById,
  sortSongPhases,
} from "../types/meta";
import { useEditorStore } from "../store/useEditorStore";
import {
  RESOLUTION,
  VISUAL_GRID_TICKS,
  beatToTick,
  formatTick,
  snapTick,
  ticksPerMeasure,
  visualGridRowPixels,
  visualGridStep,
} from "../utils/resolution";
import { getTimeSignature } from "../utils/metaIO";
import {
  getPlaybackAudioTime,
  seekChartTime,
  seekScrollTick,
} from "../utils/audioElement";
import { editorAudioPlayer } from "../utils/editorAudioPlayer";
import { playDrumHit } from "../utils/drumHits";
import { getSongOffset, isInSilentLeadIn } from "../utils/offset";
import { beatToTime, timeToBeat } from "../utils/timing";
import { drawLaneWaveStroke } from "../utils/waveDraw";
import { viewportTickRange } from "../utils/noteClipboard";
import { buildWaveformByTick, type WavePeak } from "../utils/waveform";
import { getLaneWaveformBuffer } from "../utils/audioSource";
import { SongOverview } from "./SongOverview";
import { HIGHWAY_THEME as T } from "../theme/highway";
import { useMobileLayout } from "../hooks/useMobileLayout";

const STRIKE_OFFSET = 150;
const PHASE_BLINK_MS = 550;
const NOTE_HIT_MS = 520;
/** Shorter, cheaper strike pulse on mobile */
const NOTE_HIT_MS_MOBILE = 280;
const LANE_HEADER_H = 44;
const MOBILE_TOOL_HINT_MS = 10_000;
const LANE_GAP = 6;
const SELECTION_SCROLL_EDGE = 44;
const SELECTION_SCROLL_MAX_TICKS = 18;
/** Finger hit pad around strike receptors (place by tapping lane color). */
const STRIKE_TAP_PAD = 48;
/** Movement past this (px) becomes a pan, not a tap. */
const POINTER_PAN_THRESHOLD = 12;
/** Larger gem hit radius on coarse pointers. */
const NOTE_HIT_PAD_MOBILE = 18;
const NOTE_HIT_PAD_DESKTOP = 8;

type NoteSelectionState = {
  dragging: boolean;
  anchorTick: number;
  anchorCol: number;
  currentTick: number;
  currentCol: number;
  pointerX: number;
  pointerY: number;
};

function laneMetrics(trackW: number) {
  const gap = LANE_GAP;
  const laneW = (trackW - gap * (DRUM_LANES.length - 1)) / DRUM_LANES.length;
  return { laneW, gap };
}

function laneLeft(trackX: number, col: number, laneW: number, gap: number) {
  return trackX + col * (laneW + gap);
}

function laneCenter(trackX: number, col: number, laneW: number, gap: number) {
  return laneLeft(trackX, col, laneW, gap) + laneW / 2;
}

function columnAtX(x: number, trackX: number, trackW: number): number | null {
  const { laneW, gap } = laneMetrics(trackW);
  for (let col = 0; col < DRUM_LANES.length; col++) {
    const left = laneLeft(trackX, col, laneW, gap);
    if (x >= left && x < left + laneW) return col;
  }
  return null;
}

function pointerToChart(
  x: number,
  y: number,
  scrollTick: number,
  canvasW: number,
  canvasH: number,
  ppt: number
): { tick: number; col: number } {
  const sy = canvasH - STRIKE_OFFSET;
  const tick = scrollTick + (sy - y) / ppt;
  const col = columnAtX(x, 0, canvasW) ?? (x < canvasW / 2 ? 0 : DRUM_LANES.length - 1);
  return { tick, col };
}

function drawNoteSelectionBox(
  ctx: CanvasRenderingContext2D,
  selection: NoteSelectionState,
  scrollTick: number,
  w: number,
  h: number,
  ppt: number
) {
  const sy = h - STRIKE_OFFSET;
  const { laneW, gap } = laneMetrics(w);
  const loT = Math.min(selection.anchorTick, selection.currentTick);
  const hiT = Math.max(selection.anchorTick, selection.currentTick);
  const loC = Math.min(selection.anchorCol, selection.currentCol);
  const hiC = Math.max(selection.anchorCol, selection.currentCol);
  const x = laneLeft(0, loC, laneW, gap);
  const boxW = laneLeft(0, hiC, laneW, gap) + laneW - x;
  const yTop = sy - (hiT - scrollTick) * ppt;
  const yBottom = sy - (loT - scrollTick) * ppt;

  ctx.save();
  ctx.fillStyle = "rgba(255, 184, 0, 0.14)";
  ctx.strokeStyle = "rgba(255, 184, 0, 0.85)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.fillRect(x, yTop, boxW, yBottom - yTop);
  ctx.strokeRect(x + 0.5, yTop + 0.5, boxW - 1, yBottom - yTop - 1);
  ctx.restore();
}

/** Place/erase hit-test — match the gem under the pointer, not just the snapped grid row. */
function findNoteAtPoint(
  x: number,
  y: number,
  canvasH: number,
  canvasW: number,
  scrollTick: number,
  ppt: number,
  gridRowPx: number,
  notes: ChartNote[],
  hitPad = NOTE_HIT_PAD_DESKTOP
): ChartNote | null {
  const col = columnAtX(x, 0, canvasW);
  if (col === null) return null;

  const laneId = laneIdFromColumn(col);
  const { laneW } = laneMetrics(canvasW);
  const sy = canvasH - STRIKE_OFFSET;

  let best: ChartNote | null = null;
  let bestDist = Infinity;

  for (const note of notes) {
    if (note.Id !== laneId) continue;
    const tick = beatToTick(note.Beat);
    const noteY = sy - (tick - scrollTick) * ppt;
    const { h } = noteBoxSize(laneW, gridRowPx);
    const halfH = h / 2 + hitPad;
    if (y < noteY - halfH || y > noteY + halfH) continue;
    const dist = Math.abs(y - noteY);
    if (dist < bestDist) {
      best = note;
      bestDist = dist;
    }
  }

  return best;
}

function isStrikeBarTap(y: number, canvasH: number): boolean {
  const sy = canvasH - STRIKE_OFFSET;
  return Math.abs(y - sy) <= STRIKE_TAP_PAD;
}

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function lighten(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (c: number) => Math.max(0, Math.min(255, c + amt));
  const r = clamp((n >> 16) & 255);
  const g = clamp((n >> 8) & 255);
  const b = clamp(n & 255);
  return `rgb(${r},${g},${b})`;
}

function noteBoxSize(laneW: number, rowPx: number) {
  const pad = 3;
  // Pixel-align width so edges stay crisp on HiDPI canvases.
  const w = Math.max(10, Math.round(laneW - pad * 2));
  const maxH = Math.max(14, rowPx - pad * 2);
  const h = Math.max(10, Math.round(maxH * 0.72));
  // Tighter corners = sharper “gem tile” look.
  const r = Math.min(4, Math.round(h * 0.16));
  return { w, h, r };
}

/** Snap gem center to device pixels for cleaner edges. */
function alignGemCenter(cx: number, cy: number) {
  return { cx: Math.round(cx) + 0.5, cy: Math.round(cy) + 0.5 };
}

/** Editor-only hit pulse — not exported to chart files */
function noteHitIntensity(elapsedMs: number, lite = false): number {
  const maxMs = lite ? NOTE_HIT_MS_MOBILE : NOTE_HIT_MS;
  if (elapsedMs < 0 || elapsedMs >= maxMs) return 0;
  const t = elapsedMs / maxMs;
  if (lite) return Math.pow(1 - t, 1.15);
  const attack = elapsedMs < 55 ? 1 : 0;
  const decay = Math.pow(1 - t, 0.65);
  const pulse = 0.65 + 0.35 * Math.sin((1 - t) * Math.PI * 2.5);
  return Math.min(1, attack * 0.35 + decay * pulse);
}

function drawGemNote(
  ctx: CanvasRenderingContext2D,
  cxIn: number,
  cyIn: number,
  laneW: number,
  color: string,
  strength: 0 | 1 | 2,
  rowPx: number,
  hitIntensity = 0,
  lite = false
) {
  const { cx, cy } = alignGemCenter(cxIn, cyIn);
  const { w, h, r } = noteBoxSize(laneW, rowPx);
  const x = cx - w / 2;
  const y = cy - h / 2;
  const isCrystal = strength === 0;
  const isBurning = strength === 2;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  // Prefer crisp stroke joins on rounded rects.
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (hitIntensity > 0) {
    // Smaller pop — less mushy scale bloom.
    const scale = 1 + hitIntensity * (lite ? 0.22 : 0.32);
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
  }

  if (isCrystal) {
    ctx.globalAlpha *= lite ? 0.72 : 0.78;
  }

  // Mobile: flat fills, thin outline (still readable, cheap)
  if (lite) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = isCrystal
      ? hexToRgba(color, 0.5)
      : isBurning
        ? lighten(color, 18)
        : color;
    ctx.fill();
    ctx.strokeStyle = isBurning
      ? hexToRgba(lighten(color, 55), 0.95)
      : hitIntensity > 0.2
        ? `rgba(255,255,255,${0.55 + hitIntensity * 0.35})`
        : "rgba(0,0,0,0.55)";
    ctx.lineWidth = isBurning ? 1.75 : 1.25;
    ctx.stroke();
    // Inner rim for definition
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 1.25, y + 1.25, w - 2.5, h - 2.5, Math.max(0, r - 1));
    ctx.stroke();
    const dotR = Math.max(1.75, Math.min(w, h) * 0.1);
    ctx.beginPath();
    ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();
    return;
  }

  // Soft outer halo only for burning / hit — tight, not foggy.
  if (isBurning || hitIntensity > 0.2) {
    ctx.shadowColor = isBurning
      ? hexToRgba(lighten(color, 40), 0.55)
      : "rgba(255,255,255,0.45)";
    ctx.shadowBlur = isBurning ? 8 + hitIntensity * 6 : 4 + hitIntensity * 8;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = hexToRgba(color, isBurning ? 0.35 : 0.2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }

  // Body: short vertical gradient (flat enough to stay sharp).
  const body = ctx.createLinearGradient(x, y, x, y + h);
  if (isCrystal) {
    body.addColorStop(0, hexToRgba(lighten(color, 70), 0.75));
    body.addColorStop(0.55, hexToRgba(color, 0.55));
    body.addColorStop(1, hexToRgba(color, 0.4));
  } else if (isBurning) {
    body.addColorStop(0, lighten(color, 55 + hitIntensity * 20));
    body.addColorStop(0.45, lighten(color, 12));
    body.addColorStop(1, color);
  } else {
    body.addColorStop(0, lighten(color, 42 + hitIntensity * 18));
    body.addColorStop(0.5, color);
    body.addColorStop(1, lighten(color, -18));
  }

  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = body;
  ctx.fill();

  // Dark outer edge — primary “crisp” outline
  ctx.strokeStyle = isBurning
    ? hexToRgba(lighten(color, 30), 0.95)
    : "rgba(0,0,0,0.65)";
  ctx.lineWidth = isBurning ? 1.75 : 1.35;
  ctx.beginPath();
  ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, Math.max(0, r - 0.5));
  ctx.stroke();

  // Bright inner rim
  ctx.strokeStyle = isCrystal
    ? hexToRgba(lighten(color, 80), 0.55)
    : `rgba(255,255,255,${isBurning ? 0.42 : 0.32 + hitIntensity * 0.25})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x + 1.75, y + 1.75, w - 3.5, h - 3.5, Math.max(0, r - 1.5));
  ctx.stroke();

  // Thin top highlight (not a big soft blotch)
  const shine = ctx.createLinearGradient(x, y, x, y + h * 0.45);
  shine.addColorStop(0, `rgba(255,255,255,${isCrystal ? 0.35 : 0.48 + hitIntensity * 0.2})`);
  shine.addColorStop(1, "rgba(255,255,255,0)");
  ctx.beginPath();
  ctx.roundRect(x + 2.5, y + 2, w - 5, Math.max(3, h * 0.32), Math.max(0, r - 2));
  ctx.fillStyle = shine;
  ctx.fill();

  if (isBurning) {
    ctx.strokeStyle = `rgba(255, 210, 100, ${0.55 + hitIntensity * 0.25})`;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.roundRect(x - 1.5, y - 1.5, w + 3, h + 3, r + 1.5);
    ctx.stroke();
  }

  // Center pip — small, hard edge
  const dotR = Math.max(1.75, Math.min(w, h) * 0.095);
  ctx.beginPath();
  ctx.arc(cx, cy, dotR + 0.75, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
  ctx.fillStyle = isCrystal ? "rgba(255,255,255,0.7)" : "#ffffff";
  ctx.fill();

  if (hitIntensity > 0) {
    const ringR = Math.max(w, h) * (0.48 + hitIntensity * 0.28);
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${0.2 + hitIntensity * 0.45})`;
    ctx.lineWidth = 1.5 + hitIntensity;
    ctx.stroke();
  }

  ctx.restore();
}

/** Strike-bar receptor — hollow frame drawn outside neutral note bounds */
function drawGemReceptor(
  ctx: CanvasRenderingContext2D,
  cxIn: number,
  cyIn: number,
  laneW: number,
  color: string,
  rowPx: number,
  hitIntensity = 0,
  lite = false
) {
  const { cx, cy } = alignGemCenter(cxIn, cyIn);
  const { w: noteW, h: noteH, r: noteR } = noteBoxSize(laneW, rowPx);
  const lineWidth = hitIntensity > 0 ? 2.25 + hitIntensity * (lite ? 0.35 : 0.5) : 2.25;
  const gap = 2.5;
  const outset = gap + lineWidth / 2;
  const frameW = noteW + outset * 2;
  const frameH = noteH + outset * 2;
  const x = cx - frameW / 2;
  const y = cy - frameH / 2;
  const r = noteR + gap;

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (hitIntensity > 0) {
    const scale = 1 + hitIntensity * (lite ? 0.18 : 0.28);
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
  }

  // Tight colored outer edge
  if (!lite) {
    ctx.shadowColor = hitIntensity > 0 ? "rgba(255,255,255,0.55)" : hexToRgba(color, 0.45);
    ctx.shadowBlur = hitIntensity > 0 ? 6 + hitIntensity * 10 : 4;
  }
  ctx.strokeStyle =
    hitIntensity > 0
      ? `rgba(255,255,255,${0.75 + hitIntensity * 0.25})`
      : hexToRgba(color, 0.95);
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.roundRect(x, y, frameW, frameH, r);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Inner dark stroke for contrast on the highway
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x + 1.25, y + 1.25, frameW - 2.5, frameH - 2.5, Math.max(0, r - 1));
  ctx.stroke();

  ctx.restore();
}

/**
 * Horizontal links between same-beat notes (chords / double-hits).
 * Draws behind gems so alignment is obvious without covering the notes.
 */
function drawSameBeatLinks(
  ctx: CanvasRenderingContext2D,
  notes: ChartNote[],
  scrollTick: number,
  ppt: number,
  sy: number,
  trackX: number,
  laneW: number,
  laneGap: number,
  rowPx: number,
  lite = false
) {
  // Group by exact tick so only true same-time hits connect.
  const byTick = new Map<number, ChartNote[]>();
  for (const note of notes) {
    const tick = beatToTick(note.Beat);
    const list = byTick.get(tick);
    if (list) list.push(note);
    else byTick.set(tick, [note]);
  }

  const halfW = noteBoxSize(laneW, rowPx).w / 2;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const [tick, group] of byTick) {
    if (group.length < 2) continue;

    const y = Math.round(sy - (tick - scrollTick) * ppt) + 0.5;
    // Only draw for notes on the visible highway (above strike bar).
    if (y < LANE_HEADER_H - 20 || y > sy + 6) continue;

    // Left → right by highway column.
    const cols = group
      .map((n) => ({
        note: n,
        col: laneColumnIndex(n.Id),
        color: laneById(n.Id).color,
      }))
      .sort((a, b) => a.col - b.col);

    // De-dupe same lane (shouldn't happen, but avoid double lines).
    const unique: typeof cols = [];
    for (const item of cols) {
      if (unique.length === 0 || unique[unique.length - 1].col !== item.col) {
        unique.push(item);
      }
    }
    if (unique.length < 2) continue;

    for (let i = 0; i < unique.length - 1; i++) {
      const left = unique[i];
      const right = unique[i + 1];
      const x0 = laneCenter(trackX, left.col, laneW, laneGap) + halfW - 1;
      const x1 = laneCenter(trackX, right.col, laneW, laneGap) - halfW + 1;
      if (x1 - x0 < 2) continue;

      // Gradient bridge between the two lane colors.
      const grad = ctx.createLinearGradient(x0, y, x1, y);
      grad.addColorStop(0, hexToRgba(left.color, lite ? 0.55 : 0.75));
      grad.addColorStop(0.5, "rgba(255,255,255,0.55)");
      grad.addColorStop(1, hexToRgba(right.color, lite ? 0.55 : 0.75));

      // Subtle under-shadow for contrast on dark highway
      if (!lite) {
        ctx.strokeStyle = "rgba(0,0,0,0.45)";
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
      }

      ctx.strokeStyle = grad;
      ctx.lineWidth = lite ? 2 : 2.25;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();

      // Tiny center pip marks exact shared beat alignment
      const midX = (x0 + x1) / 2;
      ctx.beginPath();
      ctx.arc(midX, y, lite ? 1.5 : 2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fill();
    }

    // Thin horizontal guide through the whole chord span (helps multi-lane checks).
    if (unique.length >= 3 && !lite) {
      const xLeft = laneCenter(trackX, unique[0].col, laneW, laneGap);
      const xRight = laneCenter(trackX, unique[unique.length - 1].col, laneW, laneGap);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xLeft, y);
      ctx.lineTo(xRight, y);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function highwayWaveSamples(
  peaks: WavePeak[],
  scrollTick: number,
  ppt: number,
  sy: number,
  h: number,
  chartTime: number,
  timing: TimingAnchor[],
  mode: "past" | "future"
) {
  const samples: { pos: number; amp: number }[] = [];
  for (const { tick, amp } of peaks) {
    if (amp < 0.01) continue;
    const y = sy - (tick - scrollTick) * ppt;
    if (y < LANE_HEADER_H || y > h) continue;
    const noteTime = beatToTime(tick / RESOLUTION, timing);
    const isPast = noteTime <= chartTime;
    if (mode === "past" ? !isPast : isPast) continue;
    samples.push({ pos: y, amp });
  }
  return samples;
}

function scrollTickAtClick(): number {
  const state = useEditorStore.getState();
  const { scrollTick: storeScroll, isPlaying, meta, currentTime } = state;
  if (!isPlaying) return storeScroll;

  let chartTime = currentTime;
  if (isPlaying && editorAudioPlayer.isPlaying()) {
    chartTime = getPlaybackAudioTime() + getSongOffset(meta);
  }
  return timeToBeat(chartTime, meta.SongTiming) * RESOLUTION;
}

export function ChartEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const laneWavePeaksRef = useRef<WavePeak[][]>([]);
  const phaseBlinkRef = useRef<{
    lastBeat: number | null;
    blinkPhase: SongPhase | null;
    blinkStart: number;
  }>({ lastBeat: null, blinkPhase: null, blinkStart: 0 });
  /** Editor-only — note hit times keyed by noteHitKey */
  const noteHitRef = useRef<Map<string, number>>(new Map());
  const noteSelectionRef = useRef<NoteSelectionState | null>(null);
  const selectionAutoScrollRef = useRef(0);
  const pointerGestureRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    lastY: number;
    panning: boolean;
    selecting: boolean;
  } | null>(null);
  const [, setSelectionRevision] = useState(0);
  const bumpSelectionRevision = useCallback(
    () => setSelectionRevision((revision) => revision + 1),
    []
  );
  const { isMobileShell } = useMobileLayout();
  const [mobileHintVisible, setMobileHintVisible] = useState(true);

  const {
    meta,
    difficulty,
    charts,
    selectedLane,
    snapTicks,
    scrollTick,
    pixelsPerTick,
    isPlaying,
    audioBuffer,
    audioFileName,
    drumsAudioBuffer,
    drumsAudioFileName,
    laneStems,
    audioSource,
    duration,
    waveScale,
    placementMode,
    editorTool,
    toggleNote,
    setPlacementMode,
    copyNotesInRange,
    copyNotesInSelection,
    deleteNotesInSelection,
    pasteNotesAtStrikeTick,
    clipboardMessage,
    clearClipboardMessage,
  } = useEditorStore();

  useEffect(() => {
    noteHitRef.current.clear();
  }, [difficulty]);

  // Mobile tool hint: show on tool change, auto-hide, tap to dismiss
  useEffect(() => {
    if (!isMobileShell) return;
    setMobileHintVisible(true);
    const t = window.setTimeout(() => setMobileHintVisible(false), MOBILE_TOOL_HINT_MS);
    return () => window.clearTimeout(t);
  }, [editorTool, isMobileShell]);

  useEffect(() => {
    const state = useEditorStore.getState();
    const shared = getLaneWaveformBuffer(state);
    // Coarser peaks on mobile (fewer samples to draw)
    const bin = isMobileShell ? 48 : 16;
    const build = (buffer: AudioBuffer | null): WavePeak[] =>
      buffer
        ? buildWaveformByTick(buffer, meta.SongTiming, getSongOffset(meta), bin)
        : [];
    const anyStems = state.laneStems.some((s) => s !== null);
    if (isMobileShell || !anyStems) {
      laneWavePeaksRef.current = [build(shared)];
    } else {
      // Per-lane stems: each lane renders its own audio shape.
      laneWavePeaksRef.current = state.laneStems.map((stem) => build(stem ?? shared));
    }
  }, [
    audioBuffer,
    drumsAudioBuffer,
    laneStems,
    audioSource,
    meta.SongTiming,
    meta.SongOffsetSeconds,
    isMobileShell,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let raf = 0;
    const lite = isMobileShell;

    const canvasDpr = () => {
      const raw = window.devicePixelRatio || 1;
      // Cap resolution on phones — big win for fill rate
      return lite ? Math.min(raw, 1.25) : raw;
    };

    const syncCanvasSize = () => {
      const wrap = wrapRef.current;
      if (!wrap) return { w: 0, h: 0 };
      const dpr = canvasDpr();
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const cw = Math.max(1, Math.floor(w * dpr));
      const ch = Math.max(1, Math.floor(h * dpr));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      return { w, h };
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);

      const wrap = wrapRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx || !wrap) return;

      const { w, h } = syncCanvasSize();
      if (w < 2 || h < 2) return;

      const dpr = canvasDpr();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sy = h - STRIKE_OFFSET;
      const trackX = 0;
      const trackW = w;
      const { laneW, gap: laneGap } = laneMetrics(trackW);
      const ppt = useEditorStore.getState().pixelsPerTick;
      const storeScroll = useEditorStore.getState().scrollTick;
      const timing = useEditorStore.getState().meta.SongTiming;

      const state = useEditorStore.getState();
      const playing = state.isPlaying;
      const offset = getSongOffset(state.meta);
      // Smooth scroll: sample audio every rAF frame, not timeupdate (~4 Hz)
      // Prefer the live Web Audio clock while the buffer source is running so
      // the grid never lags the song by a frame (or freezes when muted briefly).
      let chartTime = state.currentTime;
      if (playing && editorAudioPlayer.isPlaying()) {
        chartTime = getPlaybackAudioTime() + offset;
      }

      const inSilence = isInSilentLeadIn(chartTime, offset);
      const playBeat = timeToBeat(chartTime, timing);
      const playTickFloat = playBeat * RESOLUTION;
      const scrollTick = playing ? playTickFloat : storeScroll;
      const gridRowPx = visualGridRowPixels(ppt);

      const phases = sortSongPhases(useEditorStore.getState().meta.SongPhases);
      const now = performance.now();
      const notes = useEditorStore.getState().charts[useEditorStore.getState().difficulty];

      if (playing) {
        const prevBeat = phaseBlinkRef.current.lastBeat;
        if (prevBeat !== null) {
          const crossed = findCrossedPhase(prevBeat, playBeat, phases);
          if (crossed) {
            phaseBlinkRef.current.blinkPhase = crossed;
            phaseBlinkRef.current.blinkStart = now;
          }
          const hitVol = useEditorStore.getState().hitVolume;
          for (const note of findCrossedNotes(prevBeat, playBeat, notes)) {
            noteHitRef.current.set(noteHitKey(note), now);
            playDrumHit(note.Id, note.Strength, hitVol);
          }
        }
        phaseBlinkRef.current.lastBeat = playBeat;
      } else {
        phaseBlinkRef.current.lastBeat = playBeat;
        noteHitRef.current.clear();
      }

      const hitMaxMs = lite ? NOTE_HIT_MS_MOBILE : NOTE_HIT_MS;
      for (const [key, start] of noteHitRef.current) {
        if (now - start >= hitMaxMs) noteHitRef.current.delete(key);
      }

      const laneHitIntensity = new Map<DrumId, number>();
      const laneHitProgress = new Map<DrumId, number>();
      for (const [key, start] of noteHitRef.current) {
        const elapsed = now - start;
        const intensity = noteHitIntensity(elapsed, lite);
        if (intensity <= 0) continue;
        const id = Number(key.split(":")[1]) as DrumId;
        laneHitIntensity.set(id, Math.max(laneHitIntensity.get(id) ?? 0, intensity));
        const p = Math.min(1, elapsed / hitMaxMs);
        laneHitProgress.set(id, Math.max(laneHitProgress.get(id) ?? 0, p));
      }

      const blinkPhase = phaseBlinkRef.current.blinkPhase;
      const blinkElapsed = blinkPhase ? now - phaseBlinkRef.current.blinkStart : 0;
      const isPhaseBlink =
        blinkPhase !== null && blinkElapsed >= 0 && blinkElapsed < PHASE_BLINK_MS;
      if (!isPhaseBlink) phaseBlinkRef.current.blinkPhase = null;

      const blinkEnvelope = isPhaseBlink ? 1 - blinkElapsed / PHASE_BLINK_MS : 0;
      const blinkPulse = isPhaseBlink
        ? 0.5 + 0.5 * Math.abs(Math.sin(blinkElapsed * 0.028))
        : 0;
      const blinkStrength = isPhaseBlink
        ? blinkEnvelope * blinkPulse * (0.25 + blinkPhase!.power * 0.75)
        : 0;
      const blinkColor = isPhaseBlink ? phaseById(blinkPhase!.phase).color : null;

      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = T.void;
      ctx.fillRect(0, 0, w, h);

      // Highway border
      ctx.strokeStyle = `rgba(${T.neonRgb}, 0.22)`;
      ctx.lineWidth = 1;
      ctx.strokeRect(trackX - 0.5, 0, trackW + 1, h);

      const scale = useEditorStore.getState().waveScale;

      // Waveforms: full per-lane on desktop; single center mono strip on mobile.
      // With stems loaded, each lane draws its own peaks (index = column).
      const lanePeaksList = laneWavePeaksRef.current;
      const hasAnyPeaks = lanePeaksList.some((p) => p.length > 0);
      if (duration > 0) {
        if (lite) {
          const lanePeaks = lanePeaksList[0] ?? [];
          if (lanePeaks.length > 0) {
            const cx = trackX + trackW / 2;
            const half = Math.min(trackW * 0.22, 48) * scale;
            ctx.save();
            ctx.beginPath();
            ctx.rect(trackX, LANE_HEADER_H, trackW, sy - LANE_HEADER_H);
            ctx.clip();
            const style = { tintColor: `rgb(${T.neonRgb})`, intensity: 0.55 };
            drawLaneWaveStroke(
              ctx,
              highwayWaveSamples(lanePeaks, scrollTick, ppt, sy, h, chartTime, timing, "future"),
              cx,
              half,
              "future",
              style
            );
            drawLaneWaveStroke(
              ctx,
              highwayWaveSamples(lanePeaks, scrollTick, ppt, sy, h, chartTime, timing, "past"),
              cx,
              half,
              "past",
              style
            );
            ctx.restore();
          }
        } else {
          DRUM_LANES.forEach((lane, col) => {
            const lanePeaks = lanePeaksList[col] ?? lanePeaksList[0] ?? [];
            if (lanePeaks.length === 0) return;

            const lx = laneLeft(trackX, col, laneW, laneGap);
            const cx = laneCenter(trackX, col, laneW, laneGap);
            const laneHalf = laneW * 0.4 * scale;
            const laneStyle = { tintColor: lane.color, intensity: 0.8 };

            ctx.save();
            ctx.beginPath();
            ctx.rect(lx, LANE_HEADER_H, laneW, sy - LANE_HEADER_H);
            ctx.clip();

            drawLaneWaveStroke(
              ctx,
              highwayWaveSamples(lanePeaks, scrollTick, ppt, sy, h, chartTime, timing, "future"),
              cx,
              laneHalf,
              "future",
              laneStyle
            );
            drawLaneWaveStroke(
              ctx,
              highwayWaveSamples(lanePeaks, scrollTick, ppt, sy, h, chartTime, timing, "past"),
              cx,
              laneHalf,
              "past",
              laneStyle
            );
            ctx.restore();
          });
        }
      }
      if (!hasAnyPeaks && !audioBuffer && !drumsAudioBuffer) {
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.font = "13px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
          lite ? "Load audio to chart" : "Load audio to see lane waveforms",
          trackX + trackW / 2,
          sy - 60
        );
      }

      // Mask chart below strike bar — past notes/audio shouldn't slide under the receptors
      ctx.fillStyle = T.void;
      ctx.fillRect(trackX, sy + 1, trackW, h - sy);

      // Strike-zone glow (desktop only — gradients are expensive on phones)
      if (!lite) {
        const floorGlow = ctx.createLinearGradient(0, sy - 80, 0, h);
        floorGlow.addColorStop(0, `rgba(${T.neonRgb}, 0)`);
        floorGlow.addColorStop(0.65, `rgba(${T.magentaRgb}, 0.05)`);
        floorGlow.addColorStop(1, `rgba(${T.neonRgb}, 0.1)`);
        ctx.fillStyle = floorGlow;
        ctx.fillRect(trackX, sy - 80, trackW, h - sy + 80);
      } else {
        ctx.fillStyle = `rgba(${T.neonRgb}, 0.06)`;
        ctx.fillRect(trackX, sy - 12, trackW, 24);
      }

      // Song start line (beat 0)
      const startY = sy - (0 - scrollTick) * ppt;
      if (startY > 44 && startY < h) {
        ctx.save();
        ctx.strokeStyle = `rgba(${T.strikeRgb}, 0.75)`;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(trackX, startY);
        ctx.lineTo(trackX + trackW, startY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = `rgba(${T.strikeRgb}, 0.9)`;
        ctx.font = "bold 10px Inter, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("▶ SONG START", 6, startY - 5);
        ctx.restore();
      }

      // Silent lead-in region (offset)
      if (offset > 0) {
        const offsetTick = beatToTick(timeToBeat(offset, timing));
        const offsetY = sy - (offsetTick - scrollTick) * ppt;
        if (offsetY > 44 && offsetY < h) {
          ctx.save();
          ctx.strokeStyle = "rgba(140, 160, 200, 0.45)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 6]);
          ctx.beginPath();
          ctx.moveTo(trackX, offsetY);
          ctx.lineTo(trackX + trackW, offsetY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "rgba(140, 160, 200, 0.75)";
          ctx.font = "9px Inter, sans-serif";
          ctx.textAlign = "left";
          ctx.fillText("🔇 AUDIO START", 6, offsetY - 4);
          ctx.restore();
        }
      }

      // Song phase markers
      for (const ph of phases) {
        const phaseTick = beatToTick(ph.beat);
        const y = sy - (phaseTick - scrollTick) * ppt;
        if (y < 44 || y > sy + 2) continue;

        const type = phaseById(ph.phase);
        const atStrike = playing && Math.abs(y - sy) < 6;
        const passFlash =
          isPhaseBlink && blinkPhase === ph ? blinkStrength * 1.2 : 0;
        const alpha = 0.35 + ph.power * 0.45 + passFlash;
        ctx.save();
        if (atStrike || passFlash > 0) {
          ctx.shadowColor = type.color;
          ctx.shadowBlur = 14 + passFlash * 20;
        }
        ctx.strokeStyle = type.color + Math.round(Math.min(1, alpha) * 255).toString(16).padStart(2, "0");
        ctx.lineWidth = atStrike || passFlash > 0 ? 3 : ph.phase === 4 ? 2 : 1.5;
        ctx.setLineDash(atStrike ? [] : [6, 4]);
        ctx.beginPath();
        ctx.moveTo(trackX, y);
        ctx.lineTo(trackX + trackW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
        ctx.fillStyle = type.color;
        ctx.font = "bold 9px Inter, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(ph.phaseName, trackX + trackW - 6, y - 4);
        ctx.restore();
      }

      // Grid follows snap so 1/16 · 1/32 · 1/64 ticks are visible (not only 1/8).
      const timeSig = getTimeSignature(meta);
      const measureTicks = ticksPerMeasure(timeSig);
      const gridStep = visualGridStep(snapTicks, timeSig);
      const viewTop = scrollTick + Math.ceil((sy - LANE_HEADER_H) / ppt);
      const viewBottom = scrollTick - Math.ceil((h - sy + 80) / ppt) - RESOLUTION;
      const stripeStep = Math.max(gridStep, VISUAL_GRID_TICKS);
      const segStart = snapTick(viewBottom, stripeStep);
      const segEnd = viewTop + stripeStep;

      for (let tick = segStart; tick <= segEnd; tick += stripeStep) {
        const yTop = sy - (tick + stripeStep - scrollTick) * ppt;
        const yBottom = sy - (tick - scrollTick) * ppt;
        const rowH = yBottom - yTop;
        if (rowH < 6 || yBottom < LANE_HEADER_H - gridRowPx || yTop > h + gridRowPx || yBottom > sy + 2)
          continue;

        if (Math.floor(tick / stripeStep) % 2 !== 0) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.012)";
          ctx.fillRect(trackX, yTop, trackW, rowH);
        }
      }

      // Skip drawing if lines would be denser than ~2px (zoom-out safeguard).
      const linePx = gridStep * ppt;
      const drawFineGrid = linePx >= 2;

      for (
        let tick = snapTick(viewBottom, gridStep);
        tick <= viewTop && drawFineGrid;
        tick += gridStep
      ) {
        const y = sy - (tick - scrollTick) * ppt;
        if (y < LANE_HEADER_H - 4 || y > sy + 2) continue;

        const isMeasure = measureTicks > 0 && tick % measureTicks === 0;
        const isBeat = tick % RESOLUTION === 0;
        const isEighth = tick % VISUAL_GRID_TICKS === 0;
        const isSixteenth = tick % 120 === 0;
        const isThirtySecond = tick % 60 === 0;

        if (isMeasure) {
          ctx.strokeStyle = "rgba(255,255,255,0.28)";
          ctx.lineWidth = 2.5;
        } else if (isBeat) {
          ctx.strokeStyle = "rgba(255,255,255,0.16)";
          ctx.lineWidth = 1.5;
        } else if (isEighth) {
          ctx.strokeStyle = `rgba(${T.magentaRgb}, 0.18)`;
          ctx.lineWidth = 1;
        } else if (isSixteenth) {
          ctx.strokeStyle = `rgba(${T.magentaRgb}, 0.12)`;
          ctx.lineWidth = 1;
        } else if (isThirtySecond) {
          ctx.strokeStyle = `rgba(${T.magentaRgb}, 0.08)`;
          ctx.lineWidth = 0.75;
        } else {
          // 1/64 (or finer custom)
          ctx.strokeStyle = `rgba(${T.magentaRgb}, 0.05)`;
          ctx.lineWidth = 0.5;
        }

        ctx.beginPath();
        ctx.moveTo(trackX, y);
        ctx.lineTo(trackX + trackW, y);
        ctx.stroke();

        // Labels: always on measures/beats; on 1/8+ when zoomed enough for readability.
        const showLabel =
          isMeasure ||
          isBeat ||
          (isEighth && linePx >= 10) ||
          (isSixteenth && linePx >= 14 && !isEighth);

        if (showLabel) {
          ctx.fillStyle = isMeasure
            ? "rgba(255,255,255,0.6)"
            : isBeat
              ? "rgba(255,255,255,0.34)"
              : "rgba(255,255,255,0.22)";
          ctx.font = isMeasure
            ? "bold 10px JetBrains Mono, monospace"
            : "10px JetBrains Mono, monospace";
          ctx.textAlign = "left";
          ctx.fillText(formatTick(tick, timeSig), 6, y + 4);
        }
      }

      // Lane dividers (outer edges + lane boundaries; gaps stay open between)
      const drawLaneDivider = (x: number, strong: boolean) => {
        if (lite) {
          ctx.strokeStyle = `rgba(${T.neonRgb},${strong ? 0.2 : 0.1})`;
        } else {
          const divGrad = ctx.createLinearGradient(x, 0, x, h);
          divGrad.addColorStop(0, "rgba(255,255,255,0.03)");
          divGrad.addColorStop(0.5, `rgba(${T.neonRgb},0.14)`);
          divGrad.addColorStop(1, "rgba(255,255,255,0.03)");
          ctx.strokeStyle = divGrad;
        }
        ctx.lineWidth = strong ? 1.5 : 0.75;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      };
      drawLaneDivider(trackX, true);
      DRUM_LANES.forEach((_lane, col) => {
        const right = laneLeft(trackX, col, laneW, laneGap) + laneW;
        drawLaneDivider(right, col === DRUM_LANES.length - 1);
      });

      // Lane headers
      ctx.fillStyle = "rgba(0, 0, 0, 0.94)";
      ctx.fillRect(trackX, 0, trackW, 44);
      ctx.strokeStyle = `rgba(${T.neonRgb}, 0.18)`;
      ctx.beginPath();
      ctx.moveTo(trackX, 44);
      ctx.lineTo(trackX + trackW, 44);
      ctx.stroke();

      DRUM_LANES.forEach((lane, col) => {
        const cx = laneCenter(trackX, col, laneW, laneGap);
        const lx = laneLeft(trackX, col, laneW, laneGap);
        const active = lane.id === selectedLane;
        if (active) {
          ctx.fillStyle = hexToRgba(lane.color, 0.1);
          ctx.fillRect(lx, 0, laneW, 44);
        }
        ctx.fillStyle = active ? lighten(lane.color, 40) : lane.color;
        ctx.font = `600 ${active ? 11 : 10}px Orbitron, Rajdhani, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(lane.name, cx, 16);
        ctx.fillStyle = active ? hexToRgba(lane.color, 0.95) : hexToRgba(lane.color, 0.72);
        ctx.font = "8px JetBrains Mono, monospace";
        ctx.fillText(lane.label, cx, 28);
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.font = "9px JetBrains Mono, monospace";
        ctx.fillText(`[${lane.key}]`, cx, 38);
      });

      // Strike bar — hollow frame outside neutral note size; notes draw on top at hit
      DRUM_LANES.forEach((lane, col) => {
        const cx = laneCenter(trackX, col, laneW, laneGap);
        const color = isPhaseBlink && blinkColor ? blinkColor : lane.color;
        const receptorHit = laneHitIntensity.get(lane.id) ?? 0;
        drawGemReceptor(ctx, cx, sy, laneW, color, gridRowPx, receptorHit, lite);
      });

      // Same-beat chord links — behind gems so multi-lane hits read as aligned pairs.
      drawSameBeatLinks(
        ctx,
        notes,
        scrollTick,
        ppt,
        sy,
        trackX,
        laneW,
        laneGap,
        gridRowPx,
        lite
      );

      // Notes (gems) — only above strike bar so scrolling feels like a highway, not a sliding sheet
      for (const note of notes) {
        const tick = beatToTick(note.Beat);
        const y = sy - (tick - scrollTick) * ppt;
        const hitStart = noteHitRef.current.get(noteHitKey(note));
        const hit =
          hitStart !== undefined ? noteHitIntensity(now - hitStart, lite) : 0;

        // Struck notes pin into the receptor on the strike line and squash like
        // they physically hit the bar — the "on centre / on beat" confirmation.
        let drawY = y;
        let squash = 0;
        let hitFade = 1;
        if (hitStart !== undefined) {
          const p = Math.min(1, (now - hitStart) / hitMaxMs);
          squash = (1 - p) * (1 - p);
          hitFade = 1 - Math.pow(p, 1.5);
          drawY = sy;
        } else if (y < LANE_HEADER_H - 20 || y > sy + 6) {
          continue;
        }

        const rowsAway = Math.max(0, (sy - y) / Math.max(gridRowPx, 1));
        const approach =
          rowsAway < 0.2 ? 1 : Math.min(1, 0.86 + (rowsAway - 0.2) * 0.045);

        const lane = laneById(note.Id);
        const col = laneColumnIndex(note.Id);
        const cx = laneCenter(trackX, col, laneW, laneGap);

        ctx.save();
        if (hitStart !== undefined) {
          ctx.globalAlpha *= hitFade;
          ctx.translate(cx, sy);
          ctx.scale(1 + squash * 0.38, 1 - squash * 0.48);
          ctx.translate(-cx, -sy);
        } else if (!lite && approach < 0.98) {
          ctx.globalAlpha *= approach;
          ctx.translate(cx, y);
          ctx.scale(approach, approach);
          ctx.translate(-cx, -y);
        }
        drawGemNote(ctx, cx, drawY, laneW, lane.color, note.Strength, gridRowPx, hit, lite);
        ctx.restore();
      }

      // Playhead — locked to strike bar center
      ctx.save();
      ctx.shadowColor = inSilence ? T.silence : T.magenta;
      ctx.shadowBlur = 18;
      ctx.strokeStyle = inSilence
        ? "rgba(148,163,184,0.85)"
        : `rgba(${T.neonRgb},0.95)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(trackX, sy);
      ctx.lineTo(trackX + trackW, sy);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();

      // On-beat confirmation: the strike line itself lights up across the lane
      // that just crossed a note — reads as "hit centre, on the line".
      for (const lane of DRUM_LANES) {
        const p = laneHitProgress.get(lane.id);
        if (p === undefined) continue;
        const a = (1 - p) * (1 - p);
        const lx = laneLeft(trackX, laneColumnIndex(lane.id), laneW, laneGap);
        ctx.fillStyle = hexToRgba(lane.color, 0.5 * a);
        ctx.fillRect(lx + 2, sy - 3, laneW - 4, 6);
        ctx.fillStyle = `rgba(255,255,255,${0.55 * a})`;
        ctx.fillRect(lx + 2, sy - 0.75, laneW - 4, 1.5);
      }

      // Phase blink overlay (highway flash when strike bar crosses a phase)
      if (isPhaseBlink && blinkColor) {
        ctx.save();
        if (lite) {
          ctx.fillStyle = hexToRgba(blinkColor, blinkStrength * 0.18);
          ctx.fillRect(trackX, sy - 16, trackW, 32);
        } else {
          ctx.fillStyle = hexToRgba(blinkColor, blinkStrength * 0.28);
          ctx.fillRect(trackX, 44, trackW, h - 44);
          const strikeGlow = ctx.createLinearGradient(0, sy - 48, 0, sy + 48);
          strikeGlow.addColorStop(0, hexToRgba(blinkColor, 0));
          strikeGlow.addColorStop(0.45, hexToRgba(blinkColor, blinkStrength * 0.35));
          strikeGlow.addColorStop(0.5, hexToRgba(blinkColor, blinkStrength * 0.55));
          strikeGlow.addColorStop(0.55, hexToRgba(blinkColor, blinkStrength * 0.35));
          strikeGlow.addColorStop(1, hexToRgba(blinkColor, 0));
          ctx.fillStyle = strikeGlow;
          ctx.fillRect(trackX, sy - 48, trackW, 96);
        }
        ctx.restore();
      }

      // Audio / waveform labels
      const waveLabel =
        state.audioSource === "drums" && state.drumsAudioFileName
          ? `Audio: drums · ${state.drumsAudioFileName}`
          : state.audioFileName
            ? `Audio: song · ${state.audioFileName}`
            : state.drumsAudioFileName
              ? `Audio: drums · ${state.drumsAudioFileName}`
              : null;
      if (waveLabel) {
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.font = "10px Inter, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`♪ ${waveLabel}`, trackX + 8, h - 10);
      }

      const selection = noteSelectionRef.current;
      if (selection) {
        drawNoteSelectionBox(ctx, selection, scrollTick, w, h, ppt);
      }

    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [
    meta.SongTiming,
    meta.SongPhases,
    meta.SongOffsetSeconds,
    meta.TimeSignature,
    difficulty,
    charts,
    selectedLane,
    snapTicks,
    scrollTick,
    pixelsPerTick,
    isPlaying,
    audioBuffer,
    audioFileName,
    drumsAudioBuffer,
    drumsAudioFileName,
    audioSource,
    duration,
    waveScale,
    placementMode,
    isMobileShell,
  ]);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { scrollTick: st, pixelsPerTick: ppt, isPlaying, setPixelsPerTick } =
        useEditorStore.getState();
      if (e.ctrlKey) {
        setPixelsPerTick(ppt + (e.deltaY < 0 ? 0.01 : -0.01));
      } else if (!isPlaying) {
        seekScrollTick(st - e.deltaY / ppt);
      }
    };
    const el = wrapRef.current;
    el?.addEventListener("wheel", onWheel, { passive: false });
    return () => el?.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!clipboardMessage) return;
    const timer = window.setTimeout(() => clearClipboardMessage(), 2200);
    return () => window.clearTimeout(timer);
  }, [clipboardMessage, clearClipboardMessage]);

  useEffect(() => {
    const stopSelectionDrag = () => {
      if (selectionAutoScrollRef.current) {
        cancelAnimationFrame(selectionAutoScrollRef.current);
        selectionAutoScrollRef.current = 0;
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod && e.key.toLowerCase() === "c") {
        const selection = noteSelectionRef.current;
        if (!selection || selection.dragging) return;
        const state = useEditorStore.getState();
        if (state.isPlaying || state.placementMode) return;
        e.preventDefault();
        void copyNotesInSelection(
          selection.anchorTick,
          selection.currentTick,
          selection.anchorCol,
          selection.currentCol
        );
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        const state = useEditorStore.getState();
        if (state.placementMode) return;
        e.preventDefault();
        const wrap = wrapRef.current;
        const h = wrap?.clientHeight ?? 600;
        const { minTick, maxTick } = viewportTickRange(
          state.scrollTick,
          state.pixelsPerTick,
          h
        );
        void copyNotesInRange(minTick, maxTick);
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        const state = useEditorStore.getState();
        if (state.placementMode || state.isPlaying) return;
        e.preventDefault();
        const strikeTick = snapTick(scrollTickAtClick(), state.snapTicks);
        void pasteNotesAtStrikeTick(strikeTick);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const selection = noteSelectionRef.current;
        if (!selection || selection.dragging) return;
        const state = useEditorStore.getState();
        if (state.isPlaying || state.placementMode) return;
        e.preventDefault();
        const deleted = deleteNotesInSelection(
          selection.anchorTick,
          selection.currentTick,
          selection.anchorCol,
          selection.currentCol
        );
        if (deleted > 0) {
          noteSelectionRef.current = null;
          bumpSelectionRevision();
        }
        return;
      }
      if (e.key === "Escape") {
        setPlacementMode(null);
        noteSelectionRef.current = null;
        stopSelectionDrag();
        bumpSelectionRevision();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const state = useEditorStore.getState();
        if (state.isPlaying) return;
        e.preventDefault();
        const { scrollTick: st, snapTicks: snap } = state;
        const delta = e.key === "ArrowRight" ? snap : -snap;
        seekScrollTick(snapTick(st + delta, snap));
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const state = useEditorStore.getState();
        if (state.isPlaying) return;
        e.preventDefault();
        const { scrollTick: st, snapTicks: snap } = state;
        const delta = e.key === "ArrowUp" ? snap : -snap;
        seekScrollTick(snapTick(st + delta, snap));
        return;
      }
      if (e.key >= "1" && e.key <= "6") {
        const state = useEditorStore.getState();
        if (state.placementMode) return;
        e.preventDefault();
        const lane = laneIdFromColumn(Number(e.key) - 1);
        const strikeTick = snapTick(scrollTickAtClick(), state.snapTicks);
        if (strikeTick < 0) return;
        toggleNote(strikeTick / RESOLUTION, lane);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stopSelectionDrag();
    };
  }, [
    setPlacementMode,
    toggleNote,
    copyNotesInRange,
    copyNotesInSelection,
    deleteNotesInSelection,
    pasteNotesAtStrikeTick,
    bumpSelectionRevision,
  ]);

  const applySeekAt = useCallback(
    (rawTick: number) => {
      const state = useEditorStore.getState();
      const seekChart = beatToTime(rawTick / RESOLUTION, state.meta.SongTiming);
      const maxChart =
        state.duration > 0
          ? state.duration + getSongOffset(state.meta)
          : seekChart;
      seekChartTime(Math.max(0, Math.min(seekChart, maxChart)));
    },
    []
  );

  /** Place/remove notes for mobile edit tool and desktop Caps Lock mode. */
  const applyEditAt = useCallback(
    (x: number, y: number, canvasW: number, canvasH: number, mobile: boolean) => {
      const state = useEditorStore.getState();
      const activeScroll = scrollTickAtClick();
      const sy = canvasH - STRIKE_OFFSET;
      const rawTick = activeScroll + (sy - y) / state.pixelsPerTick;
      if (rawTick < 0) return;

      const col = columnAtX(x, 0, canvasW);
      if (col === null) return;
      const lane = laneIdFromColumn(col);
      const gridRowPx = visualGridRowPixels(state.pixelsPerTick);
      const hitPad = mobile ? NOTE_HIT_PAD_MOBILE : NOTE_HIT_PAD_DESKTOP;

      // Mobile: tap a colored receptor on the strike bar → place that lane at strike.
      if (mobile && isStrikeBarTap(y, canvasH)) {
        const strikeTick = snapTick(activeScroll, state.snapTicks);
        if (strikeTick < 0) return;
        state.setSelectedLane(lane);
        state.toggleNote(strikeTick / RESOLUTION, lane);
        return;
      }

      const hit = findNoteAtPoint(
        x,
        y,
        canvasH,
        canvasW,
        activeScroll,
        state.pixelsPerTick,
        gridRowPx,
        state.charts[state.difficulty],
        hitPad
      );
      if (hit) {
        state.removeNote(hit.Beat, hit.Id);
        return;
      }

      const tick = snapTick(rawTick, state.snapTicks);
      if (tick < 0) return;
      const strikeTick = snapTick(activeScroll, state.snapTicks);
      if (tick < strikeTick) return;
      state.setSelectedLane(lane);
      state.toggleNote(tick / RESOLUTION, lane);
    },
    []
  );

  useEffect(() => {
    const tickSelectionAutoScroll = () => {
      const selection = noteSelectionRef.current;
      const canvas = canvasRef.current;
      if (!selection?.dragging || !canvas) {
        selectionAutoScrollRef.current = 0;
        return;
      }

      const state = useEditorStore.getState();
      if (state.isPlaying) {
        selectionAutoScrollRef.current = 0;
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const h = rect.height;
      const sy = h - STRIKE_OFFSET;
      const topEdge = LANE_HEADER_H + SELECTION_SCROLL_EDGE;
      const bottomEdge = sy - SELECTION_SCROLL_EDGE;
      let delta = 0;

      if (selection.pointerY < topEdge) {
        delta =
          Math.min(1, (topEdge - selection.pointerY) / SELECTION_SCROLL_EDGE) *
          SELECTION_SCROLL_MAX_TICKS;
      } else if (selection.pointerY > bottomEdge) {
        delta =
          -Math.min(1, (selection.pointerY - bottomEdge) / SELECTION_SCROLL_EDGE) *
          SELECTION_SCROLL_MAX_TICKS;
      }

      if (delta !== 0) {
        const nextScroll = Math.max(0, state.scrollTick + delta);
        state.setScrollTick(nextScroll);
        const chart = pointerToChart(
          selection.pointerX,
          selection.pointerY,
          nextScroll,
          rect.width,
          h,
          state.pixelsPerTick
        );
        noteSelectionRef.current = {
          ...selection,
          currentTick: chart.tick,
          currentCol: chart.col,
        };
      }

      selectionAutoScrollRef.current = requestAnimationFrame(tickSelectionAutoScroll);
    };

    const onPointerMove = (e: PointerEvent) => {
      const gesture = pointerGestureRef.current;
      if (gesture && e.pointerId === gesture.id) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dy = y - gesture.startY;
        const dx = x - gesture.startX;

        if (gesture.selecting) {
          const selection = noteSelectionRef.current;
          if (!selection?.dragging) return;
          const state = useEditorStore.getState();
          const chart = pointerToChart(
            x,
            y,
            state.scrollTick,
            rect.width,
            rect.height,
            state.pixelsPerTick
          );
          noteSelectionRef.current = {
            ...selection,
            currentTick: chart.tick,
            currentCol: chart.col,
            pointerX: x,
            pointerY: y,
          };
          if (!selectionAutoScrollRef.current) {
            selectionAutoScrollRef.current = requestAnimationFrame(tickSelectionAutoScroll);
          }
          return;
        }

        if (!gesture.panning) {
          if (Math.hypot(dx, dy) >= POINTER_PAN_THRESHOLD) {
            gesture.panning = true;
            if (noteSelectionRef.current) {
              noteSelectionRef.current = null;
              bumpSelectionRevision();
            }
          }
        }

        if (gesture.panning) {
          const state = useEditorStore.getState();
          if (!state.isPlaying) {
            const deltaY = y - gesture.lastY;
            seekScrollTick(state.scrollTick + deltaY / state.pixelsPerTick);
          }
          gesture.lastY = y;
        }
        return;
      }

      // Desktop selection drag without pointer capture (mouse path fallback)
      const selection = noteSelectionRef.current;
      if (!selection?.dragging) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const state = useEditorStore.getState();
      const chart = pointerToChart(
        x,
        y,
        state.scrollTick,
        rect.width,
        rect.height,
        state.pixelsPerTick
      );
      noteSelectionRef.current = {
        ...selection,
        currentTick: chart.tick,
        currentCol: chart.col,
        pointerX: x,
        pointerY: y,
      };
      if (!selectionAutoScrollRef.current) {
        selectionAutoScrollRef.current = requestAnimationFrame(tickSelectionAutoScroll);
      }
    };

    const endSelectionDrag = () => {
      const selection = noteSelectionRef.current;
      if (!selection?.dragging) return;
      if (selectionAutoScrollRef.current) {
        cancelAnimationFrame(selectionAutoScrollRef.current);
        selectionAutoScrollRef.current = 0;
      }
      noteSelectionRef.current = { ...selection, dragging: false };
      bumpSelectionRevision();
    };

    const onPointerUp = (e: PointerEvent) => {
      const gesture = pointerGestureRef.current;
      if (!gesture || e.pointerId !== gesture.id) {
        if (noteSelectionRef.current?.dragging) endSelectionDrag();
        return;
      }

      const canvas = canvasRef.current;
      const wasPanning = gesture.panning;
      const wasSelecting = gesture.selecting;
      pointerGestureRef.current = null;

      try {
        canvas?.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }

      if (wasSelecting) {
        endSelectionDrag();
        return;
      }

      if (wasPanning || !canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < 0 || x > rect.width || y < LANE_HEADER_H) return;

      const state = useEditorStore.getState();
      const sy = rect.height - STRIKE_OFFSET;
      const activeScroll = scrollTickAtClick();
      const rawTick = activeScroll + (sy - y) / state.pixelsPerTick;
      if (rawTick < 0) return;

      const tick = snapTick(rawTick, state.snapTicks);
      const beat = tick / RESOLUTION;

      if (state.placementMode === "phase") {
        state.placePhaseAtBeat(beat);
        return;
      }
      if (state.placementMode === "anchor") {
        state.placeAnchorAtBeat(beat);
        return;
      }

      const mobile = isMobileShell;
      if (mobile) {
        if (state.editorTool === "seek") {
          applySeekAt(rawTick);
          return;
        }
        applyEditAt(x, y, rect.width, rect.height, true);
        return;
      }

      // Desktop: Caps Lock off = seek; on = place/delete
      if (!e.getModifierState("CapsLock")) {
        applySeekAt(rawTick);
        return;
      }
      applyEditAt(x, y, rect.width, rect.height, false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      if (selectionAutoScrollRef.current) {
        cancelAnimationFrame(selectionAutoScrollRef.current);
        selectionAutoScrollRef.current = 0;
      }
    };
  }, [applyEditAt, applySeekAt, bumpSelectionRevision, isMobileShell]);

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Desktop Shift+drag selection (also works with mouse on mobile shell if connected)
    if (e.shiftKey && !isPlaying && y >= LANE_HEADER_H) {
      const state = useEditorStore.getState();
      const chart = pointerToChart(
        x,
        y,
        state.scrollTick,
        rect.width,
        rect.height,
        state.pixelsPerTick
      );
      noteSelectionRef.current = {
        dragging: true,
        anchorTick: chart.tick,
        anchorCol: chart.col,
        currentTick: chart.tick,
        currentCol: chart.col,
        pointerX: x,
        pointerY: y,
      };
      pointerGestureRef.current = {
        id: e.pointerId,
        startX: x,
        startY: y,
        lastY: y,
        panning: false,
        selecting: true,
      };
      bumpSelectionRevision();
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    if (!e.shiftKey && noteSelectionRef.current) {
      noteSelectionRef.current = null;
      bumpSelectionRevision();
    }

    pointerGestureRef.current = {
      id: e.pointerId,
      startX: x,
      startY: y,
      lastY: y,
      panning: false,
      selecting: false,
    };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const wrapModeClass =
    placementMode === "phase"
      ? "mode-phase"
      : placementMode === "anchor"
        ? "mode-anchor"
        : isMobileShell
          ? editorTool === "seek"
            ? "mode-seek"
            : "mode-edit"
          : "";

  const hasNoteSelection =
    noteSelectionRef.current !== null && !noteSelectionRef.current.dragging;

  return (
    <div className={`chart-stage${isMobileShell ? " chart-stage--mobile" : ""}`}>
      <div className={`chart-wrap ${wrapModeClass}`} ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="chart-canvas"
          onPointerDown={handleCanvasPointerDown}
        />
        {placementMode && (
          <div className="placement-hint">
            {placementMode === "phase"
              ? "Phase placement — tap grid"
              : "Anchor placement — tap grid"}
            <span className="placement-hint-key">Esc</span>
          </div>
        )}
        {isMobileShell && !placementMode && mobileHintVisible && (
          <div
            className="placement-hint mobile-tool-hint"
            role="button"
            tabIndex={0}
            onClick={() => setMobileHintVisible(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setMobileHintVisible(false);
              }
            }}
          >
            {editorTool === "seek"
              ? "Seek — tap highway · drag to pan"
              : "Edit — tap strike color to place · tap gem to remove · drag to pan"}
          </div>
        )}
        {!placementMode && hasNoteSelection && (
          <div className="placement-hint selection-hint">
            Notes selected —
            <span className="placement-hint-key">C</span> copy
            <span className="placement-hint-key">Del</span> delete
            <span className="placement-hint-key">Esc</span> clear
          </div>
        )}
        {clipboardMessage && !placementMode && (
          <div className="placement-hint clipboard-hint">{clipboardMessage}</div>
        )}
      </div>
      <SongOverview />
    </div>
  );
}