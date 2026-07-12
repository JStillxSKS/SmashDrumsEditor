import { useEffect, useRef, useState } from "react";
import { laneColumnIndex } from "../types/meta";
import { useEditorStore } from "../store/useEditorStore";
import {
  getPlaybackAudioTime,
  seekChartTime,
} from "../utils/audioElement";
import { editorAudioPlayer } from "../utils/editorAudioPlayer";
import { getSongOffset } from "../utils/offset";
import { beatToTick, RESOLUTION } from "../utils/resolution";
import { songExtentTicks } from "../utils/songExtent";
import { HIGHWAY_THEME as T } from "../theme/highway";
import { beatToTime, timeToBeat } from "../utils/timing";
import { drawMirroredWaveEnvelope, WAVE_WIDTH_FRAC } from "../utils/waveDraw";
import { buildWaveformByTick, type WavePeak } from "../utils/waveform";
import { getMainWaveformBuffer } from "../utils/audioSource";
import type { TimingAnchor } from "../types/meta";

const STRIKE_OFFSET = 150;
const LANE_HEADER_H = 44;

/** Match highway: future (high ticks) at top, song start at bottom. */
function tickToY(tick: number, totalTicks: number, height: number): number {
  if (totalTicks <= 0) return height;
  return height - (tick / totalTicks) * height;
}

function overviewWaveSamples(
  peaks: WavePeak[],
  totalTicks: number,
  h: number,
  chartTime: number,
  timing: TimingAnchor[],
  mode: "past" | "future"
) {
  return peaks
    .filter((p) => {
      if (p.amp < 0.01 || p.tick > totalTicks) return false;
      const noteTime = beatToTime(p.tick / RESOLUTION, timing);
      return mode === "past" ? noteTime <= chartTime : noteTime > chartTime;
    })
    .map((p) => ({ pos: tickToY(p.tick, totalTicks, h), amp: p.amp }));
}

