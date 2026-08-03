import { useCallback, useEffect, useState } from "react";
import { getOutputFolder, openOutputFolder } from "../utils/fileSave";
import { useEditorStore } from "../store/useEditorStore";
import { useShellStore } from "../store/useShellStore";
import {
  createProjectId,
  titleFromAudioFileName,
} from "../utils/shellProjects";
import { fileFromImportPick } from "../utils/importFile";

type IndiesEntry = {
  name: string;
  path: string;
  mtime: number;
  size: number;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

export function ExportsScreen() {
  const [dir, setDir] = useState<string | null>(null);
  const [files, setFiles] = useState<IndiesEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);
  const isDesktop = Boolean(window.electronAPI?.isDesktop);
  const loadMeta = useEditorStore((s) => s.loadMeta);
  const exportIndies = useEditorStore((s) => s.exportIndies);
  const exporting = useEditorStore((s) => s.exportingIndies);
  const hasAudio = useEditorStore((s) => Boolean(s.audioBuffer));
  const message = useEditorStore((s) => s.clipboardMessage);
  const goStudio = useShellStore((s) => s.goStudio);
  const setProject = useShellStore((s) => s.setProject);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!window.electronAPI?.isDesktop) {
        setDir(null);
        setFiles([]);
        return;
      }
      const out = await getOutputFolder();
      setDir(out);
      if (window.electronAPI.listIndiesFiles) {
        const list = await window.electronAPI.listIndiesFiles();
        setFiles(list);
      } else {
        setFiles([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not list exports");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openIndies = useCallback(
    async (entry: IndiesEntry) => {
      if (!window.electronAPI?.readOutputBinary) {
        window.alert("Open this file with Import from Home, or use Open folder.");
        return;
      }
      setOpening(entry.name);
      try {
        // Prefer absolute path via pick path — use read from output by relative name
        const bytes = await window.electronAPI.readOutputBinary(entry.name);
        if (!bytes) {
          window.alert(`Could not read ${entry.name}`);
          return;
        }
        const file = fileFromImportPick({
          path: entry.path,
          name: entry.name,
          bytes,
        });
        await loadMeta(file);
        const state = useEditorStore.getState();
        setProject({
          id: createProjectId(),
          title: state.meta.NameSong || titleFromAudioFileName(entry.name),
          artist: state.meta.NameArtist || "Unknown Artist",
          updatedAt: Date.now(),
          source: "export",
          exportPath: entry.path,
          audioName: state.audioFileName ?? undefined,
        });
        goStudio();
      } finally {
        setOpening(null);
      }
    },
    [loadMeta, setProject, goStudio]
  );

  return (
    <div className="shell-exports">
      <div className="shell-exports__hero">
        <p className="shell-home__eyebrow">Package · ship</p>
        <h1 className="shell-home__title">Exports</h1>
        <p className="shell-home__lead">
          Finished <code>.indies</code> packs land here (desktop output folder). Package from
          Studio when Extreme has notes and song audio is loaded.
        </p>
      </div>

      <div className="shell-exports__actions">
        <button
          type="button"
          className="shell-btn shell-btn--primary"
          disabled={!hasAudio || exporting}
          onClick={() => void exportIndies()}
        >
          {exporting ? "Packaging…" : "Export current session as .indies"}
        </button>
        {hasAudio && (
          <button type="button" className="shell-btn" onClick={goStudio}>
            Back to Studio
          </button>
        )}
        {isDesktop && (
          <>
            <button type="button" className="shell-btn" onClick={() => void openOutputFolder()}>
              Open folder
            </button>
            <button type="button" className="shell-btn" onClick={() => void refresh()}>
              Refresh
            </button>
          </>
        )}
      </div>

      {message && <p className="shell-exports__toast">{message}</p>}
      {error && <p className="shell-exports__error">{error}</p>}

      {!isDesktop && (
        <p className="shell-exports__note">
          Browser mode downloads <code>.indies</code> via the browser. Run the desktop app for a
          persistent Exports folder.
        </p>
      )}

      {isDesktop && (
        <>
          <p className="shell-exports__path">
            Folder: <code>{dir ?? "…"}</code>
          </p>
          {loading ? (
            <p className="shell-recents__empty">Scanning…</p>
          ) : files.length === 0 ? (
            <p className="shell-recents__empty">
              No <code>.indies</code> files yet. Chart in Studio, then export.
            </p>
          ) : (
            <ul className="shell-exports__list">
              {files.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    className="shell-export-row"
                    disabled={opening === f.name}
                    onClick={() => void openIndies(f)}
                  >
                    <span className="shell-export-row__name">{f.name}</span>
                    <span className="shell-export-row__meta">
                      {formatBytes(f.size)} · {formatWhen(f.mtime)}
                      {opening === f.name ? " · opening…" : " · open in Studio"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
