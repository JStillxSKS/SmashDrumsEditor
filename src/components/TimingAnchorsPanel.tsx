import type { TimingAnchor } from "../types/meta";
import { useEditorStore } from "../store/useEditorStore";
import { getTimeSignature } from "../utils/metaIO";
import {
  beatToTick,
  formatTick,
  type TimeSignature,
} from "../utils/resolution";
import { bpmAtAnchor, sortTimingAnchors } from "../utils/timing";

export function TimingAnchorsPanel({ embedded = false }: { embedded?: boolean }) {
  const {
    meta,
    placementMode,
    updateAnchor,
    setAnchorBpm,
    addAnchor,
    addAnchorAtPlayhead,
    removeAnchor,
    setPlacementMode,
  } = useEditorStore();

  const anchors = sortTimingAnchors(meta.SongTiming);
  const placing = placementMode === "anchor";
  const timeSig = getTimeSignature(meta);

  const togglePlaceOnGrid = () => {
    setPlacementMode(placing ? null : "anchor");
  };

  const content = (
    <>
      <p className="hint">
        Moonscraper-style BPM markers on <strong>whole beats</strong> only (Smash
        stores SongTiming beats as ints). BPM applies forward until the next
        marker. Lock freezes absolute time. Notes can sit on 1/16s — tempo
        markers cannot. Wrong fractional end beats make the editor look fine
        and the game drift.
      </p>

      <button
        className={`btn btn-accent placement-btn${placing ? " is-active" : ""}`}
        type="button"
        onClick={togglePlaceOnGrid}
      >
        {placing ? "Placing…" : "Place on grid"}
      </button>

      <ul className="phase-list anchor-list">
        {anchors.map((anchor, index) => (
          <AnchorItem
            key={`${anchor.beat}-${index}`}
            anchor={anchor}
            index={index}
            anchors={anchors}
            timeSig={timeSig}
            canRemove={anchors.length > 2 && index > 0}
            onUpdate={(patch) => updateAnchor(index, patch)}
            onSetBpm={(bpm) => setAnchorBpm(index, bpm)}
            onRemove={() => removeAnchor(index)}
          />
        ))}
      </ul>

      <div className="btn-group phase-actions">
        <button className="btn" type="button" onClick={addAnchor}>
          Add
        </button>
        <button className="btn btn-accent" type="button" onClick={addAnchorAtPlayhead}>
          At playhead
        </button>
      </div>
    </>
  );

  if (embedded) {
    return <div className="tab-content">{content}</div>;
  }

  return (
    <section className="panel">
      <h3>BPM / Sync Track</h3>
      {content}
    </section>
  );
}

function AnchorItem({
  anchor,
  index,
  anchors,
  timeSig,
  canRemove,
  onUpdate,
  onSetBpm,
  onRemove,
}: {
  anchor: TimingAnchor;
  index: number;
  anchors: TimingAnchor[];
  timeSig: TimeSignature;
  canRemove: boolean;
  onUpdate: (patch: Partial<TimingAnchor>) => void;
  onSetBpm: (bpm: number) => void;
  onRemove: () => void;
}) {
  const tick = beatToTick(anchor.beat);
  const isLast = index >= anchors.length - 1;
  const isRoot = index === 0;
  const forwardBpm = !isLast ? Math.round(bpmAtAnchor(anchors, index) * 1000) / 1000 : null;
  const locked = Boolean(anchor.anchored);

  return (
    <li className={`phase-item anchor-item${locked ? " is-anchored" : ""}`}>
      <div className="phase-item-head">
        <span className="anchor-badge">
          {isRoot ? "Start" : locked ? "Anchored" : "BPM"} ·{" "}
          {formatTick(tick, timeSig)}
        </span>
        <button
          className="phase-remove"
          type="button"
          title="Remove marker"
          disabled={!canRemove}
          onClick={onRemove}
        >
          ×
        </button>
      </div>

      <div className="phase-fields-row">
        <label>
          Beat
          <input
            type="number"
            min={0}
            step={1}
            value={anchor.beat}
            disabled={isRoot}
            onChange={(e) => onUpdate({ beat: Math.max(0, Math.round(Number(e.target.value))) })}
          />
        </label>
        {forwardBpm !== null ? (
          <label>
            BPM →
            <input
              type="number"
              min={1}
              max={999}
              step={0.001}
              value={forwardBpm}
              title="Tempo from this marker until the next (Moonscraper B)"
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) onSetBpm(v);
              }}
            />
          </label>
        ) : (
          <label>
            Time (s)
            <input
              type="number"
              min={0}
              step={0.001}
              value={anchor.timer}
              title="End marker time — edits previous segment BPM"
              onChange={(e) => onUpdate({ timer: Math.max(0, Number(e.target.value)) })}
            />
          </label>
        )}
      </div>

      {!isLast && (
        <div className="phase-fields-row">
          <label>
            Time (s)
            <input
              type="number"
              min={0}
              step={0.001}
              value={anchor.timer}
              disabled={isRoot}
              title={
                isRoot
                  ? "Beat 0 time is always 0; use Offset for lead-in"
                  : "Edit time to stretch the previous BPM (Moonscraper drag)"
              }
              onChange={(e) => onUpdate({ timer: Math.max(0, Number(e.target.value)) })}
            />
          </label>
          {!isRoot && (
            <label className="anchor-lock" title="Lock absolute time when earlier BPMs change">
              <input
                type="checkbox"
                checked={locked}
                onChange={(e) => onUpdate({ anchored: e.target.checked })}
              />
              Lock
            </label>
          )}
        </div>
      )}

      {isLast && !isRoot && (
        <label className="anchor-lock" title="Lock absolute time when earlier BPMs change">
          <input
            type="checkbox"
            checked={locked}
            onChange={(e) => onUpdate({ anchored: e.target.checked })}
          />
          Lock end time
        </label>
      )}

      {forwardBpm !== null && (
        <p className="hint anchor-meta hint-inline">
          {forwardBpm} BPM until next marker
          {locked ? " · locked" : ""}
        </p>
      )}
    </li>
  );
}
