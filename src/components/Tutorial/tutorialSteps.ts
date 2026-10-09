/**
 * Step definitions for the guided tours.
 *
 * Each step spotlights a real control via its `data-tutorial` attribute.
 * Steps with `target` omitted render as a centered card. Steps with a `gate`
 * keep Next disabled until the gate is satisfied against live editor state.
 *
 * Two tours: "basic" (chart your first song) and "advanced" (stems, timing,
 * phases, difficulty, play mode).
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
    body: "New notes land at the strike bar. On desktop press 1–6 for the six lanes, or turn Caps Lock on and click anywhere on the highway with the mouse to place notes (Caps Lock off goes back to seeking). On mobile switch to Edit and tap the lane colors on the strike bar. Don't aim for perfect — place at least 3 notes anywhere to keep going.",
    target: "chart-highway",
    gate: {
      hint: "Place at least 3 notes (keys 1–6, Caps Lock + click, or tap lane colors on mobile).",
      isMet: (w) => w.noteCount >= 3,
    },
  },
  {
    id: "playback",
    title: "5 · Playback controls",
    body: "Slow the song down to nail tricky sections without changing pitch, and turn the hit sounds up or down so you can hear your placements against the mix. Zoom lives in the View panel just above — Ctrl+scroll zooms too.",
    target: "sidebar-playback",
  },
  {
    id: "export",
    title: "6 · Export the pack",
    body: "Save .indies bundles everything — chart, audio, cover — into one file. One rule: Extreme needs at least one note, and you're charting on Extreme right now, so you're covered.",
    target: "toolbar-export",
  },
  {
    id: "done",
    title: "You charted a song",
    body: "That's the whole loop. Your .indies file downloads — get it on the headset with the Smash Indies app or Indies-DB and play it. When you're ready for the deep stuff (stems, anchors, phases), there's an advanced tour waiting on the home screen.",
  },
];

export const TUTORIAL_STEP_COUNT = TUTORIAL_STEPS.length;

export const ADVANCED_TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "adv-welcome",
    title: "Beyond the basics",
    body: "This tour covers the stuff nobody talks about: per-lane drum stems, timing anchors for tempo changes, song phases, difficulties, and play modes. No gates here — just follow along.",
  },
  {
    id: "adv-stems",
    title: "1 · Drum stems",
    body: "Load a drums-only mix here and each lane gets its own waveform. Name the files after the lane — kick, snare, cym/crash, tom, hat, clap — and the editor matches them automatically. Way easier to chart against than a full mix.",
    target: "toolbar-stems",
  },
  {
    id: "adv-anchors",
    title: "2 · Timing anchors",
    body: "Songs that change tempo mid-song need anchors: each one pins a new BPM at a beat, so the grid stays honest through the change. Flip this panel's dropdown to place them on the grid or drop one at the playhead.",
    target: "sidebar-timing",
  },
  {
    id: "adv-phases",
    title: "3 · Song phases",
    body: "Switch the Timing dropdown above to “Song phases” to mark sections — verse, chorus, bridge. They're labels for navigation and structure, and they export with the chart.",
    target: "sidebar-timing",
  },
  {
    id: "adv-difficulty",
    title: "4 · Difficulties",
    body: "You're always charting one difficulty at a time — switch with these buttons. Chart Extreme first, then “Auto-chart lower difficulties” generates Easy, Normal, and Hard from it Moonscraper-style. Empty difficulties also get filled automatically when you save.",
    target: "sidebar-difficulty",
  },
  {
    id: "adv-playmode",
    title: "5 · Play mode",
    body: "Classic is Neutral notes only. Arcade unlocks Crystal (soft) and Burning (hard) strengths — pick them with the Strength picker just below this panel and they'll export into the Arcade chart. Pick the mode that matches how you want the song played.",
    target: "sidebar-playmode",
  },
  {
    id: "adv-done",
    title: "That's the deep end",
    body: "Stems, anchors, phases, difficulties, play modes — that's the full toolkit. Now go chart something evil.",
  },
];

export const ADVANCED_TUTORIAL_STEP_COUNT = ADVANCED_TUTORIAL_STEPS.length;
