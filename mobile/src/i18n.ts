const TASHKEEL = /[ً-ٰٟۖ-ۭـ]/g;
export function normalizeArabic(s: string): string {
  return s
    .replace(TASHKEEL, "")
    .replace(/[أإآٱ]/g, "ا") // أ إ آ ٱ -> ا
    .replace(/ى/g, "ي") // ى -> ي
    .replace(/ة/g, "ه") // ة -> ه
    .replace(/ؤ/g, "و") // ؤ -> و
    .replace(/ئ/g, "ي") // ئ -> ي
    .replace(/[^ء-ي\s]/g, "")
    .trim();
}

type Lang = "ar" | "en";
let lang: Lang = "en";
export function setLanguage(l: Lang) { lang = l; }
const STRINGS: Record<string, Record<Lang, string>> = {
  "tab.mushaf": { en: "Mushaf", ar: "المصحف" },
  "tab.index": { en: "Index", ar: "الفهرس" },
  "tab.search": { en: "Search", ar: "بحث" },
  "tab.settings": { en: "Settings", ar: "الإعدادات" },
  "search.placeholder": { en: "Search the Quran", ar: "ابحث في القرآن" },
  "sheet.bookmark": { en: "Bookmark", ar: "علامة" },
  "sheet.copy": { en: "Copy", ar: "نسخ" },
  "sheet.share": { en: "Share", ar: "مشاركة" },
  "settings.language": { en: "Language", ar: "اللغة" },
  "settings.theme": { en: "Theme", ar: "المظهر" },
};
export function t(key: string): string { return STRINGS[key]?.[lang] ?? key; }
