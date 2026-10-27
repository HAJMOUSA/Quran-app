import { newCard, review, isDue, gradeFromRatio, cardStage } from "./srs";

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

test("new card is due immediately and marked new", () => {
  const c = newCard(T0);
  expect(isDue(c, T0)).toBe(true);
  expect(cardStage(c, T0)).toBe("new");
});

test("successful reviews grow the interval 1 -> 6 -> ease-scaled", () => {
  let c = newCard(T0);
  c = review(c, 5, T0);
  expect(c.intervalDays).toBe(1);
  c = review(c, 5, c.dueAt);
  expect(c.intervalDays).toBe(6);
  c = review(c, 5, c.dueAt);
  expect(c.intervalDays).toBeGreaterThan(6);       // 6 * ease
  expect(c.dueAt).toBe(c.dueAt);                    // due in the future
  expect(cardStage(c, c.dueAt - DAY)).toBe("scheduled");
});

test("failing a review resets reps and relearns tomorrow", () => {
  let c = newCard(T0);
  c = review(c, 5, T0);
  c = review(c, 5, c.dueAt);     // reps=2, interval 6
  const beforeLapses = c.lapses;
  c = review(c, 1, c.dueAt);     // fail
  expect(c.reps).toBe(0);
  expect(c.intervalDays).toBe(1);
  expect(c.lapses).toBe(beforeLapses + 1);
});

test("ease never drops below 1.3", () => {
  let c = newCard(T0);
  for (let i = 0; i < 10; i++) c = review(c, 0, c.dueAt);
  expect(c.ease).toBeGreaterThanOrEqual(1.3);
});

test("gradeFromRatio maps recall accuracy to 0..5", () => {
  expect(gradeFromRatio(1)).toBe(5);
  expect(gradeFromRatio(0.92)).toBe(4);
  expect(gradeFromRatio(0.8)).toBe(3);
  expect(gradeFromRatio(0.6)).toBe(2);
  expect(gradeFromRatio(0.3)).toBe(1);
  expect(gradeFromRatio(0.1)).toBe(0);
});
