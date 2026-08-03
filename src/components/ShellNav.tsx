import { useShellStore, type ShellMode } from "../store/useShellStore";
import { useEditorStore } from "../store/useEditorStore";

const TABS: { id: ShellMode; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "studio", label: "Studio" },
  { id: "exports", label: "Exports" },
];

export function ShellNav() {
  const mode = useShellStore((s) => s.mode);
  const setMode = useShellStore((s) => s.setMode);
  const project = useShellStore((s) => s.project);
  const songTitle = useEditorStore((s) => s.meta.NameSong);
  const artist = useEditorStore((s) => s.meta.NameArtist);
  const hasAudio = useEditorStore((s) => Boolean(s.audioBuffer));

  const subtitle =
    mode === "studio"
      ? `${artist || "—"} — ${songTitle || "Untitled"}${hasAudio ? "" : " · no audio"}`
      : project
        ? `${project.artist} — ${project.title}`
        : "Indies creation station";

  return (
    <header className="shell-nav">
      <div className="shell-nav__brand">
        <span className="shell-nav__mark">INDIES</span>
        <div className="shell-nav__titles">
          <span className="shell-nav__name">Smash Drums Studio</span>
          <span className="shell-nav__sub">{subtitle}</span>
        </div>
      </div>
      <nav className="shell-nav__tabs" aria-label="Main">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`shell-nav__tab${mode === tab.id ? " is-active" : ""}`}
            onClick={() => setMode(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
