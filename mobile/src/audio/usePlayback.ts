// Recitation playback: loads a surah's audio + word timeline, tracks the word
// being recited (for highlighting), auto-advances across the surah, turns the
// page, and can loop a single ayah. Pure timing math lives in ./timeline (tested).
import { useCallback, useEffect, useRef, useState } from "react";
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from "expo-audio";
import { getSurahWordIndex } from "../db/quranDb";
import { getSurahAudio } from "./recitations";
import { activeIndexAt, buildTimeline, verseWindow, type TimingVerse, type WordSeg } from "./timeline";

export interface PlaybackState {
  surah: number | null;
  playing: boolean;
  loading: boolean;
  activeWordId: number | null;
  activeVerseKey: string | null;
  page: number | null;
  repeatAyah: boolean;
}

const IDLE: PlaybackState = {
  surah: null, playing: false, loading: false,
  activeWordId: null, activeVerseKey: null, page: null, repeatAyah: false,
};

export function usePlayback(reciterId: number, onPage?: (page: number) => void) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const timeline = useRef<WordSeg[]>([]);
  const verses = useRef<TimingVerse[]>([]);
  const [state, setState] = useState<PlaybackState>(IDLE);
  const repeatRef = useRef(false);
  const lastPage = useRef<number | null>(null);

  useEffect(() => { setAudioModeAsync({ playsInSilentMode: true }).catch(() => {}); }, []);

  const loadSurah = useCallback(async (surah: number) => {
    const [audio, words] = await Promise.all([getSurahAudio(reciterId, surah), getSurahWordIndex(surah)]);
    verses.current = audio.verses;
    timeline.current = buildTimeline(audio.verses, words);
    player.replace({ uri: audio.audioUrl });
    return audio;
  }, [player, reciterId]);

  const playFromVerse = useCallback(async (verseKey: string) => {
    const surah = Number(verseKey.split(":")[0]);
    setState((s) => ({ ...s, loading: true }));
    try {
      await loadSurah(surah);
      const w = verseWindow(verses.current, verseKey);
      if (w) player.seekTo(w.from / 1000);
      player.play();
      setState((s) => ({ ...s, surah, loading: false, playing: true, activeVerseKey: verseKey }));
    } catch (e) {
      console.warn("playFromVerse failed", e);
      setState((s) => ({ ...s, loading: false }));
    }
  }, [loadSurah, player]);

  const toggle = useCallback(() => {
    if (status.playing) { player.pause(); } else { player.play(); }
  }, [player, status.playing]);

  const stop = useCallback(() => {
    player.pause();
    player.seekTo(0);
    lastPage.current = null;
    setState(IDLE);
  }, [player]);

  const setRepeatAyah = useCallback((on: boolean) => {
    repeatRef.current = on;
    setState((s) => ({ ...s, repeatAyah: on }));
  }, []);

  // React to playback position: highlight the active word, loop the ayah, turn pages.
  useEffect(() => {
    if (!state.surah || timeline.current.length === 0) return;
    if (status.didJustFinish) { stop(); return; }  // surah ended: don't run past the file
    const ms = (status.currentTime ?? 0) * 1000;

    if (repeatRef.current && state.activeVerseKey) {
      const w = verseWindow(verses.current, state.activeVerseKey);
      if (w && ms >= w.to - 10) { player.seekTo(w.from / 1000); return; }
    }

    const i = activeIndexAt(timeline.current, ms);
    const seg = i >= 0 ? timeline.current[i] : null;
    setState((s) => {
      const playing = status.playing ?? s.playing;
      if (seg && seg.wordId === s.activeWordId && playing === s.playing) return s;
      return seg
        ? { ...s, activeWordId: seg.wordId, activeVerseKey: seg.verseKey, page: seg.page, playing }
        : { ...s, playing };
    });
    if (seg && seg.page !== lastPage.current) {
      lastPage.current = seg.page;
      onPage?.(seg.page);
    }
  }, [status.currentTime, status.playing, status.didJustFinish, state.surah, state.activeVerseKey, player, onPage, stop]);

  return { state, playFromVerse, toggle, stop, setRepeatAyah };
}
