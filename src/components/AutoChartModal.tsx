import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditorStore } from "../store/useEditorStore";
import { fileFromImportPick } from "../utils/importFile";

export type AutoChartModalProps = {
  /** Absolute path of the picked audio file. */
  audioPath: string;
  audioName: string;
  /** imported = a generated .indies was loaded into the editor. */
  onClose: (imported: boolean) => void;
};

function extractVerdict(report: string | null): string | null {
  if (!report) return null;
  const line = report.split(/\r?\n/).find((l) => l.startsWith("VERDICT"));
  return line?.trim() ?? null;
}

/**
 * Runs the Auto-Charter Python CLI on one audio file, streaming its progress
 * lines into a log view. On success the generated .indies is imported through
 * the same loadMeta path as the regular Import button.
 */
export function AutoChartModal({ audioPath, audioName, onClose }: AutoChartModalProps) {
  const loadMeta = useEditorStore((s) => s.loadMeta);
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<"running" | "done" | "error">("running");
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const importedRef = useRef(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.runAutoCharter) {
      setStatus("error");
      setError("Auto-Charter is only available in the desktop app.");
      return;
    }
    let cancelled = false;
    const unsubscribe = api.onAutoCharterProgress?.((line) => {
      if (cancelled) return;
      setLines((prev) => [...prev.slice(-499), line]);
    });
    void (async () => {
      try {
        const result = await api.runAutoCharter(audioPath);
        if (cancelled) return;
        setVerdict(extractVerdict(result.report));
        // Same code path as the toolbar Import button (.indies → loadMeta).
        await loadMeta(fileFromImportPick(result));
        if (cancelled) return;
        importedRef.current = true;
        setStatus("done");
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [audioPath, loadMeta]);

  // Auto-scroll the log as lines stream in.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const running = status === "running";
  const handleClose = () => {
    if (running) return; // a run can take minutes — no cancel support
    onClose(importedRef.current);
  };

  return createPortal(
    <div className="publish-overlay" onClick={handleClose}>
      <div
        className="publish-dialog autochart-dialog"
        role="dialog"
        aria-labelledby="autochart-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="publish-close"
          onClick={handleClose}
          disabled={running}
          aria-label="Close"
        >
          ×
        </button>

        <h2 id="autochart-dialog-title">Auto-Chart from Audio</h2>
        <p className="publish-lead">
          Auto-Charter is turning <strong>{audioName}</strong> into a draft{" "}
          <code>.indies</code> chart. First runs download ML models and can take
          several minutes.
        </p>

        <div className="autochart-log" ref={logRef}>
          {lines.length === 0 && running ? (
            <div className="autochart-log-dim">Starting Auto-Charter…</div>
          ) : (
            lines.map((line, i) => <div key={i}>{line}</div>)
          )}
        </div>

        {status === "done" && (
          <p className="autochart-verdict">
            {verdict ?? "Chart generated and imported."}
          </p>
        )}
        {status === "error" && (
          <p className="publish-error autochart-error">{error}</p>
        )}

        <div className="publish-actions">
          {running ? (
            <span className="publish-muted">
              Working — keep the app open until the run finishes…
            </span>
          ) : (
            <button type="button" className="btn publish-btn" onClick={handleClose}>
              {status === "done" ? "Done" : "Close"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
