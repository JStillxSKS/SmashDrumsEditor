import { useEffect, useRef, useState } from "react";
import { PublishModal } from "./PublishModal";
import { useEditorStore } from "../store/useEditorStore";
import { openOutputFolder } from "../utils/fileSave";
import {
  resyncAfterTimingChange,
  seekChartTime,
  seekToStrikeBar,
} from "../utils/audioElement";
import {
  activeSourceLabel,
  hasActiveAudio,
} from "../utils/audioSource";
import { editorAudioPlayer } from "../utils/editorAudioPlayer";
import {
  cancelPendingAudioPlayback,
  playEditorAudioAt,
} from "../utils/audioPlayback";
import {
  chartToAudioTime,
  getSongOffset,
  isInSilentLeadIn,
  offsetFromMs,
  OFFSET_NUDGE_FINE_MS,
} from "../utils/offset";
import { RESOLUTION, beatToTick, formatTick } from "../utils/resolution";
import { bpmFromAnchors } from "../utils/timing";
import { beatToTime, timeToBeat } from "../utils/timing";
import { pickImportFileDesktop } from "../utils/importFile";
import { redoDepth, undoDepth } from "../store/history";

const BPM_MIN = 40;
const BPM_MAX = 300;

export function Toolbar() {
  const [publishOpen, setPublishOpen] = useState(false);
  const {
    drumsAudioUrl,
    audioSource,
    audioFileName,
    drumsAudioFileName,
    currentTime,
    scrollTick,
    isPlaying,
    meta,
    loadAudio,
    loadDrumsAudio,
    loadMeta,
    exportIndies,
    exportingIndies,
    publishingIndies,
    sourceIndiesPath,
    exportChart,
    setCurrentTime,
    setIsPlaying,
    setAudioSource,
    nudgeOffset,
    goToChartStart,
    audioBuffer,
    drumsAudioBuffer,
    bpmDetecting,
    bpmConfidence,
    setBpm,
    detectBpmFromAudio,
    historyVersion,
    undo,
    redo,
  } = useEditorStore();

  const committedBpm = bpmFromAnchors(meta.SongTiming);
  const [bpmDraft, setBpmDraft] = useState(() => String(committedBpm));
  const [bpmFocused, setBpmFocused] = useState(false);

  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const silentAudioStartedRef = useRef(false);

  const playingSource = activeSourceLabel({ audioSource, drumsAudioUrl });
  const canPlay = hasActiveAudio({ audioSource, audioBuffer, drumsAudioBuffer });

  const chartTime = isPlaying
    ? currentTime
    : beatToTime(scrollTick / RESOLUTION, meta.SongTiming);
  const offset = getSongOffset(meta);
  const inSilence = isInSilentLeadIn(chartTime, offset);
  const audioTime = chartToAudioTime(chartTime, offset);

  const togglePlay = () => {
    if (!canPlay) return;
    if (isPlaying) {
      cancelPendingAudioPlayback();
      silentAudioStartedRef.current = false;
      setIsPlaying(false);
      seekChartTime(useEditorStore.getState().currentTime);
    } else {
      seekToStrikeBar();
      const { currentTime: strikeChartTime, meta: m } = useEditorStore.getState();
      const off = getSongOffset(m);
      const silent = isInSilentLeadIn(strikeChartTime, off);
      silentAudioStartedRef.current = false;
      if (silent) {
        editorAudioPlayer.setMuted(true);
        editorAudioPlayer.pause();
        editorAudioPlayer.seek(0);
      } else {
        editorAudioPlayer.setMuted(false);
        playEditorAudioAt(chartToAudioTime(strikeChartTime, off));
      }
      setIsPlaying(true);
    }
  };

  useEffect(() => {
    resyncAfterTimingChange();
  }, [meta.SongOffsetSeconds, meta.SongTiming]);

  useEffect(() => {
    editorAudioPlayer.setOnEnded(() => setIsPlaying(false));
    return () => editorAudioPlayer.setOnEnded(null);
  }, [setIsPlaying]);

  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(rafRef.current);
      return;
    }

    lastFrameRef.current = performance.now();
    silentAudioStartedRef.current = false;

    const loop = () => {
      const state = useEditorStore.getState();
      const { currentTime: ct, meta: m, isPlaying: playing } = state;
      const off = getSongOffset(m);

      if (!playing) return;

      if (ct < off) {
        const now = performance.now();
        const dt = (now - lastFrameRef.current) / 1000;
        lastFrameRef.current = now;
        const speed = state.playbackSpeed;
        const next = ct + dt * speed;
        setCurrentTime(next);

        if (next >= off && !silentAudioStartedRef.current) {
          silentAudioStartedRef.current = true;
          editorAudioPlayer.setMuted(false);
          playEditorAudioAt(0);
        }
      } else if (editorAudioPlayer.isAudible()) {
        setCurrentTime(editorAudioPlayer.getAudioTime() + off);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "[") {
        e.preventDefault();
        nudgeOffset(-offsetFromMs(OFFSET_NUDGE_FINE_MS));
      } else if (e.key === "]") {
        e.preventDefault();
        nudgeOffset(offsetFromMs(OFFSET_NUDGE_FINE_MS));
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void exportIndies();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const fmt = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 100);
    return `${m}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  const tick = isPlaying ? beatToTick(timeToBeat(chartTime, meta.SongTiming)) : scrollTick;

  useEffect(() => {
    if (!bpmFocused) {
      setBpmDraft(String(committedBpm));
    }
  }, [committedBpm, bpmFocused]);

  const commitBpmDraft = () => {
    const parsed = Number(bpmDraft);
    if (Number.isFinite(parsed) && parsed >= BPM_MIN && parsed <= BPM_MAX) {
      setBpm(parsed);
    } else {
      setBpmDraft(String(committedBpm));
    }
    setBpmFocused(false);
  };

  void historyVersion;
  const canUndo = undoDepth() > 0;
  const canRedo = redoDepth() > 0;

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <div className="brand">
          <img className="brand-logo" src="/app-icon.jpg" alt="" aria-hidden />
          <div>
            <h1>Smash Drums Editor</h1>
          </div>
        </div>
        {meta.NameSong && (
          <span className="song-title" title={meta.NameSong}>
            {meta.NameSong}
          </span>
        )}
      </div>

      <div className="toolbar-center">
        <div className="btn-group btn-group-tight history-btns">
          <button
            type="button"
            className="btn btn-sm"
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            onClick={undo}
          >
            ↶
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            onClick={redo}
          >
            ↷
          </button>
        </div>
        <button className="btn play-btn" onClick={togglePlay} disabled={!canPlay} title="Play / Pause (Space)">
          {isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <div className="btn-group btn-group-tight audio-source-toggle">
          <button
            type="button"
            className={audioSource === "song" ? "btn btn-sm active" : "btn btn-sm"}
            disabled={!audioFileName}
            title={audioFileName ?? "Load song audio"}
            onClick={() => setAudioSource("song")}
          >
            Song
          </button>
          <button
            type="button"
            className={audioSource === "drums" ? "btn btn-sm active" : "btn btn-sm"}
            disabled={!drumsAudioFileName}
            title={drumsAudioFileName ?? "Load drums audio"}
            onClick={() => setAudioSource("drums")}
          >
            Drums
          </button>
        </div>
        <span className="timecode">
          {inSilence
            ? "Silent"
            : `Audio (${playingSource}) ${fmt(audioTime)}`}
        </span>
        <span className="beatcode">
          Chart {fmt(Math.max(0, chartTime))} · {formatTick(tick)}
        </span>
        <button
          className="btn btn-sm"
          type="button"
          title="Jump to song start (beat 0)"
          onClick={() => {
            goToChartStart();
            seekChartTime(0);
          }}
        >
          ⏮ Start
        </button>
        <div
          className="toolbar-bpm"
          title={
            bpmConfidence !== null
              ? `Detect confidence ${Math.round(bpmConfidence * 100)}%`
              : "Song BPM"
          }
        >
          <label className="toolbar-bpm-label">
            <span className="toolbar-bpm-text">BPM</span>
            <input
              className="toolbar-bpm-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="Song BPM"
              value={bpmDraft}
              onFocus={() => {
                setBpmFocused(true);
                setBpmDraft(String(committedBpm));
              }}
              onChange={(e) => {
                setBpmFocused(true);
                setBpmDraft(e.target.value.replace(/[^\d]/g, ""));
              }}
              onBlur={() => commitBpmDraft()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitBpmDraft();
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setBpmDraft(String(committedBpm));
                  setBpmFocused(false);
                  e.currentTarget.blur();
                }
              }}
            />
          </label>
          <button
            className="btn btn-sm btn-accent toolbar-bpm-detect"
            type="button"
            disabled={!audioBuffer || bpmDetecting}
            onClick={() => void detectBpmFromAudio()}
          >
            {bpmDetecting ? "…" : "Detect"}
          </button>
        </div>
      </div>

      <div className="toolbar-right">
        <label className="file-btn">
          🎵 Song
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadAudio(f);
            }}
          />
        </label>
        <label className="file-btn">
          🥁 Drums
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadDrumsAudio(f);
            }}
          />
        </label>
        {window.electronAPI?.isDesktop ? (
          <button
            className="file-btn"
            type="button"
            title="Import .indies, .rlrr (Paradiddle), meta.json, or Clone Hero .chart"
            onClick={() => {
              void (async () => {
                const file = await pickImportFileDesktop();
                if (file) await loadMeta(file);
              })();
            }}
          >
            📂 Import
          </button>
        ) : (
          <label
            className="file-btn"
            title="Import .indies, .rlrr (Paradiddle), meta.json, or Clone Hero .chart"
          >
            📂 Import
            <input
              type="file"
              accept=".indies,.rlrr,.json,.chart,application/json,application/zip"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadMeta(f);
                e.target.value = "";
              }}
            />
          </label>
        )}
        <button
          className="btn export-btn"
          type="button"
          disabled={exportingIndies || publishingIndies}
          title={
            sourceIndiesPath
              ? `Save to output folder (Ctrl+S):\n${sourceIndiesPath}`
              : "Save to Desktop\\Smash Drums Editor\\output (Ctrl+S)"
          }
          onClick={() => void exportIndies()}
        >
          {exportingIndies ? "Saving…" : "Save .indies"}
        </button>
        <button
          className="btn publish-toolbar-btn"
          type="button"
          disabled={exportingIndies || publishingIndies || !canPlay}
          title={
            meta.IndiesDbMapId
              ? "Update this map on Indies-DB"
              : "Publish to Indies-DB (indies-db.vercel.app)"
          }
          onClick={() => setPublishOpen(true)}
        >
          {publishingIndies ? "Publishing…" : meta.IndiesDbMapId ? "Update Indies-DB" : "Publish"}
        </button>
        <button className="btn" onClick={() => void exportChart()}>
          Export CH chart + song.ini
        </button>
        {window.electronAPI?.isDesktop && (
          <button className="btn" type="button" onClick={() => void openOutputFolder()}>
            Open output
          </button>
        )}
      </div>

      <PublishModal open={publishOpen} onClose={() => setPublishOpen(false)} />
    </header>
  );
}