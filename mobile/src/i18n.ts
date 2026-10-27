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
  "recite.tap": { en: "Recite to search", ar: "اقرأ للبحث" },
  "recite.listening": { en: "Listening… tap to stop", ar: "يستمع… اضغط للإيقاف" },
  "recite.searching": { en: "Searching…", ar: "جارٍ البحث…" },
  "recite.heard": { en: "Heard", ar: "المسموع" },
  "recite.nomatch": { en: "No match found", ar: "لا توجد نتيجة" },
  "recite.denied": { en: "Microphone permission needed", ar: "يلزم إذن الميكروفون" },
  "recite.error": { en: "Couldn't reach the server", ar: "تعذّر الوصول إلى الخادم" },
  "sheet.bookmark": { en: "Bookmark", ar: "علامة" },
  "sheet.copy": { en: "Copy", ar: "نسخ" },
  "sheet.share": { en: "Share", ar: "مشاركة" },
  "sheet.play": { en: "Play", ar: "استماع" },
  "player.loading": { en: "Loading audio…", ar: "جارٍ التحميل…" },
  "player.repeat": { en: "Repeat ayah", ar: "تكرار الآية" },
  "player.stop": { en: "Stop", ar: "إيقاف" },
  "follow.start": { en: "Follow along", ar: "تابع التلاوة" },
  "follow.listening": { en: "Finding your place…", ar: "جارٍ تحديد موضعك…" },
  "follow.tracking": { en: "Following", ar: "يتابع" },
  "follow.stop": { en: "Stop", ar: "إيقاف" },
  "settings.language": { en: "Language", ar: "اللغة" },
  "settings.theme": { en: "Theme", ar: "المظهر" },
  "settings.reciter": { en: "Reciter", ar: "القارئ" },
  "settings.server": { en: "Recitation server URL", ar: "رابط خادم التلاوة" },
};
export function t(key: string): string { return STRINGS[key]?.[lang] ?? key; }
