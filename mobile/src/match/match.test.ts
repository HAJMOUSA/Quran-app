import { normalizeText, normalizeWords, foldPhonetic } from "./normalize";
import { align, wordSim, CORRECT_SIM } from "./align";
import { QuranIndex, type IndexRow } from "./quranIndex";
import { Tracker } from "./tracker";

test("normalizeText strips tashkeel and unifies letters", () => {
  expect(normalizeText("بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ")).toBe("بسم الله الرحمن");
  expect(normalizeWords("إِيَّاكَ نَعْبُدُ")).toEqual(["اياك", "نعبد"]);
  expect(normalizeText("هُدًى لِّلْمُتَّقِينَ")).toBe("هدي للمتقين");
});

test("foldPhonetic collapses confusable consonants, idempotently", () => {
  expect(foldPhonetic("الصراط المستقيم")).toBe("السرات المستكيم");
  expect(foldPhonetic("خلق")).toBe("خلك");
  const once = foldPhonetic("ثلاثة");
  expect(foldPhonetic(once)).toBe(once);
});

test("wordSim is 1 for equal, fractional for near", () => {
  expect(wordSim("الله", "الله")).toBe(1);
  expect(wordSim("يولد", "يجد")).toBeGreaterThan(0.3);
  expect(wordSim("الله", "زززز")).toBeLessThan(0.3);
});

test("align finds an exact contiguous span with free ends", () => {
  const ref = ["بسم", "الله", "الرحمن", "الرحيم", "الحمد", "لله"];
  const a = align(["الله", "الرحمن", "الرحيم"], ref, 0)!;
  expect(a).not.toBeNull();
  expect(a.start).toBe(1);
  expect(a.end).toBe(3);
  expect(a.normScore).toBeGreaterThan(0.9);
});

test("align tolerates a wrong and a skipped word", () => {
  const ref = ["قل", "هو", "الله", "احد", "الله", "الصمد"];
  // say 'هو' wrong, skip 'احد'
  const a = align(["قل", "زز", "الله", "الله", "الصمد"], ref, 0)!;
  const wrong = a.ops.find((o) => o.gidx === 1);   // 'هو'
  const missed = a.ops.find((o) => o.gidx === 3);  // 'احد'
  expect(wrong?.op).toBe("match");
  expect(wrong!.sim).toBeLessThan(CORRECT_SIM);
  expect(missed?.op).toBe("del");
});

test("align merges two ASR words into one reference word", () => {
  const ref = ["ونادى", "نوح", "ياقوم", "اني"];
  const a = align(["ونادى", "نوح", "يا", "قوم", "اني"], ref, 0)!;
  const merged = a.ops.find((o) => o.gidx === 2); // 'ياقوم'
  expect(merged?.op).toBe("match");
  expect(merged!.sim).toBeGreaterThanOrEqual(CORRECT_SIM);
});

// Small synthetic corpus with DISTINCT tokens (so alignment is unambiguous) to
// cover index + tracker plumbing. Full-scale parity against quran.db with real
// (repeating) Arabic is in scripts/validate_index.ts.
const WORDS = ["aa", "bb", "cc", "dd", "ee", "ff", "gg", "hh", "ii", "jj", "kk"];
const rows: IndexRow[] = WORDS.map((w, g) => ({
  gidx: g, wordId: 100 + g, norm: w,
  verseKey: g < 7 ? "2:255" : "112:1",
  page: g < 7 ? 42 : 604, line: 1,
  surah: g < 7 ? 2 : 112, ayah: g < 7 ? 255 : 1, position: g + 1,
}));

test("QuranIndex.search finds the span in a small corpus", () => {
  const index = new QuranIndex(rows, false);
  const r = index.search(["cc", "dd", "ee", "ff"]);
  expect(r[0].verseKeys).toContain("2:255");
  expect(r[0].start).toBe(2);
});

test("Tracker locks, follows, and flags a wrong word", () => {
  const index = new QuranIndex(rows, false);
  const tr = new Tracker(index);
  // Recite the span but say a wrong word for 'gg' (gidx 6).
  const ev = tr.update(["aa", "bb", "cc", "dd", "ee", "ff", "ZZ", "hh"]);
  expect(tr.mode).toBe("track");
  expect(ev.type).toBe("track");
  expect(tr.statuses.get(5)).toBe("correct");  // ff
  expect(tr.statuses.get(6)).toBe("wrong");    // gg (said ZZ)
});

// A correctly-recited word must stay green even though the reference is stored
// phonetically folded. Regression for false reds in follow-along.
const foldRows: IndexRow[] = ["اهدنا", "الصراط", "المستقيم", "الذين", "انعمت"].map((w, g) => ({
  gidx: g, wordId: 200 + g, norm: w,
  verseKey: "1:6", page: 1, line: 1, surah: 1, ayah: 6, position: g + 1,
}));

test("Tracker keeps a correctly-recited word green despite a folded reference", () => {
  const index = new QuranIndex(foldRows, true);   // folds reference: الصراط -> السرات
  const tr = new Tracker(index, 1);               // lock on الصراط (gidx 1)
  tr.update(["اهدنا", "الصراط", "المستقيم"]);      // ASR output = correct orthography
  expect(tr.statuses.get(1)).toBe("correct");     // was "wrong" before the fix
});
