import { create } from "zustand";

const SEEN_KEY = "sde.tutorialSeen";

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // localStorage unavailable — tutorial just won't remember dismissal.
  }
}

export function hasSeenTutorial(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

type TutorialState = {
  /** Overlay is mounted and stepping through the tour. */
  active: boolean;
  /** Index into TUTORIAL_STEPS. */
  stepIndex: number;
  /** Begin (or restart) the tour at the given step. */
  start: (step?: number) => void;
  next: () => void;
  back: () => void;
  /** User finished the last step — record dismissal. */
  finish: () => void;
  /** User bailed out early — record dismissal. */
  skip: () => void;
};

export const useTutorialStore = create<TutorialState>((set) => ({
  active: false,
  stepIndex: 0,

  start: (step = 0) => set({ active: true, stepIndex: Math.max(0, step) }),
  next: () => set((s) => ({ stepIndex: s.stepIndex + 1 })),
  back: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),
  finish: () => {
    markSeen();
    set({ active: false, stepIndex: 0 });
  },
  skip: () => {
    markSeen();
    set({ active: false, stepIndex: 0 });
  },
}));
