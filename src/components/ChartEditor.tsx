import { useEffect, useRef } from "react";
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
  TICKS_PER_MEASURE,
  VISUAL_GRID_TICKS,
  beatToTick,
  formatTick,
  snapTick,
  visualGridRowPixels,
} from "../utils/resolution";
import { seekChartTime, seekScrollTick } from "../utils/audioElement";
import { playDrumHit } from "../utils/drumHits";
import { getSongOffset, isInSilentLeadIn } from "../utils/offset";
import { beatToTime, timeToBeat } from "../utils/timing";
import { drawMirroredWaveEnvelope } from "../utils/waveDraw";
import { viewportTickRange } from "../utils/noteClipboard";
import { buildWaveformByTick, type WavePeak } from "../utils/waveform";
import { getLaneWaveformBuffer } from "../utils/audioSource";
import { SongOverview } from "./SongOverview";
import { HIGHWAY_THEME as T } from "../theme/highway";

const STRIKE_OFFSET = 150;
const PHASE_BLINK_MS = 550;
const NOTE_HIT_MS = 520;
const LANE_HEADER_H = 44;
const LANE_GAP = 6;

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

/** Caps Lock + click erase — match the gem under the cursor, not just the snapped grid row. */
function findNoteAtPoint(
  x: number,
  y: number,
  canvasH: number,
  canvasW: number,
  scrollTick: number,
  ppt: number,
  gridRowPx: number,
  notes: ChartNote[]
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
    const halfH = h / 2 + 8;
    if (y < noteY - halfH || y > noteY + halfH) continue;
    const dist = Math.abs(y - noteY);
    if (dist < bestDist) {
      best = note;
      bestDist = dist;
    }
  }

  return best;
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
  const r = Math.min(255, ((n >> 16) & 255) + amt);
  const g = Math.min(255, ((n >> 8) & 255) + amt);
  const b = Math.min(255, (n & 255) + amt);
  return `rgb(${r},${g},${b})`;
}

function noteBoxSize(laneW: number, rowPx: number) {
  const pad = 4;
  const w = laneW - pad * 2;
  const maxH = Math.max(16, rowPx - pad * 2);
  const h = maxH * 0.78;
  return { w, h, r: Math.min(6, h * 0.22) };
}

/** Editor-only hit pulse — not exported to chart files */
function noteHitIntensity(elapsedMs: number): number {
  if (elapsedMs < 0 || elapsedMs >= NOTE_HIT_MS) return 0;
  const t = elapsedMs / NOTE_HIT_MS;
  const attack = elapsedMs < 55 ? 1 : 0;
  const decay = Math.pow(1 - t, 0.65);
  const pulse = 0.65 + 0.35 * Math.sin((1 - t) * Math.PI * 2.5);
  return Math.min(1, attack * 0.35 + decay * pulse);
}

