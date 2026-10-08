/**
 * Step definitions for the "Chart your first song" guided tour.
 *
 * Each step spotlights a real control via its `data-tutorial` attribute.
 * Steps with `target` omitted render as a centered card. Steps with a `gate`
 * keep Next disabled until the gate is satisfied against live editor state.
 */

export interface TutorialWatch {
  /** Song audio has been decoded and is ready for playback/charting. */
  audioLoaded: boolean;
  /** Notes placed on the currently selected difficulty. */
  noteCount: number;
  /** Artist or Title metadata has been filled in. */
  hasTitle: boolean;
}

export interface TutorialGate {
  /** Shown under Next while the requirement is unmet. */
  hint: string;
  isMet: (w: TutorialWatch) => boolean;
}

export interface TutorialStep {
  id: string;
  title: string;
  body: string;
  /** Value of the data-tutorial attribute to spotlight. Omit for centered card. */
  target?: string;
  gate?: TutorialGate;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    title: "Chart your first song",
    body: "In about 15 minutes you'll go from nothing to a playable .indies pack: load audio, set the tempo, name it, place notes, export. This tour points at each step — you do the clicking.",
  },
  {
    id: "audio",
    title: "1 · Load your song",
    body: "Click 🎵 Song and pick an audio file (mp3, wav, ogg…). It drives playback and draws the waveforms you chart against. A drums-only stem works too — transients are easier to see.",
    target: "toolbar-song",
    gate: {
      hint: "Click 🎵 Song in the toolbar and pick an audio file to continue.",
      isMet: (w) => w.audioLoaded,
    },
  },
  {
    id: "bpm",
    title: "2 · Set the tempo",
    body: "Notes live on beats, so the grid needs your song's tempo. Sync guesses BPM from the audio, Tap lets you press T on each beat while it plays, or just type the number if you know it.",
    target: "toolbar-bpm",
  },
  {
    id: "metadata",
    title: "3 · Name it",
    body: "Artist, Title, and your Charter name show up in-game. Fill in at least the title — you can fix the rest later.",
    target: "sidebar-metadata",
    gate: {
      hint: "Type a song title in the left panel to continue.",
      isMet: (w) => w.hasTitle,
    },
  },
  {
    id: "notes",
    title: "4 · Place notes",
    body: "New notes land at the strike bar. On desktop press 1–6 for the six lanes; on mobile switch to Edit and tap the lane colors on the strike bar. Don't aim for perfect — place at least 3 notes anywhere to keep going.",
    target: "chart-highway",
    gate: {
      hint: "Place at least 3 notes (keys 1–6, or tap lane colors on mobile).",
      isMet: (w) => w.noteCount >= 3,
    },
  },
  {
    id: "export",
    title: "5 · Export the pack",
    body: "Save .indies bundles everything — chart, audio, cover — into one file. One rule: Extreme needs at least one note, and you're charting on Extreme right now, so you're covered.",
    target: "toolbar-export",
  },
  {
    id: "done",
    title: "You charted a song",
    body: "That's the whole loop. Your .indies file downloads — get it on the headset with the Smash Indies app or Indies-DB and play it. Now go make it actually good.",
  },
];

export const TUTORIAL_STEP_COUNT = TUTORIAL_STEPS.length;
