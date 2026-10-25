import * as SQLite from "expo-sqlite";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system/legacy";
import { normalizeArabic } from "../i18n";
import type { WordRow, VerseRow, SurahRow, SearchHit } from "./schema";
import type { WordIndexRow } from "../audio/timeline";

const DB_NAME = "quran.db";
let db: SQLite.SQLiteDatabase | null = null;

export async function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  const dir = `${FileSystem.documentDirectory}SQLite`;
  const target = `${dir}/${DB_NAME}`;
  const info = await FileSystem.getInfoAsync(target);
  if (!info.exists) {
    try {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const asset = Asset.fromModule(require("../../assets/quran.db"));
      await asset.downloadAsync();
      if (!asset.localUri) throw new Error("bundled quran.db asset has no localUri");
      await FileSystem.copyAsync({ from: asset.localUri, to: target });
    } catch (e) {
      // Never leave a half-written DB: remove it so the next launch retries (design §7).
      await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
      throw new Error(`Failed to initialize quran.db: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Open from the SAME directory we copied into. openDatabaseAsync otherwise
  // defaults to the native defaultDatabaseDirectory and would open an empty DB.
  db = await SQLite.openDatabaseAsync(DB_NAME, undefined, dir);
  return db;
}

export interface MushafLine { line: number; words: WordRow[]; }

// Reading order within a line is (surah, ayah, position) — NOT position alone.
// A line can span the end of one ayah and the start of the next; `position` is
// the index *within an ayah*, so sorting by it interleaves the two ayat. `id` is
// Quran.com's global word id and is not in reading order. (surah, ayah, position)
// matches the mushaf sequence exactly and also orders ayah-end markers correctly.
export const readingOrder = (a: WordRow, b: WordRow): number =>
  a.surah - b.surah || a.ayah - b.ayah || a.position - b.position;

export function groupWordsByLine(rows: WordRow[]): MushafLine[] {
  const byLine = new Map<number, WordRow[]>();
  for (const w of rows) {
    const arr = byLine.get(w.line);
    if (arr) arr.push(w); else byLine.set(w.line, [w]);
  }
  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, words]) => ({ line, words: words.sort(readingOrder) }));
}

export function buildSearchQuery(text: string): { sql: string; params: string[] } {
  const norm = normalizeArabic(text).replace(/\s+/g, " ").trim();
  return {
    sql: `SELECT verse_key, surah, page, translation_en FROM verses WHERE norm LIKE ? LIMIT 50`,
    params: [`%${norm}%`],
  };
}

export async function getPageWords(page: number): Promise<WordRow[]> {
  const d = await openDb();
  return d.getAllAsync<WordRow>(
    `SELECT id,verse_key,surah,ayah,position,page,line,char_type,code_v2,gidx
     FROM words WHERE page=? ORDER BY line, surah, ayah, position`, [page]);
}
/** Recitable words of a surah (char_type='word'), for aligning audio segments. */
export async function getSurahWordIndex(surah: number): Promise<WordIndexRow[]> {
  const d = await openDb();
  return d.getAllAsync<WordIndexRow>(
    `SELECT id, verse_key, position, page FROM words
     WHERE surah=? AND char_type='word' ORDER BY ayah, position`, [surah]);
}
export async function getVerse(verseKey: string): Promise<VerseRow | null> {
  const d = await openDb();
  return d.getFirstAsync<VerseRow>(
    `SELECT verse_key,surah,ayah,page,juz,text_uthmani,translation_en FROM verses WHERE verse_key=?`,
    [verseKey]);
}
export async function getSurahs(): Promise<SurahRow[]> {
  const d = await openDb();
  return d.getAllAsync<SurahRow>(
    `SELECT id,name_arabic,name_simple,verses_count,first_page,last_page FROM surahs ORDER BY id`);
}
export async function search(text: string): Promise<SearchHit[]> {
  const d = await openDb();
  const { sql, params } = buildSearchQuery(text);
  return d.getAllAsync<SearchHit>(sql, params);
}
