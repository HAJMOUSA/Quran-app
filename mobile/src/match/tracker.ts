// On-device port of server/quran_server/tracker.py — turns successive ASR
// transcripts into a Quran position + per-word statuses, fully offline.
import { align, CORRECT_SIM } from "./align";
import { QuranIndex, type Candidate } from "./quranIndex";

const LOCK_MIN_SCORE = 0.55;
const LOCK_MARGIN = 0.12;
const LOCK_MIN_WORDS = 3;
const TRACK_MIN_SCORE = 0.35;
const LOST_AFTER = 3;
const BACK_WORDS = 30;
const AHEAD_WORDS = 40;

export type WordStatus = "correct" | "wrong" | "missed";

export interface TrackCurrent { gidx: number; word_id: number; verse_key: string; page: number; line: number; position: number; }
export interface TrackChange { gidx: number; word_id: number; status: WordStatus; }
export type TrackerEvent =
  | { type: "search"; candidates: { start: number; end: number; score: number; verse_keys: string[]; page: number }[] }
  | { type: "track"; position: number | null; current: TrackCurrent | null; changed: TrackChange[]; locked?: boolean };

export class Tracker {
  mode: "search" | "track" = "search";
  position: number | null = null;
  statuses = new Map<number, WordStatus>();
  private misses = 0;

  constructor(private index: QuranIndex, startGidx: number | null = null) {
    if (startGidx != null) this.lock(startGidx);
  }

  lock(gidx: number): void { this.mode = "track"; this.position = gidx; this.misses = 0; }
  reset(): void { this.mode = "search"; this.position = null; this.statuses.clear(); this.misses = 0; }

  update(words: string[]): TrackerEvent {
    words = this.index.foldQuery(words);
    if (this.mode === "track") {
      const ev = this.track(words);
      if (ev !== null) return ev;
    }
    return this.search(words);
  }

  private search(words: string[]): TrackerEvent {
    const cands: Candidate[] = words.length >= 2 ? this.index.search(words, 3) : [];
    const candidates = cands.map((c) => ({ start: c.start, end: c.end, score: Math.round(c.score * 1000) / 1000, verse_keys: c.verseKeys, page: c.page }));
    if (cands.length && words.length >= LOCK_MIN_WORDS && cands[0].score >= LOCK_MIN_SCORE) {
      const second = cands.length > 1 ? cands[1].score : 0;
      if (cands[0].score - second >= LOCK_MARGIN) {
        this.lock(cands[0].start);
        const ev = this.track(words);
        if (ev !== null) { (ev as any).locked = true; return ev; }
      }
    }
    this.mode = "search";
    return { type: "search", candidates };
  }

  private track(words: string[]): TrackerEvent | null {
    const pos = this.position!;
    if (words.length === 0) return this.event([]);
    const lo = Math.max(0, pos - BACK_WORDS);
    const hi = Math.min(this.index.size, pos + AHEAD_WORDS);
    const a = align(words, this.index.norm.slice(lo, hi), lo);
    if (!a || a.normScore < TRACK_MIN_SCORE || a.end < pos - Math.floor(BACK_WORDS / 2)) {
      this.misses += 1;
      if (this.misses >= LOST_AFTER) { this.mode = "search"; this.position = null; return null; }
      return this.event([]);
    }
    this.misses = 0;

    const changed: number[] = [];
    for (const op of a.ops) {
      if (op.gidx === null) continue;
      const g = op.gidx;
      const prev = this.statuses.get(g);
      let next: WordStatus;
      if (op.op === "match" && op.sim >= CORRECT_SIM) next = "correct";
      else if (op.op === "match") next = "wrong";
      else next = "missed";
      if (prev === "correct" || prev === next) continue;
      if (g === a.end && next !== "correct") continue;         // last window word may be cut
      if (g < pos && prev !== undefined && next !== "correct") continue;
      this.statuses.set(g, next);
      changed.push(g);
    }
    const newPos = a.end + 1;
    if (newPos > pos) {
      for (let g = pos; g < a.start; g++) {
        if (!this.statuses.has(g)) { this.statuses.set(g, "missed"); changed.push(g); }
      }
      this.position = newPos;
    }
    return this.event(changed);
  }

  private event(changed: number[]): TrackerEvent {
    const pos = this.position;
    const info = pos !== null ? this.index.wordInfo(Math.min(pos, this.index.size - 1)) : null;
    const current: TrackCurrent | null = info
      ? { gidx: info.gidx, word_id: info.wordId, verse_key: info.verseKey, page: info.page, line: info.line, position: info.position }
      : null;
    return {
      type: "track",
      position: pos,
      current,
      changed: changed.map((g) => ({ gidx: g, word_id: this.index.wordId[g], status: this.statuses.get(g)! })),
    };
  }
}
