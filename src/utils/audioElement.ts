import { useEditorStore } from "../store/useEditorStore";
import { getActiveDuration } from "./audioSource";
import { editorAudioPlayer } from "./editorAudioPlayer";
import { playEditorAudioAt, resumeEditorAudio } from "./audioPlayback";
import { chartToAudioTime, getSongOffset, isInSilentLeadIn } from "./offset";
import { RESOLUTION } from "./resolution";
import { beatToTime, timeToBeat } from "./timing";

export function getPlaybackAudioTime(): number {
  return editorAudioPlayer.getAudioTime();
}

export function isPlaybackAudible(): boolean {
  return editorAudioPlayer.isAudible();
}

function clampChartTime(chartTime: number): number {
  const state = useEditorStore.getState();
  const t = Math.max(0, chartTime);
  const offset = getSongOffset(state.meta);
  const activeDuration = getActiveDuration(state);
  const maxChart = activeDuration > 0 ? activeDuration + offset : t;
  return Math.min(t, maxChart);
}

function syncAudioToChartTime(chartTime: number): void {
  const state = useEditorStore.getState();
  const offset = getSongOffset(state.meta);
  const duration = getActiveDuration(state);
  const silent = isInSilentLeadIn(chartTime, offset);
  const audioTime = Math.min(chartToAudioTime(chartTime, offset), duration || Infinity);
  const target = Math.max(0, audioTime);

  editorAudioPlayer.setMuted(silent);
  if (state.isPlaying && !silent) {
    void resumeEditorAudio().then(() => playEditorAudioAt(target));
    return;
  }

  editorAudioPlayer.pause();
  editorAudioPlayer.seek(silent ? 0 : target);
}

function commitSeek(chartTime: number, scrollTick: number): void {
  const state = useEditorStore.getState();
  state.setCurrentTime(chartTime);
  state.setScrollTick(scrollTick);
}

/** Seek by chart time (seconds); scroll follows the timing map */
export function seekChartTime(chartTime: number): void {
  const state = useEditorStore.getState();
  const t = clampChartTime(chartTime);
  syncAudioToChartTime(t);
  const beat = timeToBeat(t, state.meta.SongTiming);
  commitSeek(t, beat * RESOLUTION);
}

/** Seek by scroll tick — keeps the strike bar aligned to the wheel position */
export function seekScrollTick(scrollTick: number): void {
  const state = useEditorStore.getState();
  const tick = Math.max(0, scrollTick);
  const t = clampChartTime(beatToTime(tick / RESOLUTION, state.meta.SongTiming));
  syncAudioToChartTime(t);
  commitSeek(t, tick);
}

/** Sync playback position to whatever tick is at the strike bar */
export function seekToStrikeBar(): void {
  seekScrollTick(useEditorStore.getState().scrollTick);
}

/** After timing/offset edits: keep the strike bar on the same beat grid line. */
export function resyncAfterTimingChange(): void {
  const state = useEditorStore.getState();
  if (state.isPlaying) {
    const offset = getSongOffset(state.meta);
    const chartTime = editorAudioPlayer.isPlaying()
      ? getPlaybackAudioTime() + offset
      : state.currentTime;
    seekChartTime(chartTime);
    return;
  }
  seekScrollTick(state.scrollTick);
}