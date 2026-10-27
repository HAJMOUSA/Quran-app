// Builds the on-device QuranIndex from the bundled quran.db (expo-sqlite).
// Kept separate from quranIndex.ts so the matcher stays pure/testable.
import { openDb } from "../db/quranDb";
import { QuranIndex, type IndexRow } from "./quranIndex";

let cached: QuranIndex | null = null;

export async function loadQuranIndex(fold = true): Promise<QuranIndex> {
  if (cached) return cached;
  const d = await openDb();
  const rows = await d.getAllAsync<IndexRow>(
    `SELECT gidx, id AS wordId, norm, verse_key AS verseKey, page, line, surah, ayah, position
     FROM words WHERE gidx IS NOT NULL ORDER BY gidx`);
  cached = new QuranIndex(rows, fold);
  return cached;
}
