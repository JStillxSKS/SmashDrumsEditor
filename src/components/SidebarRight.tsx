import { useEditorStore } from "../store/useEditorStore";
import { OFFSET_NUDGE_FINE_MS } from "../utils/offset";
import {
  PLAYBACK_SPEED_MAX,
  PLAYBACK_SPEED_MIN,
} from "../utils/audioPlayback";
import {
  MAX_PIXELS_PER_TICK,
  MIN_PIXELS_PER_TICK,
  RESOLUTION,
  SNAP_OPTIONS,
  VISUAL_GRID_TICKS,
} from "../utils/resolution";
import { CollapsibleSection } from "./CollapsibleSection";

export function SidebarRight() {
  const {
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
    setPixelsPerTick,
    setWaveScale,
    setSongVolume,
    setHitVolume,
    setPlaybackSpeed,
    setAudioSource,
  } = useEditorStore();

  const beatSpacingPx = Math.round(RESOLUTION * pixelsPerTick);
  const gridRowPx = Math.round(VISUAL_GRID_TICKS * pixelsPerTick);

  return (
    <aside className="sidebar sidebar-right">
      <CollapsibleSection title="View" badge={`${beatSpacingPx}px/beat`} defaultOpen>
        <div className="panel-section">
          <p className="panel-section-title">Snap</p>
          <select value={snapTicks} onChange={(e) => setSnapTicks(Number(e.target.value))}>
            {SNAP_OPTIONS.map((opt) => (
              <option key={opt.ticks} value={opt.ticks}>
                {opt.label} ({opt.ticks}t)
              </option>
            ))}
          </select>
        </div>

        <div className="panel-section">
          <p className="panel-section-title">
            Zoom · beat {beatSpacingPx}px · 1/8 row {gridRowPx}px
          </p>
          <input
            type="range"
            min={MIN_PIXELS_PER_TICK}
            max={MAX_PIXELS_PER_TICK}
            step={0.01}
            value={pixelsPerTick}
            onChange={(e) => setPixelsPerTick(Number(e.target.value))}
          />
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
        <div className="panel-section">
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
          <li><kbd>C</kbd><span className="control-label">Copy mode — drag box</span></li>
          <li><kbd>Ctrl+C</kbd><span className="control-label">Copy all visible notes</span></li>
          <li><kbd>Ctrl+V</kbd><span className="control-label">Paste — first note at strike bar</span></li>
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