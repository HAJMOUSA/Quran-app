import * as Font from "expo-font";
import * as FileSystem from "expo-file-system/legacy";

const CDN_BASE = "https://static.qurancdn.com/fonts/quran/hafs/v2/ttf";
export const fontFamilyForPage = (page: number): string => `QCF2${String(page).padStart(3, "0")}`;
export const pageFontUrl = (page: number): string => `${CDN_BASE}/p${page}.ttf`;
export const FALLBACK_FAMILY = "AmiriQuran";

const loaded = new Set<number>();
let fallbackLoaded = false;

async function ensureFallback(): Promise<string> {
  if (!fallbackLoaded) {
    await Font.loadAsync({ [FALLBACK_FAMILY]: require("../../assets/fonts/AmiriQuran-Regular.ttf") });
    fallbackLoaded = true;
  }
  return FALLBACK_FAMILY;
}

/**
 * Ensure the QCF2 font for `page` is available, returning the fontFamily to use.
 * Downloads + caches the page font on first use; falls back to Amiri on any failure
 * so a page never renders blank.
 */
export async function ensurePageFont(page: number): Promise<string> {
  const family = fontFamilyForPage(page);
  if (loaded.has(page)) return family;
  try {
    const dir = `${FileSystem.cacheDirectory}qcf2`;
    const target = `${dir}/${family}.ttf`;
    const info = await FileSystem.getInfoAsync(target);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const res = await FileSystem.downloadAsync(pageFontUrl(page), target);
      if (res.status !== 200) throw new Error(`font ${page} download status ${res.status}`);
    }
    await Font.loadAsync({ [family]: target });
    loaded.add(page);
    return family;
  } catch (e) {
    console.warn(`page font ${page} unavailable, using Amiri fallback`, e);
    return ensureFallback();
  }
}
