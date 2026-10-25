import { buildSearchQuery, groupWordsByLine } from "./quranDb";
import type { WordRow } from "./schema";

test("search query normalizes and wraps with wildcards", () => {
  const { sql, params } = buildSearchQuery("الْحَمْدُ");
  expect(sql).toContain("WHERE norm LIKE ?");
  expect(params[0]).toBe("%الحمد%");
});

test("search query keeps single spaces for multi-word queries", () => {
  const { params } = buildSearchQuery("الْحَمْدُ   لِلَّهِ");
  expect(params[0]).toBe("%الحمد لله%");
});

test("groupWordsByLine groups and orders by line then reading order", () => {
  const rows = [
    { line: 2, surah: 1, ayah: 1, position: 2 },
    { line: 1, surah: 1, ayah: 1, position: 1 },
    { line: 1, surah: 1, ayah: 1, position: 2 },
  ] as WordRow[];
  const lines = groupWordsByLine(rows);
  expect(lines.map((l) => l.line)).toEqual([1, 2]);
  expect(lines[0].words.map((w) => w.position)).toEqual([1, 2]);
});

test("groupWordsByLine keeps ayat separate on a line that spans two ayat", () => {
  // page 1 line 4: end of 1:3 then start of 1:4. Sorting by position alone would
  // interleave them (1:3.1, 1:4.1, 1:3.2, ...); reading order must not.
  const rows = [
    { id: 2953, line: 4, surah: 1, ayah: 3, position: 1 },
    { id: 3252, line: 4, surah: 1, ayah: 4, position: 1 },
    { id: 2954, line: 4, surah: 1, ayah: 3, position: 2 },
    { id: 3253, line: 4, surah: 1, ayah: 4, position: 2 },
  ] as WordRow[];
  const [line4] = groupWordsByLine(rows);
  expect(line4.words.map((w) => `${w.ayah}:${w.position}`)).toEqual(["3:1", "3:2", "4:1", "4:2"]);
});
