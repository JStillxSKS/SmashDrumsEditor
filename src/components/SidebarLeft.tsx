import { useState } from "react";
import { DIFFICULTIES, STRENGTHS } from "../types/meta";
import { useEditorStore } from "../store/useEditorStore";
import { extremeChartRequired } from "../utils/chartNotes";
import { seekChartTime } from "../utils/audioElement";
import {
  getSongOffset,
  OFFSET_NUDGE_COARSE_MS,
  OFFSET_NUDGE_FINE_MS,
  offsetFromMs,
  offsetToMs,
} from "../utils/offset";
import { CollapsibleSection } from "./CollapsibleSection";
import { SongPhasesPanel } from "./SongPhasesPanel";
import { TimingAnchorsPanel } from "./TimingAnchorsPanel";

type TimingView = "anchors" | "phases";

export function SidebarLeft() {
  const [timingView, setTimingView] = useState<TimingView>("anchors");
  const {
    meta,
    charts,
    difficulty,
    strength,
    setMetaField,
    setDifficulty,
    setStrength,
    setOffset,
    nudgeOffset,
    setOffsetFromPlayhead,
    goToChartStart,
    coverImageUrl,
    coverImageFileName,
    loadCoverImage,
    clearCoverImage,
  } = useEditorStore();

  const offset = getSongOffset(meta);
  const offsetMs = offsetToMs(offset);
  const noteCount = charts[difficulty].length;
  const diffLabel = DIFFICULTIES.find((d) => d.key === difficulty)?.label;
  const songBadge =
    meta.NameSong?.trim() ||
    meta.NameArtist?.trim() ||
    `${noteCount} note${noteCount === 1 ? "" : "s"}`;

  const handleGoToStart = () => {
    goToChartStart();
    seekChartTime(0);
  };

  return (
    <aside className="sidebar sidebar-left">
      <CollapsibleSection
        title="Song & Chart"
        badge={songBadge}
        defaultOpen
      >
        <div className="field-stack-song">
          <label>
            Artist
            <input
              value={meta.NameArtist}
              title={meta.NameArtist}
              onChange={(e) => setMetaField("NameArtist", e.target.value)}
            />
          </label>
          <label>
            Title
            <input
              className="song-title-input"
              value={meta.NameSong}
              title={meta.NameSong}
              onChange={(e) => setMetaField("NameSong", e.target.value)}
            />
          </label>
          <label>
            Charter
            <input
              value={meta.NameCharter}
              title={meta.NameCharter}
              onChange={(e) => setMetaField("NameCharter", e.target.value)}
            />
          </label>
        </div>

        <div className="panel-section">
          <p className="panel-section-title">Album art</p>
          {coverImageUrl ? (
            <img
              className="cover-preview"
              src={coverImageUrl}
              alt={coverImageFileName ?? "Album cover"}
              title={coverImageFileName ?? "Album cover"}
            />
          ) : (
            <p className="hint hint-inline">Loads from .indies or add manually</p>
          )}
          <div className="btn-group cover-actions">
            <label className="btn cover-btn">
              {coverImageUrl ? "Change" : "Add cover"}
              <input
                type="file"
                accept="image/*,.png,.jpg,.jpeg,.webp"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadCoverImage(f);
                  e.target.value = "";
                }}
              />
            </label>
            {coverImageUrl ? (
              <button className="btn" type="button" onClick={clearCoverImage}>
                Remove
              </button>
            ) : null}
          </div>
        </div>

        <div className="panel-section">
          <p className="panel-section-title">Difficulty</p>
          <div className="btn-group btn-group-equal">
            {DIFFICULTIES.map((d) => (
              <button
                key={d.key}
                type="button"
                className={difficulty === d.key ? "btn active" : "btn"}
                onClick={() => setDifficulty(d.key)}
              >
                {d.label}
              </button>
            ))}
          </div>
          <p className="hint hint-inline">
            {noteCount} notes · {diffLabel}
            {!extremeChartRequired(charts) && " · Extreme required"}
          </p>
        </div>

        <div className="panel-section">
          <p className="panel-section-title">Strength</p>
          <div className="btn-group btn-group-equal">
            {STRENGTHS.map((s) => (
              <button
                key={s.value}
                type="button"
                className={strength === s.value ? "btn active" : "btn"}
                onClick={() => setStrength(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Offset" badge={`${offsetMs} ms`} defaultOpen>
        <p className="hint offset-summary">
          Silent <strong>{offsetMs} ms</strong> before audio
        </p>
        <label>
          Lead-in (ms)
          <input
            type="number"
            step={1}
            value={offsetMs}
            onChange={(e) => setOffset(offsetFromMs(Number(e.target.value)))}
          />
        </label>
        <div className="btn-group offset-nudge">
          <button
            className="btn"
            type="button"
            onClick={() => nudgeOffset(-offsetFromMs(OFFSET_NUDGE_COARSE_MS))}
          >
            -{OFFSET_NUDGE_COARSE_MS}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => nudgeOffset(-offsetFromMs(OFFSET_NUDGE_FINE_MS))}
          >
            -{OFFSET_NUDGE_FINE_MS}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => nudgeOffset(offsetFromMs(OFFSET_NUDGE_FINE_MS))}
          >
            +{OFFSET_NUDGE_FINE_MS}
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => nudgeOffset(offsetFromMs(OFFSET_NUDGE_COARSE_MS))}
          >
            +{OFFSET_NUDGE_COARSE_MS}
          </button>
        </div>
        <div className="btn-group offset-actions">
          <button className="btn btn-accent" type="button" onClick={setOffsetFromPlayhead}>
            Set here
          </button>
          <button className="btn" type="button" onClick={handleGoToStart}>
            Go to start
          </button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Timing"
        badge={timingView === "anchors" ? "Anchors" : "Phases"}
        flex
        defaultOpen
      >
        <label>
          Section
          <select
            value={timingView}
            onChange={(e) => setTimingView(e.target.value as TimingView)}
          >
            <option value="anchors">Timing anchors</option>
            <option value="phases">Song phases</option>
          </select>
        </label>
        <div className="sidebar-tab-panel">
          {timingView === "anchors" && <TimingAnchorsPanel embedded />}
          {timingView === "phases" && <SongPhasesPanel embedded />}
        </div>
      </CollapsibleSection>
    </aside>
  );
}