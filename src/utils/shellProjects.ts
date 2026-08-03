export type ShellProjectSource = "new" | "import" | "export";

export type ShellProject = {
  id: string;
  title: string;
  artist: string;
  updatedAt: number;
  source: ShellProjectSource;
  audioName?: string;
  exportPath?: string;
};

const STORAGE_KEY = "indies-os-recents-v1";
const MAX_RECENTS = 24;

export function createProjectId(): string {
  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function titleFromAudioFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").trim();
  return base || "Untitled Song";
}

export function loadRecentProjects(): ShellProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ShellProject[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p.id === "string" && typeof p.title === "string")
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function saveRecentProjects(list: ShellProject[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)));
  } catch {
    /* quota / private mode */
  }
}

export function pushRecentProject(project: ShellProject): ShellProject[] {
  const prev = loadRecentProjects().filter((p) => p.id !== project.id);
  const next = [project, ...prev].slice(0, MAX_RECENTS);
  saveRecentProjects(next);
  return next;
}
