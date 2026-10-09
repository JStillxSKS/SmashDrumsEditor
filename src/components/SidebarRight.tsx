import { useEditorStore } from "../store/useEditorStore";
import { OFFSET_NUDGE_FINE_MS } from "../utils/offset";
import {
  PLAYBACK_SPEED_MAX,
  PLAYBACK_SPEED_MIN,
} from "../utils/audioPlayback";
import { getTimeSignature } from "../utils/metaIO";
import {
  MAX_PIXELS_PER_TICK,
  MIN_PIXELS_PER_TICK,
  RESOLUTION,
  formatTimeSignature,
  snapLabel,
  snapOptions,
  visualGridStep,
} from "../utils/resolution";
import { CollapsibleSection } from "./CollapsibleSection";

export function SidebarRight() {
  const {
    meta,
    snapTicks,
    pixelsPerTick,
    waveScale,
    songVolume,
    hitVolume,
    playbackSpeed,
    audioSource,
    drumsAudioFileName,
    audioFileName,
    setSnapTicks,
    stepSnap,
    setTimeSignature,
    setPixelsPerTick,
    setWaveScale,
    setSongVolume,
    setHitVolume,
    setPlaybackSpeed,
    setAudioSource,
  } = useEditorStore();

  const timeSig = getTimeSignature(meta);
  const options = snapOptions(timeSig);
  const gridStep = visualGridStep(snapTicks, timeSig);
  const beatSpacingPx = Math.round(RESOLUTION * pixelsPerTick);
  const gridRowPx = Math.round(gridStep * pixelsPerTick);
  const snapText = snapLabel(snapTicks, timeSig);

  // Keep select valid if measure length changed mid-session
  const selectValue = options.some((o) => o.ticks === snapTicks)
    ? snapTicks
    : options.find((o) => o.ticks === 240)?.ticks ?? 240;

  return (
    <aside className="sidebar sidebar-right">
      <CollapsibleSection title="View" badge={`${beatSpacingPx}px/beat`} defaultOpen>
        <div className="panel-section">
          <p className="panel-section-title">Time signature</p>
          <select
            value={formatTimeSignature(timeSig)}
            onChange={(e) => {
              const [n, d] = e.target.value.split("/").map(Number);
              setTimeSignature({ numerator: n, denominator: d });
            }}
            title="Bar length for measure lines, labels, and CH export TS"
          >
            {[
              "4/4",
              "3/4",
              "2/4",
              "5/4",
              "6/4",
              "7/4",
              "6/8",
              "9/8",
              "12/8",
              "5/8",
              "7/8",
            ].map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
          <p className="hint hint-inline">
            Measure lines &amp; snap-to-bar use {formatTimeSignature(timeSig)}. Default
            4/4 is safe for Smash Drums.
          </p>
        </div>

        <div className="panel-section">
          <p className="panel-section-title">
            Snap · grid shows {snapText}
            {gridStep !== snapTicks ? ` (lines every ${gridStep}t)` : ""}
          </p>
          <select
            value={selectValue}
            onChange={(e) => setSnapTicks(Number(e.target.value))}
          >
            {options.map((opt) => (
              <option key={`${opt.label}-${opt.ticks}`} value={opt.ticks}>
                {opt.label} ({opt.ticks}t)
              </option>
            ))}
          </select>
          <div className="zoom-btn-row" role="group" aria-label="Snap resolution">
            <button
              type="button"
              className="btn"
              title="Coarser snap (fewer grid lines)"
              onClick={() => stepSnap(-1)}
            >
              −
            </button>
            <button
              type="button"
              className="btn"
              title="Finer snap — 1/16, 1/32, 1/64 (more tick lines)"
              onClick={() => stepSnap(1)}
            >
              +
            </button>
          </div>
          <p className="hint hint-inline">
            − coarser · + finer (1/8 → 1/16 → 1/32 → 1/64). Highway draws tick lines at
            this resolution so you can see them.
          </p>
        </div>

        <div className="panel-section">
          <p className="panel-section-title">
            Zoom · beat {beatSpacingPx}px · grid row {gridRowPx}px
          </p>
          <input
            type="range"
            min={MIN_PIXELS_PER_TICK}
            max={MAX_PIXELS_PER_TICK}
            step={0.01}
            value={pixelsPerTick}
            onChange={(e) => setPixelsPerTick(Number(e.target.value))}
          />
          <div className="zoom-btn-row" role="group" aria-label="Zoom">
            <button
              type="button"
              className="btn"
              title="Zoom out"
              onClick={() => setPixelsPerTick(pixelsPerTick - 0.04)}
            >
              −
            </button>
            <button
              type="button"
              className="btn"
              title="Zoom in"
              onClick={() => setPixelsPerTick(pixelsPerTick + 0.04)}
            >
              +
            </button>
          </div>
        </div>

        <div className="panel-section">
          <p className="panel-section-title">
            Lane wave width ({Math.round(waveScale * 100)}%)
          </p>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={waveScale}
            onChange={(e) => setWaveScale(Number(e.target.value))}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Playback" defaultOpen>
        <div className="panel-section" data-tutorial="sidebar-playback">
          <p className="panel-section-title">
            Speed ({Math.round(playbackSpeed * 100)}%)
          </p>
          <input
            type="range"
            min={PLAYBACK_SPEED_MIN}
            max={PLAYBACK_SPEED_MAX}
            step={0.05}
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
          />
        </div>

        <div className="panel-section">
          <p className="panel-section-title">Audio source</p>
          <div className="btn-group btn-group-equal">
            <button
              type="button"
              className={audioSource === "song" ? "btn active" : "btn"}
              onClick={() => setAudioSource("song")}
              disabled={!audioFileName}
              title={audioFileName ?? "Load song audio first"}
            >
              Song
            </button>
            <button
              type="button"
              className={audioSource === "drums" ? "btn active" : "btn"}
              onClick={() => setAudioSource("drums")}
              disabled={!drumsAudioFileName}
              title={drumsAudioFileName ?? "Load drums audio first"}
            >
              Drums
            </button>
          </div>
        </div>

        <div className="panel-section">
          <p className="panel-section-title">
            Song volume ({Math.round(songVolume * 100)}%)
          </p>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={songVolume}
            onChange={(e) => setSongVolume(Number(e.target.value))}
          />
        </div>

        <div className="panel-section">
          <p className="panel-section-title">
            Hit sounds ({Math.round(hitVolume * 100)}%)
          </p>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={hitVolume}
            onChange={(e) => setHitVolume(Number(e.target.value))}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Controls" defaultOpen={false}>
        <ul className="controls-list">
          <li><kbd>Space</kbd><span className="control-label">Play</span></li>
          <li><kbd>[ ]</kbd><span className="control-label">Offset ±{OFFSET_NUDGE_FINE_MS}ms</span></li>
          <li><kbd>1-6</kbd><span className="control-label">Strike bar</span></li>
          <li><kbd>Click</kbd><span className="control-label">Seek (Caps off)</span></li>
          <li><kbd>Caps+Clk</kbd><span className="control-label">Place / erase note</span></li>
          <li><kbd>Shift+Drag</kbd><span className="control-label">Select notes</span></li>
          <li><kbd>C</kbd><span className="control-label">Copy selected notes</span></li>
          <li><kbd>Del</kbd><span className="control-label">Delete selected notes</span></li>
          <li><kbd>Ctrl+C</kbd><span className="control-label">Copy all visible notes</span></li>
          <li><kbd>Ctrl+V</kbd><span className="control-label">Paste — first note at strike bar</span></li>
          <li><kbd>Ctrl+Z</kbd><span className="control-label">Undo</span></li>
          <li><kbd>Ctrl+Y</kbd><span className="control-label">Redo</span></li>
          <li><kbd>Esc</kbd><span className="control-label">Cancel place</span></li>
          <li><kbd>← →</kbd><span className="control-label">Seek snap</span></li>
          <li><kbd>↑ ↓</kbd><span className="control-label">Pan snap</span></li>
          <li><kbd>Scroll</kbd><span className="control-label">Timeline</span></li>
          <li><kbd>Ctrl+Scr</kbd><span className="control-label">Zoom</span></li>
          <li><kbd>Overview</kbd><span className="control-label">Scrub</span></li>
        </ul>
      </CollapsibleSection>
    </aside>
  );
}