export function SongOverview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const wavePeaksRef = useRef<WavePeak[]>([]);
  const draggingRef = useRef(false);
  const [scrubbing, setScrubbing] = useState(false);

  const {
    meta,
    charts,
    difficulty,
    duration,
    audioBuffer,
    drumsAudioBuffer,
    audioSource,
    scrollTick,
    pixelsPerTick,
    isPlaying,
    currentTime,
  } = useEditorStore();

  useEffect(() => {
    const buffer = getMainWaveformBuffer(useEditorStore.getState());
    if (buffer) {
      wavePeaksRef.current = buildWaveformByTick(
        buffer,
        meta.SongTiming,
        getSongOffset(meta),
        16
      );
    } else {
      wavePeaksRef.current = [];
    }
  }, [audioBuffer, drumsAudioBuffer, audioSource, meta.SongTiming, meta.SongOffsetSeconds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);

      const wrap = wrapRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx || !wrap) return;

      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w < 2 || h < 2) return;

      const cw = Math.max(1, Math.floor(w * dpr));
      const ch = Math.max(1, Math.floor(h * dpr));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w, h);

      const state = useEditorStore.getState();
      const totalTicks = songExtentTicks(state.meta, state.charts, state.duration);
      const notes = state.charts[state.difficulty];
      const ppt = state.pixelsPerTick;
      const timing = state.meta.SongTiming;
      const offset = getSongOffset(state.meta);

      let chartTime = state.currentTime;
      if (state.isPlaying && editorAudioPlayer.isPlaying()) {
        chartTime = getPlaybackAudioTime() + offset;
      }

      const playBeat = timeToBeat(chartTime, timing);
      const playTick = playBeat * RESOLUTION;
      const activeScroll = state.isPlaying ? playTick : state.scrollTick;

      const sy = h - STRIKE_OFFSET;
      const viewTop = activeScroll + (sy - LANE_HEADER_H) / ppt;
      const viewBottom = Math.max(0, activeScroll - (h - sy + 80) / ppt);

      const cx = w / 2;
      const maxHalf = w * WAVE_WIDTH_FRAC;
      const peaks = wavePeaksRef.current;

      if (peaks.length > 0) {
        drawMirroredWaveEnvelope(
          ctx,
          overviewWaveSamples(peaks, totalTicks, h, chartTime, timing, "future"),
          cx,
          maxHalf,
          "future"
        );
        drawMirroredWaveEnvelope(
          ctx,
          overviewWaveSamples(peaks, totalTicks, h, chartTime, timing, "past"),
          cx,
          maxHalf,
          "past"
        );
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.font = "10px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("Load audio", w / 2, h / 2);
      }

      // Phase markers
      for (const ph of state.meta.SongPhases) {
        const y = tickToY(beatToTick(ph.beat), totalTicks, h);
        ctx.fillStyle = "rgba(129, 140, 248, 0.5)";
        ctx.fillRect(4, y, w - 8, 1);
      }

      // Offset / audio start
      if (offset > 0) {
        const offsetTick = beatToTick(timeToBeat(offset, timing));
        const y = tickToY(offsetTick, totalTicks, h);
        ctx.fillStyle = "rgba(255, 190, 60, 0.75)";
        ctx.fillRect(0, y, w, 2);
      }

      // Note density
      for (const note of notes) {
        const tick = beatToTick(note.Beat);
        if (tick > totalTicks) continue;
        const y = tickToY(tick, totalTicks, h);
        const col = laneColumnIndex(note.Id);
        const x = 8 + (col / 5) * (w - 16);
        ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
        ctx.fillRect(x, y, 2, 2);
      }

      // Viewport band
      const topY = tickToY(viewTop, totalTicks, h);
      const bottomY = tickToY(viewBottom, totalTicks, h);
      const boxTop = Math.max(0, topY);
      const boxBottom = Math.min(h, bottomY);
      const boxH = Math.max(10, boxBottom - boxTop);

      ctx.fillStyle = `rgba(${T.magentaRgb}, 0.08)`;
      ctx.fillRect(0, boxTop, w, boxH);
      ctx.strokeStyle = `rgba(${T.neonRgb}, 0.32)`;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, boxTop + 0.5, w - 1, boxH - 1);

      // Playhead — bright vertical scrub line through the waveform
      const playY = tickToY(playTick, totalTicks, h);
      if (playY >= 0 && playY <= h) {
        ctx.save();
        ctx.shadowColor = T.magenta;
        ctx.shadowBlur = 14;
        ctx.strokeStyle = `rgba(${T.neonRgb}, 0.95)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, playY);
        ctx.lineTo(w, playY);
        ctx.stroke();
        ctx.restore();
      }

      ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
      ctx.fillRect(0, 0, w, 1);
      ctx.fillRect(0, h - 1, w, 1);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [
    meta.SongTiming,
    meta.SongPhases,
    meta.SongOffsetSeconds,
    charts,
    difficulty,
    duration,
    scrollTick,
    pixelsPerTick,
    isPlaying,
    currentTime,
    audioBuffer,
    drumsAudioBuffer,
    audioSource,
  ]);

  const jumpFromClientY = (clientY: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const state = useEditorStore.getState();
    const rect = wrap.getBoundingClientRect();
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    const ratio = rect.height > 0 ? 1 - y / rect.height : 0;
    const totalTicks = songExtentTicks(state.meta, state.charts, state.duration);
    const tick = ratio * totalTicks;
    const chartTime = beatToTime(tick / RESOLUTION, state.meta.SongTiming);
    const maxChart =
      state.duration > 0
        ? state.duration + getSongOffset(state.meta)
        : chartTime;
    seekChartTime(Math.max(0, Math.min(chartTime, maxChart)));
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      jumpFromClientY(e.clientY);
    };
    const onUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        setScrubbing(false);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const state = useEditorStore.getState();
      const totalTicks = songExtentTicks(state.meta, state.charts, state.duration);
      const timing = state.meta.SongTiming;
      const offset = getSongOffset(state.meta);
      let chartTime = state.currentTime;
      if (state.isPlaying && editorAudioPlayer.isPlaying()) {
        chartTime = getPlaybackAudioTime() + offset;
      }

      const step = (totalTicks / RESOLUTION / 80) * (e.deltaY > 0 ? -1 : 1);
      const nextBeat = timeToBeat(chartTime, timing) + step;
      const nextChart = beatToTime(Math.max(0, nextBeat), timing);
      const maxChart =
        state.duration > 0 ? state.duration + offset : nextChart;
      seekChartTime(Math.max(0, Math.min(nextChart, maxChart)));
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const startScrub = (clientY: number) => {
    draggingRef.current = true;
    setScrubbing(true);
    jumpFromClientY(clientY);
  };

  return (
    <div
      className={`song-overview${scrubbing ? " is-scrubbing" : ""}`}
      ref={wrapRef}
      title="Click, drag, or scroll to scrub through the song"
      onMouseDown={(e) => startScrub(e.clientY)}
      onTouchStart={(e) => {
        if (e.touches[0]) startScrub(e.touches[0].clientY);
      }}
      onTouchMove={(e) => {
        if (draggingRef.current && e.touches[0]) {
          e.preventDefault();
          jumpFromClientY(e.touches[0].clientY);
        }
      }}
      onTouchEnd={() => {
        draggingRef.current = false;
        setScrubbing(false);
      }}
    >
      <canvas ref={canvasRef} className="song-overview-canvas" />
    </div>
  );
}