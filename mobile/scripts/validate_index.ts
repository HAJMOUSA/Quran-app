// Parity check: build the TS QuranIndex from the real quran.db rows and verify
// search matches expected ayat (mirrors server/tests/test_index.py).
// Run with Bun:  bun scripts/validate_index.ts   (needs data/index_rows.json)
import { readFileSync } from "fs";
import { QuranIndex, type IndexRow } from "../src/match/quranIndex";
import { normalizeWords } from "../src/match/normalize";

const rows: IndexRow[] = JSON.parse(readFileSync(`${import.meta.dir}/../../data/index_rows.json`, "utf-8"));
const t0 = Date.now();
const index = new QuranIndex(rows, true);
console.log(`built index: ${index.size} words in ${Date.now() - t0}ms`);

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  ok ? pass++ : fail++;
}

// Exact ayat
let q = normalizeWords("الله لا اله الا هو الحي القيوم لا تاخذه سنة ولا نوم");
let r = index.search(q);
check("Ayat al-Kursi -> 2:255", r[0]?.verseKeys[0] === "2:255", JSON.stringify(r[0]?.verseKeys));

q = normalizeWords("تبارك الذي بيده الملك وهو على كل شيء قدير");
r = index.search(q);
check("Al-Mulk 67:1", r[0]?.verseKeys[0] === "67:1", JSON.stringify(r[0]?.verseKeys));

// With ASR-style errors (missing + corrupted words)
q = normalizeWords("تبارك الذي بيدة الملك وهو على كل شي");
r = index.search(q);
check("67:1 with errors", r[0]?.verseKeys.includes("67:1"), JSON.stringify(r[0]?.verseKeys));

// Random exact 8-word excerpts
const rng = (seed: number) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const rand = rng(42);
let ok = 0;
const trials = 150;
const tS = Date.now();
for (let k = 0; k < trials; k++) {
  const start = Math.floor(rand() * (index.size - 12));
  const query = index.norm.slice(start, start + 8); // already folded; search folds again (idempotent)
  const res = index.search(query);
  if (res[0] && res[0].start <= start + 1 && res[0].end >= start + 6) ok++;
}
check(`random 8-word excerpts (${ok}/${trials})`, ok / trials > 0.95, `${((Date.now() - tS) / trials).toFixed(1)}ms/query`);

// Repeated phrase ambiguity
q = normalizeWords("فبأي آلاء ربكما تكذبان");
r = index.search(q, 5);
check("repeated phrase is ambiguous", r.length >= 2 && Math.abs(r[0].score - r[1].score) < 0.05, `${r.length} candidates`);

// --- Tracker (mirrors server/tests/test_index.py) ---
import { Tracker } from "../src/match/tracker";

// locks and follows
{
  const s = index.verseStart.get("36:1")!;  // Ya-Sin
  const tr = new Tracker(index);
  let ev = tr.update(index.norm.slice(s, s + 6));
  let okTrack = tr.mode === "track" && ev.type === "track" && ev.position === s + 6;
  for (let end = s + 9; end < s + 40; end += 3) {
    ev = tr.update(index.norm.slice(Math.max(s, end - 10), end));
    if (ev.type !== "track" || ev.position !== end) okTrack = false;
  }
  const allCorrect = [...tr.statuses.values()].every((v) => v === "correct");
  check("tracker locks and follows", okTrack && allCorrect);
}

// flags skipped and wrong words
{
  const s = index.verseStart.get("112:1")!;
  const tr = new Tracker(index, s);
  const words = index.norm.slice(s, s + 12);
  words[3] = "زززز";          // wrong
  words.splice(7, 1);          // skip ref word at index 7
  tr.update(words);
  check("tracker flags wrong+missed", tr.statuses.get(s + 3) === "wrong" && tr.statuses.get(s + 7) === "missed" && tr.statuses.get(s) === "correct",
    `${tr.statuses.get(s + 3)}/${tr.statuses.get(s + 7)}`);
}

// recovers after a jump elsewhere
{
  const s = index.verseStart.get("1:1")!;
  const tr = new Tracker(index, s);
  tr.update(index.norm.slice(s, s + 6));
  const far = index.verseStart.get("18:10")!;
  for (let k = 0; k < 6; k++) tr.update(index.norm.slice(far, far + 6 + k));
  check("tracker recovers after jump", tr.mode === "track" && index.verseKey[tr.position! - 1].startsWith("18:"),
    index.verseKey[(tr.position ?? 1) - 1]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