function drawGemNote(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  laneW: number,
  color: string,
  strength: 0 | 1 | 2,
  rowPx: number,
  hitIntensity = 0
) {
  const { w, h, r } = noteBoxSize(laneW, rowPx);
  const x = cx - w / 2;
  const y = cy - h / 2;
  const isCrystal = strength === 0;
  const isBurning = strength === 2;
  const baseBlur = isBurning ? 36 : isCrystal ? 5 : 14;

  ctx.save();

  if (hitIntensity > 0) {
    const scale = 1 + hitIntensity * 0.62;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
  }

  if (isCrystal) {
    ctx.globalAlpha *= 0.52;
  }

  if (isBurning) {
    ctx.shadowColor = hexToRgba(lighten(color, 50), 0.85);
    ctx.shadowBlur = baseBlur + 20 + hitIntensity * 16;
    ctx.beginPath();
    ctx.roundRect(x - 4, y - 4, w + 8, h + 8, r + 3);
    ctx.fillStyle = hexToRgba(color, 0.22 + hitIntensity * 0.12);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  ctx.shadowColor = hitIntensity > 0 ? "#ffffff" : isBurning ? lighten(color, 40) : color;
  ctx.shadowBlur = baseBlur + hitIntensity * 48;

  const body = ctx.createLinearGradient(x, y, x + w, y + h);
  if (isCrystal) {
    body.addColorStop(0, hexToRgba(lighten(color, 90), 0.62));
    body.addColorStop(0.35, hexToRgba(color, 0.38));
    body.addColorStop(1, hexToRgba(color, 0.24));
  } else if (isBurning) {
    body.addColorStop(0, lighten(color, 110 + hitIntensity * 40));
    body.addColorStop(0.3, lighten(color, 35));
    body.addColorStop(0.7, color);
    body.addColorStop(1, hexToRgba(color, 0.92));
  } else {
    body.addColorStop(0, lighten(color, 80 + hitIntensity * 40));
    body.addColorStop(0.35, color);
    body.addColorStop(1, color + "cc");
  }

  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = body;
  ctx.fill();

  ctx.shadowBlur = 0;
  const shine = ctx.createLinearGradient(x, y, x, y + h * 0.6);
  const shineAlpha = isCrystal ? 0.28 : 0.55 + hitIntensity * 0.35;
  shine.addColorStop(0, `rgba(255,255,255,${shineAlpha + hitIntensity * 0.2})`);
  shine.addColorStop(1, "rgba(255,255,255,0)");
  ctx.beginPath();
  ctx.roundRect(x + 3, y + 2, w - 6, h * 0.45, r - 2);
  ctx.fillStyle = shine;
  ctx.fill();

  if (isCrystal) {
    ctx.strokeStyle = hexToRgba(lighten(color, 60), 0.7);
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.stroke();
  }

  if (isBurning || hitIntensity > 0.35) {
    ctx.shadowColor = isBurning ? "rgba(255, 150, 40, 0.95)" : color;
    ctx.shadowBlur = isBurning ? 14 + hitIntensity * 28 : 0;
    ctx.strokeStyle =
      hitIntensity > 0.35
        ? `rgba(255,255,255,${0.35 + hitIntensity * 0.45})`
        : isBurning
          ? `rgba(255, 200, 90, ${0.82 + hitIntensity * 0.12})`
          : "rgba(255,180,60,0.6)";
    ctx.lineWidth = isBurning ? 2.25 : 1 + hitIntensity;
    ctx.beginPath();
    ctx.roundRect(x - 1, y - 1, w + 2, h + 2, r + 1);
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (isBurning) {
      ctx.strokeStyle = hexToRgba(color, 0.3);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x - 4, y - 4, w + 8, h + 8, r + 3);
      ctx.stroke();
    }
  }

  const dotR = Math.max(2.5, Math.min(w, h) * 0.13);
  ctx.beginPath();
  ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
  ctx.fillStyle = isCrystal ? "rgba(255,255,255,0.55)" : "#ffffff";
  ctx.fill();

  if (hitIntensity > 0) {
    const ringR = Math.max(w, h) * (0.55 + hitIntensity * 0.45);
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${0.25 + hitIntensity * 0.55})`;
    ctx.lineWidth = 2 + hitIntensity * 3;
    ctx.stroke();

    ctx.fillStyle = `rgba(255,255,255,${hitIntensity * 0.35})`;
    ctx.beginPath();
    ctx.roundRect(x - 4, y - 4, w + 8, h + 8, r + 4);
    ctx.fill();
  }

  ctx.restore();
}

/** Strike-bar receptor — hollow frame drawn outside neutral note bounds */
function drawGemReceptor(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  laneW: number,
  color: string,
  rowPx: number,
  hitIntensity = 0
) {
  const { w: noteW, h: noteH, r: noteR } = noteBoxSize(laneW, rowPx);
  const lineWidth = hitIntensity > 0 ? 3.5 + hitIntensity * 0.75 : 3.5;
  const gap = 2;
  const outset = gap + lineWidth / 2;
  const frameW = noteW + outset * 2;
  const frameH = noteH + outset * 2;
  const x = cx - frameW / 2;
  const y = cy - frameH / 2;
  const r = noteR + gap;

  ctx.save();

  if (hitIntensity > 0) {
    const scale = 1 + hitIntensity * 0.5;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
  }

  ctx.shadowColor = hitIntensity > 0 ? "#ffffff" : color;
  ctx.shadowBlur = hitIntensity > 0 ? 18 + hitIntensity * 42 : 10;
  ctx.strokeStyle =
    hitIntensity > 0
      ? `rgba(255,255,255,${0.7 + hitIntensity * 0.3})`
      : hexToRgba(color, 0.9);
  ctx.lineWidth = lineWidth;

  ctx.beginPath();
  ctx.roundRect(x, y, frameW, frameH, r);
  ctx.stroke();

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

  const audio = document.getElementById("editor-audio") as HTMLAudioElement | null;
  let chartTime = currentTime;
  if (audio && !audio.muted) {
    chartTime = audio.currentTime + getSongOffset(meta);
  }
  return timeToBeat(chartTime, meta.SongTiming) * RESOLUTION;
}

export function ChartEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const laneWavePeaksRef = useRef<WavePeak[]>([]);
  const phaseBlinkRef = useRef<{
    lastBeat: number | null;
    blinkPhase: SongPhase | null;
    blinkStart: number;
  }>({ lastBeat: null, blinkPhase: null, blinkStart: 0 });
  /** Editor-only — note hit times keyed by noteHitKey */
  const noteHitRef = useRef<Map<string, number>>(new Map());

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
    audioSource,
    duration,
    waveScale,
    placementMode,
    toggleNote,
    removeNote,
    setPlacementMode,
    placePhaseAtBeat,
    placeAnchorAtBeat,
    copyNotesInRange,
    pasteNotesAtBeat,
    clipboardMessage,
    clearClipboardMessage,
  } = useEditorStore();

  useEffect(() => {
    noteHitRef.current.clear();
  }, [difficulty]);

  useEffect(() => {
    const state = useEditorStore.getState();
    const laneBuffer = getLaneWaveformBuffer(state);
    if (laneBuffer) {
      laneWavePeaksRef.current = buildWaveformByTick(
        laneBuffer,
        meta.SongTiming,
        getSongOffset(meta),
        16
      );
    } else {
      laneWavePeaksRef.current = [];
    }
  }, [
    audioBuffer,
    drumsAudioBuffer,
    audioSource,
    meta.SongTiming,
    meta.SongOffsetSeconds,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let raf = 0;

    const syncCanvasSize = () => {
      const wrap = wrapRef.current;
      if (!wrap) return { w: 0, h: 0 };
      const dpr = window.devicePixelRatio || 1;
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

      const dpr = window.devicePixelRatio || 1;
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
      const audio = document.getElementById("editor-audio") as HTMLAudioElement | null;

      // Smooth scroll: sample audio every rAF frame, not timeupdate (~4 Hz)
      let chartTime = state.currentTime;
      if (playing && audio && !audio.muted) {
        chartTime = audio.currentTime + offset;
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

      for (const [key, start] of noteHitRef.current) {
        if (now - start >= NOTE_HIT_MS) noteHitRef.current.delete(key);
      }

      const laneHitIntensity = new Map<DrumId, number>();
      for (const [key, start] of noteHitRef.current) {
        const intensity = noteHitIntensity(now - start);
        if (intensity <= 0) continue;
        const id = Number(key.split(":")[1]) as DrumId;
        laneHitIntensity.set(id, Math.max(laneHitIntensity.get(id) ?? 0, intensity));
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

      const lanePeaks = laneWavePeaksRef.current;
      const scale = useEditorStore.getState().waveScale;
      const waveState = useEditorStore.getState();

      // Per-lane drum waveforms — tinted strips down each highway column
      if (lanePeaks.length > 0 && duration > 0) {
        DRUM_LANES.forEach((lane, col) => {
          const lx = laneLeft(trackX, col, laneW, laneGap);
          const cx = laneCenter(trackX, col, laneW, laneGap);
          const laneHalf = laneW * 0.4 * scale;
          const laneStyle = { tintColor: lane.color, intensity: 0.58 };

          ctx.save();
          ctx.beginPath();
          ctx.rect(lx, LANE_HEADER_H, laneW, sy - LANE_HEADER_H);
          ctx.clip();

          drawMirroredWaveEnvelope(
            ctx,
            highwayWaveSamples(lanePeaks, scrollTick, ppt, sy, h, chartTime, timing, "future"),
            cx,
            laneHalf,
            "future",
            laneStyle
          );
          drawMirroredWaveEnvelope(
            ctx,
            highwayWaveSamples(lanePeaks, scrollTick, ppt, sy, h, chartTime, timing, "past"),
            cx,
            laneHalf,
            "past",
            laneStyle
          );
          ctx.restore();
        });
      } else if (!audioBuffer && !drumsAudioBuffer) {
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.font = "13px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Load audio to see lane waveforms", trackX + trackW / 2, sy - 60);
      }

      // Mask chart below strike bar — past notes/audio shouldn't slide under the receptors
      ctx.fillStyle = T.void;
      ctx.fillRect(trackX, sy + 1, trackW, h - sy);

      // Strike-zone glow
      const floorGlow = ctx.createLinearGradient(0, sy - 80, 0, h);
      floorGlow.addColorStop(0, `rgba(${T.neonRgb}, 0)`);
      floorGlow.addColorStop(0.65, `rgba(${T.magentaRgb}, 0.05)`);
      floorGlow.addColorStop(1, `rgba(${T.neonRgb}, 0.1)`);
      ctx.fillStyle = floorGlow;
      ctx.fillRect(trackX, sy - 80, trackW, h - sy + 80);

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

      // 1/8 visual grid — snap only affects note placement
      const gridStep = VISUAL_GRID_TICKS;
      const viewTop = scrollTick + Math.ceil((sy - LANE_HEADER_H) / ppt);
      const viewBottom = scrollTick - Math.ceil((h - sy + 80) / ppt) - RESOLUTION;
      const segStart = snapTick(viewBottom, VISUAL_GRID_TICKS);
      const segEnd = viewTop + VISUAL_GRID_TICKS;

      for (let tick = segStart; tick <= segEnd; tick += VISUAL_GRID_TICKS) {
        const yTop = sy - (tick + VISUAL_GRID_TICKS - scrollTick) * ppt;
        const yBottom = sy - (tick - scrollTick) * ppt;
        const rowH = yBottom - yTop;
        if (rowH < 6 || yBottom < LANE_HEADER_H - gridRowPx || yTop > h + gridRowPx || yBottom > sy + 2)
          continue;

        if (Math.floor(tick / VISUAL_GRID_TICKS) % 2 !== 0) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.012)";
          ctx.fillRect(trackX, yTop, trackW, rowH);
        }
      }

      for (let tick = snapTick(viewBottom, gridStep); tick <= viewTop; tick += gridStep) {
        const y = sy - (tick - scrollTick) * ppt;
        if (y < LANE_HEADER_H - 4 || y > sy + 2) continue;

        const isMeasure = tick % TICKS_PER_MEASURE === 0;
        const isBeat = tick % RESOLUTION === 0;

        if (isMeasure) {
          ctx.strokeStyle = "rgba(255,255,255,0.28)";
          ctx.lineWidth = 2.5;
        } else if (isBeat) {
          ctx.strokeStyle = "rgba(255,255,255,0.16)";
          ctx.lineWidth = 1.5;
        } else {
          ctx.strokeStyle = `rgba(${T.magentaRgb}, 0.16)`;
          ctx.lineWidth = 1;
        }

        ctx.beginPath();
        ctx.moveTo(trackX, y);
        ctx.lineTo(trackX + trackW, y);
        ctx.stroke();

        if (isBeat) {
          ctx.fillStyle = isMeasure ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.34)";
          ctx.font = isMeasure ? "bold 10px JetBrains Mono, monospace" : "10px JetBrains Mono, monospace";
          ctx.textAlign = "left";
          ctx.fillText(formatTick(tick), 6, y + 4);
        }
      }

      // Lane dividers (outer edges + lane boundaries; gaps stay open between)
      const drawLaneDivider = (x: number, strong: boolean) => {
        const divGrad = ctx.createLinearGradient(x, 0, x, h);
        divGrad.addColorStop(0, "rgba(255,255,255,0.03)");
        divGrad.addColorStop(0.5, `rgba(${T.neonRgb},0.14)`);
        divGrad.addColorStop(1, "rgba(255,255,255,0.03)");
        ctx.strokeStyle = divGrad;
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
        drawGemReceptor(ctx, cx, sy, laneW, color, gridRowPx, receptorHit);
      });

      // Notes (gems) — only above strike bar so scrolling feels like a highway, not a sliding sheet
      for (const note of notes) {
        const tick = beatToTick(note.Beat);
        const y = sy - (tick - scrollTick) * ppt;
        if (y < LANE_HEADER_H - 20 || y > sy + 6) continue;

        const rowsAway = Math.max(0, (sy - y) / Math.max(gridRowPx, 1));
        const approach =
          rowsAway < 0.2 ? 1 : Math.min(1, 0.86 + (rowsAway - 0.2) * 0.045);

        const lane = laneById(note.Id);
        const col = laneColumnIndex(note.Id);
        const cx = laneCenter(trackX, col, laneW, laneGap);
        const hitStart = noteHitRef.current.get(noteHitKey(note));
        const hit = hitStart !== undefined ? noteHitIntensity(now - hitStart) : 0;

        ctx.save();
        if (approach < 0.98) {
          ctx.globalAlpha *= approach;
          ctx.translate(cx, y);
          ctx.scale(approach, approach);
          ctx.translate(-cx, -y);
        }
        drawGemNote(ctx, cx, y, laneW, lane.color, note.Strength, gridRowPx, hit);
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

      // Phase blink overlay (highway flash when strike bar crosses a phase)
      if (isPhaseBlink && blinkColor) {
        ctx.save();
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
        ctx.restore();
      }

      // Audio / waveform labels
      const waveLabel =
        waveState.audioSource === "drums" && waveState.drumsAudioFileName
          ? `Audio: drums · ${waveState.drumsAudioFileName}`
          : waveState.audioFileName
            ? `Audio: song · ${waveState.audioFileName}`
            : waveState.drumsAudioFileName
              ? `Audio: drums · ${waveState.drumsAudioFileName}`
              : null;
      if (waveLabel) {
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.font = "10px Inter, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`♪ ${waveLabel}`, trackX + 8, h - 10);
      }

    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [
    meta.SongTiming,
    meta.SongPhases,
    meta.SongOffsetSeconds,
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
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const mod = e.ctrlKey || e.metaKey;
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
        void pasteNotesAtBeat(strikeTick / RESOLUTION);
        return;
      }
      if (e.key === "Escape") {
        setPlacementMode(null);
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
        const { scrollTick: st, snapTicks: snap, setScrollTick } = state;
        const delta = e.key === "ArrowUp" ? snap : -snap;
        setScrollTick(snapTick(st + delta, snap));
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
    return () => window.removeEventListener("keydown", onKey);
  }, [setPlacementMode, toggleNote, copyNotesInRange, pasteNotesAtBeat]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < 0 || x > rect.width || y < LANE_HEADER_H) return;

    const sy = rect.height - STRIKE_OFFSET;
    const activeScroll = scrollTickAtClick();
    const rawTick = activeScroll + (sy - y) / pixelsPerTick;
    if (rawTick < 0) return;

    const tick = snapTick(rawTick, snapTicks);
    const beat = tick / RESOLUTION;

    if (placementMode === "phase") {
      placePhaseAtBeat(beat);
      return;
    }
    if (placementMode === "anchor") {
      placeAnchorAtBeat(beat);
      return;
    }

    if (!e.getModifierState("CapsLock")) {
      const seekChart = beatToTime(rawTick / RESOLUTION, meta.SongTiming);
      const maxChart = duration > 0 ? duration + getSongOffset(meta) : seekChart;
      seekChartTime(Math.max(0, Math.min(seekChart, maxChart)));
      return;
    }

    const col = columnAtX(x, 0, rect.width);
    if (col === null) return;
    const lane = laneIdFromColumn(col);
    if (tick < 0) return;

    const gridRowPx = visualGridRowPixels(pixelsPerTick);
    const hit = findNoteAtPoint(
      x,
      y,
      rect.height,
      rect.width,
      activeScroll,
      pixelsPerTick,
      gridRowPx,
      charts[difficulty]
    );
    if (hit) {
      removeNote(hit.Beat, hit.Id);
      return;
    }

    toggleNote(beat, lane);
  };

  const wrapModeClass =
    placementMode === "phase"
      ? "mode-phase"
      : placementMode === "anchor"
        ? "mode-anchor"
        : "";

  return (
    <div className="chart-stage">
      <div className={`chart-wrap ${wrapModeClass}`} ref={wrapRef}>
        <canvas ref={canvasRef} className="chart-canvas" onMouseDown={handleClick} />
        {placementMode && (
          <div className="placement-hint">
            {placementMode === "phase" ? "Phase placement — click grid" : "Anchor placement — click grid"}
            <span className="placement-hint-key">Esc</span>
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