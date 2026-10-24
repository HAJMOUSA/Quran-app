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

test("groupWordsByLine groups and orders by position", () => {
  const rows = [
    { line: 2, position: 2 }, { line: 1, position: 1 }, { line: 1, position: 2 },
  ] as WordRow[];
  const lines = groupWordsByLine(rows);
  expect(lines.map((l) => l.line)).toEqual([1, 2]);
  expect(lines[0].words.map((w) => w.position)).toEqual([1, 2]);
});
