// Quran.com recitation metadata: the reciter list and, per surah, the audio file
// URL plus per-word timing segments. Results are cached in memory for the session.
import type { TimingVerse } from "./timeline";

const API = "https://api.quran.com/api/v4";
const QDC = "https://api.qurancdn.com/api/qdc";

export interface Reciter {
  id: number;
  name: string;
  style: string | null;
}

export interface SurahAudio {
  audioUrl: string;
  durationMs: number;
  verses: TimingVerse[];
}

const reciterCache: { list: Reciter[] | null } = { list: null };
const audioCache = new Map<string, SurahAudio>();

export async function getReciters(): Promise<Reciter[]> {
  if (reciterCache.list) return reciterCache.list;
  const r = await fetch(`${API}/resources/recitations?language=en`);
  if (!r.ok) throw new Error(`reciters HTTP ${r.status}`);
  const data = await r.json();
  reciterCache.list = (data.recitations as any[]).map((x) => ({
    id: x.id,
    name: x.reciter_name ?? x.translated_name?.name ?? `Reciter ${x.id}`,
    style: x.style ?? null,
  }));
  return reciterCache.list;
}

export async function getSurahAudio(reciterId: number, surah: number): Promise<SurahAudio> {
  const key = `${reciterId}:${surah}`;
  const hit = audioCache.get(key);
  if (hit) return hit;
  const r = await fetch(
    `${QDC}/audio/reciters/${reciterId}/audio_files?chapter=${surah}&segments=true`,
  );
  if (!r.ok) throw new Error(`audio HTTP ${r.status}`);
  const data = await r.json();
  const file = data.audio_files?.[0];
  if (!file?.audio_url) throw new Error(`no audio for reciter ${reciterId} surah ${surah}`);
  const audio: SurahAudio = {
    audioUrl: file.audio_url,
    durationMs: file.duration ?? 0,
    verses: (file.verse_timings ?? []) as TimingVerse[],
  };
  audioCache.set(key, audio);
  return audio;
}
