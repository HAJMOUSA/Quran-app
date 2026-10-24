import { fontFamilyForPage, pageFontUrl } from "./pageFont";

test("fontFamilyForPage zero-pads to 3 digits", () => {
  expect(fontFamilyForPage(1)).toBe("QCF2001");
  expect(fontFamilyForPage(604)).toBe("QCF2604");
});
test("pageFontUrl builds the CDN url", () => {
  expect(pageFontUrl(1)).toBe("https://static.qurancdn.com/fonts/quran/hafs/v2/ttf/p1.ttf");
  expect(pageFontUrl(604)).toBe("https://static.qurancdn.com/fonts/quran/hafs/v2/ttf/p604.ttf");
});
