// SM-2 spaced-repetition scheduler. A card tracks how well a page is memorized
// and when it is next due. Grades are 0–5 (q<3 = failed recall).
const DAY = 24 * 60 * 60 * 1000;

export interface SrsCard {
  reps: number;       // consecutive successful reviews
  ease: number;       // ease factor (>= 1.3)
  intervalDays: number;
  dueAt: number;      // epoch ms
  lapses: number;
  lastGrade?: number;
}

export function newCard(nowMs: number = Date.now()): SrsCard {
  return { reps: 0, ease: 2.5, intervalDays: 0, dueAt: nowMs, lapses: 0 };
}

export function review(card: SrsCard, quality: number, nowMs: number = Date.now()): SrsCard {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  let { reps, ease, intervalDays, lapses } = card;

  if (q < 3) {
    reps = 0;
    intervalDays = 1;      // relearn tomorrow
    lapses += 1;
  } else {
    reps += 1;
    if (reps === 1) intervalDays = 1;
    else if (reps === 2) intervalDays = 6;
    else intervalDays = Math.round(intervalDays * ease);
  }
  // SM-2 ease update, floored at 1.3.
  ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  return { reps, ease, intervalDays, lapses, dueAt: nowMs + intervalDays * DAY, lastGrade: q };
}

export function isDue(card: SrsCard, nowMs: number = Date.now()): boolean {
  return card.dueAt <= nowMs;
}

/** Map a correct/total recall ratio (0..1) to an SM-2 grade (0..5). */
export function gradeFromRatio(ratio: number): number {
  if (ratio >= 0.97) return 5;
  if (ratio >= 0.9) return 4;
  if (ratio >= 0.75) return 3;  // passing
  if (ratio >= 0.5) return 2;
  if (ratio >= 0.25) return 1;
  return 0;
}

/** Short human label for a card's state. */
export function cardStage(card: SrsCard, nowMs: number = Date.now()): "new" | "learning" | "due" | "scheduled" {
  if (card.reps === 0 && card.lapses === 0) return "new";
  if (card.dueAt <= nowMs) return card.reps === 0 ? "learning" : "due";
  return "scheduled";
}
