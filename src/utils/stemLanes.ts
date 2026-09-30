/**
 * Route a stem filename to its highway lane by keyword.
 * Column order matches DRUM_LANES: Kick, Snare, Cymbal, Tom, Hi-hat, Clapfire.
 * Word boundaries matter — "what" must not match "hat".
 */
export function laneColumnFromStemName(name: string): number | null {
  const n = name.toLowerCase();
  if (/\bkick(s)?\b|\bkdrum\b/.test(n)) return 0;
  if (/\bsnare(s)?\b/.test(n)) return 1;
  if (/\b(cymb?(al)?s?|crash|ride)\b/.test(n)) return 2;
  if (/\btoms?\b|\bconga(s)?\b/.test(n)) return 3;
  if (/\b(hi[\s_.-]?hats?|hats?)\b/.test(n)) return 4;
  if (/\bclaps?\b/.test(n)) return 5;
  return null;
}
