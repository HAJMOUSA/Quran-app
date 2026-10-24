import * as SQLite from "expo-sqlite";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system";
import { normalizeArabic } from "../i18n";
import type { WordRow, VerseRow, SurahRow, SearchHit } from "./schema";

const DB_NAME = "quran.db";
let db: SQLite.SQLiteDatabase | null = null;

export async function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  const dir = `${FileSystem.documentDirectory}SQLite`;
  const target = `${dir}/${DB_NAME}`;
  const info = await FileSystem.getInfoAsync(target);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const asset = Asset.fromModule(require("../../assets/quran.db"));
    await asset.downloadAsync();
    await FileSystem.copyAsync({ from: asset.localUri!, to: target });
  }
  db = await SQLite.openDatabaseAsync(DB_NAME);
  return db;
}

export interface MushafLine { line: number; words: WordRow[]; }
export function groupWordsByLine(rows: WordRow[]): MushafLine[] {
  const byLine = new Map<number, WordRow[]>();
  for (const w of rows) {
    const arr = byLine.get(w.line);
    if (arr) arr.push(w); else byLine.set(w.line, [w]);
  }
  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, words]) => ({ line, words: words.sort((a, b) => a.position - b.position) }));
}

export function buildSearchQuery(text: string): { sql: string; params: string[] } {
  const norm = normalizeArabic(text).replace(/\s+/g, "");
  return {
    sql: `SELECT verse_key, surah, page, translation_en FROM verses WHERE norm LIKE ? LIMIT 50`,
    params: [`%${norm}%`],
  };
}

export async function getPageWords(page: number): Promise<WordRow[]> {
  const d = await openDb();
  return d.getAllAsync<WordRow>(
    `SELECT id,verse_key,surah,ayah,position,page,line,char_type,code_v2,gidx
     FROM words WHERE page=? ORDER BY line, position`, [page]);
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
