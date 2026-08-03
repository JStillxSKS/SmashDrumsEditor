import { create } from "zustand";
import {
  loadRecentProjects,
  pushRecentProject,
  type ShellProject,
} from "../utils/shellProjects";

export type ShellMode = "home" | "studio" | "exports";

type ShellState = {
  mode: ShellMode;
  project: ShellProject | null;
  recents: ShellProject[];
  setMode: (mode: ShellMode) => void;
  goHome: () => void;
  goStudio: () => void;
  goExports: () => void;
  setProject: (project: ShellProject | null) => void;
  touchProject: (patch: Partial<ShellProject> & { id: string; title: string }) => void;
  refreshRecents: () => void;
};

export const useShellStore = create<ShellState>((set, get) => ({
  mode: "home",
  project: null,
  recents: loadRecentProjects(),

  setMode: (mode) => set({ mode }),
  goHome: () => set({ mode: "home" }),
  goStudio: () => set({ mode: "studio" }),
  goExports: () => set({ mode: "exports" }),

  setProject: (project) => {
    if (project) {
      const recents = pushRecentProject(project);
      set({ project, recents });
    } else {
      set({ project: null });
    }
  },

  touchProject: (patch) => {
    const prev = get().project;
    const next: ShellProject = {
      id: patch.id,
      title: patch.title,
      artist: patch.artist ?? prev?.artist ?? "Unknown Artist",
      updatedAt: Date.now(),
      source: patch.source ?? prev?.source ?? "new",
      audioName: patch.audioName ?? prev?.audioName,
      exportPath: patch.exportPath ?? prev?.exportPath,
    };
    const recents = pushRecentProject(next);
    set({ project: next, recents });
  },

  refreshRecents: () => set({ recents: loadRecentProjects() }),
}));
