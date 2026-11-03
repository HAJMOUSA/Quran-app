"""Follow-along tracker: turns successive transcripts into a Quran position + word statuses.

Each call to `update()` receives the transcript of the trailing audio window (the
window overlaps previous calls). The tracker is therefore idempotent with respect
to repeated words: it aligns the transcript against the reference around the
current position and only ever moves forward (unless it gets lost and re-searches).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .quran_index import CORRECT_SIM, QuranIndex, align

LOCK_MIN_SCORE = 0.55      # search score needed to lock a position
LOCK_MARGIN = 0.12         # best must beat the next distinct candidate by this
LOCK_MIN_WORDS = 3         # need at least this many ASR words to lock
TRACK_MIN_SCORE = 0.35     # alignment score below this counts as a miss
LOST_AFTER = 3             # consecutive misses before falling back to search
BACK_WORDS = 30            # reference window behind the current position
AHEAD_WORDS = 40           # reference window ahead of the current position


@dataclass
class TrackerState:
    mode: str = "search"                     # "search" | "track"
    position: int | None = None              # next expected gidx
    statuses: dict[int, str] = field(default_factory=dict)  # gidx -> correct|wrong|missed
    candidates: list[dict] = field(default_factory=list)
    misses: int = 0


class Tracker:
    def __init__(self, index: QuranIndex, start_gidx: int | None = None):
        self.index = index
        self.state = TrackerState()
        if start_gidx is not None:
            self.lock(start_gidx)

    def lock(self, gidx: int) -> None:
        self.state.mode = "track"
        self.state.position = gidx
        self.state.misses = 0
        self.state.candidates = []

    def reset(self) -> None:
        self.state = TrackerState()

    # ------------------------------------------------------------------ update
    def update(self, words: list[str]) -> dict:
        """Feed normalized words of the latest transcript window. Returns an event dict."""
        words = self.index.fold(words)
        if self.state.mode == "track":
            ev = self._track(words)
            if ev is not None:
                return ev
        return self._search(words)

    def _search(self, words: list[str]) -> dict:
        st = self.state
        cands = self.index.search(words, top_k=3) if len(words) >= 2 else []
        st.candidates = [
            {"start": c.start, "end": c.end, "score": round(c.score, 3), "verse_keys": c.verse_keys,
             "page": self.index.page[c.start]}
            for c in cands
        ]
        if cands and len(words) >= LOCK_MIN_WORDS and cands[0].score >= LOCK_MIN_SCORE:
            second = cands[1].score if len(cands) > 1 else 0.0
            if cands[0].score - second >= LOCK_MARGIN:
                best = cands[0]
                self.lock(best.start)
                # Score the words of the locking transcript too.
                ev = self._track(words)
                if ev is not None:
                    ev["locked"] = True
                    return ev
        st.mode = "search"
        return {"type": "search", "candidates": st.candidates}

    def _track(self, words: list[str]) -> dict | None:
        st = self.state
        assert st.position is not None
        if not words:
            return self._event(changed=[])
        lo = max(0, st.position - BACK_WORDS)
        hi = min(self.index.size, st.position + AHEAD_WORDS)
        a = align(words, self.index.norm[lo:hi], lo)
        if a is None or a.norm_score < TRACK_MIN_SCORE or a.end < st.position - BACK_WORDS // 2:
            st.misses += 1
            if st.misses >= LOST_AFTER:
                st.mode = "search"
                st.position = None
                return None  # caller falls back to search with these words
            return self._event(changed=[])
        st.misses = 0

        changed: list[int] = []
        for op in a.ops:
            if op.gidx is None:
                continue
            g = op.gidx
            prev = st.statuses.get(g)
            if op.op == "match" and op.sim >= CORRECT_SIM:
                new = "correct"
            elif op.op == "match":
                new = "wrong"
            else:
                new = "missed"
            # A word once recited correctly stays correct (windows overlap).
            if prev == "correct" or prev == new:
                continue
            # The last word of the window may be cut mid-word: only accept it if correct.
            if g == a.end and new != "correct":
                continue
            if g < st.position and prev is not None and new != "correct":
                continue
            st.statuses[g] = new
            changed.append(g)

        new_pos = a.end + 1
        if new_pos > st.position:
            # Words jumped over between the old position and the alignment start.
            for g in range(st.position, a.start):
                if g not in st.statuses:
                    st.statuses[g] = "missed"
                    changed.append(g)
            st.position = new_pos
        return self._event(changed=changed)

    def _event(self, changed: list[int]) -> dict:
        st = self.state
        pos = st.position
        info = self.index.word_info(min(pos, self.index.size - 1)) if pos is not None else None
        return {
            "type": "track",
            "position": pos,
            "current": info,
            "changed": [{"gidx": g, "word_id": self.index.word_id[g], "status": st.statuses[g]} for g in changed],
        }
