// Pure (no native deps) helpers that turn Quran.com QDC per-word audio segments
// into a time-sorted highlight timeline and answer "which word is playing now?".

/** One verse's timing block from the QDC audio_files API. */
export interface TimingVerse {
  verse_key: string;
  timestamp_from: number;
  timestamp_to: number;
  // Each segment is [wordPosition, startMs, endMs]; the API occasionally emits
  // shorter arrays (e.g. [1]) which carry no timing and must be skipped.
  segments: number[][];
}

/** A recitable word from quran.db, used to resolve a segment to a drawable word. */
export interface WordIndexRow {
  id: number;
  verse_key: string;
  position: number;
  page: number;
}

/** A word with the audio window during which it is being recited. */
export interface WordSeg {
  wordId: number;
  verseKey: string;
  page: number;
  startMs: number;
  endMs: number;
}

export function buildTimeline(verses: TimingVerse[], words: WordIndexRow[]): WordSeg[] {
  const byKeyPos = new Map<string, WordIndexRow>();
  for (const w of words) byKeyPos.set(`${w.verse_key}:${w.position}`, w);

  const out: WordSeg[] = [];
  for (const v of verses) {
    for (const seg of v.segments) {
      if (seg.length < 3) continue; // malformed/timing-less segment
      const [pos, startMs, endMs] = seg;
      const w = byKeyPos.get(`${v.verse_key}:${pos}`);
      if (!w) continue; // segment references a word not in this surah's index
      out.push({ wordId: w.id, verseKey: v.verse_key, page: w.page, startMs, endMs });
    }
  }
  out.sort((a, b) => a.startMs - b.startMs);
  return out;
}

/**
 * Index of the word active at `ms`: the last segment whose start is <= ms.
 * Returns -1 before the first word. Keeping the last-started word (rather than
 * requiring ms < endMs) makes the highlight persist through small inter-word gaps.
 */
export function activeIndexAt(timeline: WordSeg[], ms: number): number {
  let lo = 0;
  let hi = timeline.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid].startMs <= ms) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** The [from, to] audio window of a verse, in ms — used to loop a single ayah. */
export function verseWindow(
  verses: TimingVerse[],
  verseKey: string,
): { from: number; to: number } | null {
  const v = verses.find((x) => x.verse_key === verseKey);
  return v ? { from: v.timestamp_from, to: v.timestamp_to } : null;
}
