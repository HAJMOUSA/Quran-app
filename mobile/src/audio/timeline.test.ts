import { buildTimeline, activeIndexAt, verseWindow, type TimingVerse, type WordIndexRow } from "./timeline";

const verses: TimingVerse[] = [
  {
    verse_key: "1:1",
    timestamp_from: 0,
    timestamp_to: 5840,
    segments: [[1, 0, 580], [2, 580, 1409], [3, 1409, 2502], [4, 2502, 5840]],
  },
  {
    verse_key: "1:2",
    timestamp_from: 6090,
    timestamp_to: 11680,
    segments: [[1, 6090, 7025], [2], [2, 7025, 7885]], // includes a malformed segment
  },
];

const words: WordIndexRow[] = [
  { id: 10, verse_key: "1:1", position: 1, page: 1 },
  { id: 11, verse_key: "1:1", position: 2, page: 1 },
  { id: 12, verse_key: "1:1", position: 3, page: 1 },
  { id: 13, verse_key: "1:1", position: 4, page: 1 },
  { id: 20, verse_key: "1:2", position: 1, page: 1 },
  { id: 21, verse_key: "1:2", position: 2, page: 1 },
];

test("buildTimeline resolves segments to words, skips malformed, sorts by time", () => {
  const tl = buildTimeline(verses, words);
  expect(tl.map((s) => s.wordId)).toEqual([10, 11, 12, 13, 20, 21]);
  expect(tl[0]).toMatchObject({ wordId: 10, verseKey: "1:1", page: 1, startMs: 0, endMs: 580 });
});

test("buildTimeline skips segments with no matching word", () => {
  const tl = buildTimeline(
    [{ verse_key: "1:1", timestamp_from: 0, timestamp_to: 10, segments: [[9, 0, 10]] }],
    words,
  );
  expect(tl).toEqual([]);
});

test("activeIndexAt finds the last word started at or before ms", () => {
  const tl = buildTimeline(verses, words);
  expect(activeIndexAt(tl, -1)).toBe(-1);
  expect(activeIndexAt(tl, 0)).toBe(0);
  expect(activeIndexAt(tl, 600)).toBe(1);
  expect(activeIndexAt(tl, 2502)).toBe(3);
  // A gap (between 1:1 word 4 end and 1:2 word 1 start) keeps the last word.
  expect(activeIndexAt(tl, 5900)).toBe(3);
  expect(activeIndexAt(tl, 99999)).toBe(5);
});

test("verseWindow returns the ayah's audio bounds", () => {
  expect(verseWindow(verses, "1:2")).toEqual({ from: 6090, to: 11680 });
  expect(verseWindow(verses, "9:9")).toBeNull();
});
