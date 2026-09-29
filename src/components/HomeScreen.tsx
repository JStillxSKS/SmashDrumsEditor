import { useCallback, useState, type DragEvent } from "react";
import { useEditorStore } from "../store/useEditorStore";
import { useShellStore } from "../store/useShellStore";
import {
  createProjectId,
  titleFromAudioFileName,
  type ShellProject,
} from "../utils/shellProjects";
import {
  fileFromDroppedFile,
  pickAudioFile,
  pickImportPackageFile,
} from "../utils/pickAudioFile";

function formatWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function HomeScreen() {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const startFreshSession = useEditorStore((s) => s.startFreshSession);
  const loadMeta = useEditorStore((s) => s.loadMeta);
  const meta = useEditorStore((s) => s.meta);
  const hasSession = useEditorStore(
    (s) => Boolean(s.audioBuffer) || s.charts.extreme.length > 0
  );
  const setProject = useShellStore((s) => s.setProject);
  const goStudio = useShellStore((s) => s.goStudio);
  const goExports = useShellStore((s) => s.goExports);
  const recents = useShellStore((s) => s.recents);

  const openStudioWithProject = useCallback(
    (project: ShellProject) => {
      setProject(project);
      goStudio();
    },
    [setProject, goStudio]
  );

  const beginNewFromAudio = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const title = titleFromAudioFileName(file.name);
        await startFreshSession({ audioFile: file, songTitle: title });
        openStudioWithProject({
          id: createProjectId(),
          title,
          artist: "Unknown Artist",
          updatedAt: Date.now(),
          source: "new",
          audioName: file.name,
        });
      } finally {
        setBusy(false);
      }
    },
    [startFreshSession, openStudioWithProject]
  );

  const onNewSong = useCallback(async () => {
    const file = await pickAudioFile();
    if (!file) return;
    await beginNewFromAudio(file);
  }, [beginNewFromAudio]);

  const onBlankStudio = useCallback(async () => {
    setBusy(true);
    try {
      await startFreshSession();
      openStudioWithProject({
        id: createProjectId(),
        title: "Untitled Song",
        artist: "Unknown Artist",
        updatedAt: Date.now(),
        source: "new",
      });
    } finally {
      setBusy(false);
    }
  }, [startFreshSession, openStudioWithProject]);

  const onImport = useCallback(async () => {
    const file = await pickImportPackageFile();
    if (!file) return;
    setBusy(true);
    try {
      await loadMeta(file);
      const state = useEditorStore.getState();
      openStudioWithProject({
        id: createProjectId(),
        title: state.meta.NameSong || titleFromAudioFileName(file.name),
        artist: state.meta.NameArtist || "Unknown Artist",
        updatedAt: Date.now(),
        source: "import",
        audioName: state.audioFileName ?? undefined,
      });
    } finally {
      setBusy(false);
    }
  }, [loadMeta, openStudioWithProject]);

  const onContinue = useCallback(() => {
    const state = useEditorStore.getState();
    openStudioWithProject({
      id: createProjectId(),
      title: state.meta.NameSong || "Untitled Song",
      artist: state.meta.NameArtist || "Unknown Artist",
      updatedAt: Date.now(),
      source: "new",
      audioName: state.audioFileName ?? undefined,
    });
  }, [openStudioWithProject]);

  const onDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      const name = file.name.toLowerCase();
      if (
        name.endsWith(".indies") ||
        name.endsWith(".chart") ||
        name.endsWith(".json") ||
        name.endsWith(".rlrr") ||
        name.endsWith(".mid") ||
        name.endsWith(".midi")
      ) {
        setBusy(true);
        try {
          await loadMeta(fileFromDroppedFile(file));
          const state = useEditorStore.getState();
          openStudioWithProject({
            id: createProjectId(),
            title: state.meta.NameSong || titleFromAudioFileName(file.name),
            artist: state.meta.NameArtist || "Unknown Artist",
            updatedAt: Date.now(),
            source: "import",
            audioName: state.audioFileName ?? undefined,
          });
        } finally {
          setBusy(false);
        }
        return;
      }
      await beginNewFromAudio(fileFromDroppedFile(file));
    },
    [beginNewFromAudio, loadMeta, openStudioWithProject]
  );

  return (
    <div className="shell-home">
      <div className="shell-home__hero">
        <p className="shell-home__eyebrow">Indies OS · workflow</p>
        <h1 className="shell-home__title">Make a Smash pack</h1>
        <p className="shell-home__lead">
          Audio in → chart in Studio → export <code>.indies</code>. Everything stays in one
          loop — no separate tools.
        </p>
      </div>

      <div
        className={`shell-dropzone${dragOver ? " is-hot" : ""}${busy ? " is-busy" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <strong>Drop audio or a pack here</strong>
        <span>mp3 · ogg · wav · flac · .indies · .chart</span>
      </div>

      <div className="shell-tiles">
        <button
          type="button"
          className="shell-tile shell-tile--primary"
          disabled={busy}
          onClick={onNewSong}
        >
          <span className="shell-tile__kicker">Start</span>
          <span className="shell-tile__label">New song from audio</span>
          <span className="shell-tile__hint">Pick a mix → open Studio</span>
        </button>
        <button type="button" className="shell-tile" disabled={busy} onClick={onImport}>
          <span className="shell-tile__kicker">Open</span>
          <span className="shell-tile__label">Import .indies / chart</span>
          <span className="shell-tile__hint">Continue an existing pack</span>
        </button>
        <button
          type="button"
          className="shell-tile"
          disabled={busy || !hasSession}
          onClick={onContinue}
        >
          <span className="shell-tile__kicker">Resume</span>
          <span className="shell-tile__label">
            {hasSession ? meta.NameSong || "Current session" : "No session yet"}
          </span>
          <span className="shell-tile__hint">Jump back into Studio</span>
        </button>
        <button type="button" className="shell-tile" disabled={busy} onClick={onBlankStudio}>
          <span className="shell-tile__kicker">Blank</span>
          <span className="shell-tile__label">Empty Studio</span>
          <span className="shell-tile__hint">Load audio later from the toolbar</span>
        </button>
        <button type="button" className="shell-tile" onClick={goExports}>
          <span className="shell-tile__kicker">Ship</span>
          <span className="shell-tile__label">Exports</span>
          <span className="shell-tile__hint">Finished .indies packages</span>
        </button>
      </div>

      <section className="shell-recents">
        <div className="shell-recents__head">
          <h2>Recent projects</h2>
          <span>This machine · last {recents.length || 0}</span>
        </div>
        {recents.length === 0 ? (
          <p className="shell-recents__empty">
            Nothing yet. Start a song or import a pack — it shows up here.
          </p>
        ) : (
          <ul className="shell-recents__list">
            {recents.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="shell-recent"
                  onClick={() => {
                    setProject(p);
                    goStudio();
                  }}
                >
                  <span className="shell-recent__title">{p.title}</span>
                  <span className="shell-recent__meta">
                    {p.artist} · {p.source} · {formatWhen(p.updatedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="shell-recents__note">
          Recents remember titles for quick nav. Re-open audio or .indies if the session was
          cleared — full on-disk project folders come next.
        </p>
      </section>
    </div>
  );
}
