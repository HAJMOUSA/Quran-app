import { normalizeArabic, t, setLanguage } from "./i18n";

test("normalizeArabic strips tashkeel and unifies letters", () => {
  expect(normalizeArabic("الْحَمْدُ")).toBe("الحمد");
  expect(normalizeArabic("إِنَّ")).toBe("ان");
});
test("t returns the string for the active language", () => {
  setLanguage("en"); expect(t("tab.mushaf")).toBe("Mushaf");
  setLanguage("ar"); expect(t("tab.mushaf")).toBe("المصحف");
});
