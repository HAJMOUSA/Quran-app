export interface WordRow {
  id: number; verse_key: string; surah: number; ayah: number;
  position: number; page: number; line: number; char_type: "word" | "end";
  code_v2: string | null; gidx: number | null;
}
export interface VerseRow {
  verse_key: string; surah: number; ayah: number; page: number;
  juz: number; text_uthmani: string; translation_en: string | null;
}
export interface SurahRow {
  id: number; name_arabic: string; name_simple: string;
  verses_count: number; first_page: number; last_page: number;
}
export interface SearchHit { verse_key: string; surah: number; page: number; translation_en: string | null; }
