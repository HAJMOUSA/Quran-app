// Arabic normalization + phonetic folding for on-device matching.
// Ports server/quran_server/normalize.py so offline matching behaves identically.

// Tashkeel (harakat), superscript alef, Quranic annotation marks, tatweel.
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const NON_ARABIC = /[^ء-ي\s]/g;
const SPACES = /\s+/g;

const CHAR_MAP: Record<string, string> = {
  "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ٲ": "ا", "ٳ": "ا",
  "ى": "ي", "ی": "ي", "ئ": "ي",
  "ؤ": "و",
  "ة": "ه",
  "ک": "ك",
};

export function normalizeText(text: string): string {
  let out = text.replace(DIACRITICS, "");
  out = out.replace(/[أإآٱٲٳىیئؤةک]/g, (c) => CHAR_MAP[c] ?? c);
  out = out.replace(NON_ARABIC, " ");
  return out.replace(SPACES, " ").trim();
}

export function normalizeWords(text: string): string[] {
  const n = normalizeText(text);
  return n ? n.split(" ") : [];
}

// Phonetic folding (matching only): collapse consonants Arabic ASR confuses.
// Targets are fixed points so folding is idempotent. Mirrors fold_phonetic().
const FOLD_MAP: Record<string, string> = {
  "ث": "ت", "ط": "ت",
  "ص": "س",
  "ذ": "ز", "ظ": "ز",
  "ض": "د",
  "ق": "ك",
  "ح": "ه",
  "ى": "ا", "ء": "ا",
  "ة": "ه",
};

export function foldPhonetic(norm: string): string {
  return norm.replace(/[ثطصذظضقحىءة]/g, (c) => FOLD_MAP[c] ?? c);
}
