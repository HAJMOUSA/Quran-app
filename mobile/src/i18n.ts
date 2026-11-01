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
  "follow.preparing": { en: "Preparing on-device model…", ar: "جارٍ تجهيز النموذج…" },
  "follow.listening": { en: "Finding your place…", ar: "جارٍ تحديد موضعك…" },
  "follow.tracking": { en: "Following", ar: "يتابع" },
  "follow.stop": { en: "Stop", ar: "إيقاف" },
  "follow.errorConnect": { en: "Couldn't reach the server. Tap to retry.", ar: "تعذّر الاتصال بالخادم. اضغط لإعادة المحاولة." },
  "follow.errorNoAudio": { en: "No recitation detected. Check the mic and tap to retry.", ar: "لم يتم التقاط تلاوة. تحقّق من الميكروفون واضغط لإعادة المحاولة." },
  "follow.errorModel": { en: "Couldn't load the offline model. Tap to retry.", ar: "تعذّر تحميل النموذج دون اتصال. اضغط لإعادة المحاولة." },
  "follow.retry": { en: "Retry", ar: "إعادة" },
  "tab.memorize": { en: "Memorize", ar: "الحفظ" },
  "memorize.title": { en: "Memorization", ar: "الحفظ" },
  "memorize.due": { en: "Due for review", ar: "مستحقة للمراجعة" },
  "memorize.all": { en: "All pages", ar: "كل الصفحات" },
  "memorize.empty": { en: "No pages yet. Add one from the Mushaf.", ar: "لا صفحات بعد. أضف صفحة من المصحف." },
  "memorize.addCurrent": { en: "Memorize this page", ar: "احفظ هذه الصفحة" },
  "memorize.page": { en: "Page", ar: "صفحة" },
  "memorize.review": { en: "Review", ar: "راجع" },
  "memorize.start": { en: "Start", ar: "ابدأ" },
  "memorize.finish": { en: "Finish & grade", ar: "إنهاء وتقييم" },
  "memorize.recallHint": { en: "Recite from memory — words reveal as you say them", ar: "اقرأ من حفظك — تظهر الكلمات عند نطقها" },
  "memorize.result": { en: "Recalled", ar: "تم التذكّر" },
  "memorize.stage.new": { en: "New", ar: "جديدة" },
  "memorize.stage.learning": { en: "Learning", ar: "قيد التعلم" },
  "memorize.stage.due": { en: "Due", ar: "مستحقة" },
  "memorize.stage.scheduled": { en: "Scheduled", ar: "مجدولة" },
  "settings.language": { en: "Language", ar: "اللغة" },
  "settings.theme": { en: "Theme", ar: "المظهر" },
  "settings.reciter": { en: "Reciter", ar: "القارئ" },
  "settings.server": { en: "Recitation server URL", ar: "رابط خادم التلاوة" },
  "settings.offline": { en: "On-device follow-along (offline)", ar: "المتابعة على الجهاز (بدون إنترنت)" },
};
export function t(key: string): string { return STRINGS[key]?.[lang] ?? key; }
