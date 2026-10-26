"""In-memory index over the Quran word sequence: candidate search + fuzzy word alignment.

All positions are *global word indices* (gidx): 0..N-1 over every recitable word of
the Mushaf in order (ayah-end markers excluded). gidx maps 1:1 to rows of the
`words` table in quran.db, which the app also renders from.
"""
from __future__ import annotations

import math
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from rapidfuzz import process
from rapidfuzz.distance import Levenshtein

from .normalize import fold_phonetic

# Alignment scoring (per word). Match reward is 2*sim-1 in [-1, 1].
GAP_QUERY = -0.6   # ASR produced a word not in the reference (insertion)
GAP_REF = -0.6     # reference word not recited / not recognized (deletion)
MERGE_PENALTY = -0.2  # small cost so a real 1:1 match is preferred
CORRECT_SIM = 0.8  # similarity at or above which a word counts as recited correctly


@lru_cache(maxsize=200_000)
def word_sim(a: str, b: str) -> float:
    if a == b:
        return 1.0
    return Levenshtein.normalized_similarity(a, b)


@dataclass
class AlignOp:
    op: str            # "match" | "ins" (extra ASR word) | "del" (reference word skipped)
    qi: int | None     # query word index
    gidx: int | None   # reference global index
    sim: float = 0.0


@dataclass
class Alignment:
    start: int                 # first reference gidx covered
    end: int                   # last reference gidx covered (inclusive)
    score: float               # raw alignment score
    norm_score: float          # score / len(query), clipped to [0, 1]
    ops: list[AlignOp] = field(default_factory=list)


@dataclass
class Candidate:
    start: int
    end: int
    score: float
    verse_keys: list[str]


def align(query: list[str], ref: list[str], ref_offset: int) -> Alignment | None:
    """Semi-global alignment: the whole query, any contiguous span of ref.

    Returns None for empty input.
    """
    n, m = len(query), len(ref)
    if n == 0 or m == 0:
        return None
    # dp[i][j]: best score aligning query[:i] ending at ref position j (ref[:j]).
    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    bt = [[0] * (m + 1) for _ in range(n + 1)]  # 0=start, 1=diag, 2=up(ins), 3=left(del), 4=2:1 merge
    for i in range(1, n + 1):
        dp[i][0] = dp[i - 1][0] + GAP_QUERY
        bt[i][0] = 2
    # Row 0 stays 0: free start anywhere in ref.
    for i in range(1, n + 1):
        qi = query[i - 1]
        row, prev = dp[i], dp[i - 1]
        brow = bt[i]
        for j in range(1, m + 1):
            s = word_sim(qi, ref[j - 1])
            best, b = prev[j - 1] + (2 * s - 1), 1
            v = prev[j] + GAP_QUERY
            if v > best:
                best, b = v, 2
            v = row[j - 1] + GAP_REF
            if v > best:
                best, b = v, 3
            if i >= 2:
                # Two ASR words for one Mushaf word (e.g. "يا قوم" vs "ياقوم").
                s2 = word_sim(query[i - 2] + qi, ref[j - 1])
                v = dp[i - 2][j - 1] + 2 * (2 * s2 - 1) + MERGE_PENALTY
                if s2 > s and v > best:
                    best, b = v, 4
            row[j] = best
            brow[j] = b
    # Free end: best cell in the last row.
    j_end = max(range(1, m + 1), key=lambda j: dp[n][j])
    score = dp[n][j_end]

    ops: list[AlignOp] = []
    i, j = n, j_end
    while i > 0:
        b = bt[i][j]
        if b == 1:
            ops.append(AlignOp("match", i - 1, ref_offset + j - 1, word_sim(query[i - 1], ref[j - 1])))
            i, j = i - 1, j - 1
        elif b == 4:
            ops.append(AlignOp("match", i - 1, ref_offset + j - 1, word_sim(query[i - 2] + query[i - 1], ref[j - 1])))
            i, j = i - 2, j - 1
        elif b == 2:
            ops.append(AlignOp("ins", i - 1, None))
            i -= 1
        else:
            ops.append(AlignOp("del", None, ref_offset + j - 1))
            j -= 1
    ops.reverse()
    # Trim leading/trailing deletions (they are free span boundaries, not skips).
    while ops and ops[0].op == "del":
        ops.pop(0)
    while ops and ops[-1].op == "del":
        ops.pop()
    covered = [o.gidx for o in ops if o.gidx is not None]
    if not covered:
        return None
    return Alignment(covered[0], covered[-1], score, max(0.0, min(1.0, score / n)), ops)


class QuranIndex:
    def __init__(self, db_path: str | Path, fold: bool = False):
        # When fold=True, matching runs on phonetically-folded words (ASR confusions
        # like ث/ت/ط collapse). Display never uses these; the server returns ids.
        self._fold = fold
        db = sqlite3.connect(str(db_path))
        rows = db.execute(
            "SELECT gidx, id, norm, verse_key, page, line, surah, ayah, position "
            "FROM words WHERE gidx IS NOT NULL ORDER BY gidx"
        ).fetchall()
        db.close()
        self.norm: list[str] = [self.fold_word(r[2]) for r in rows]
        self.word_id: list[int] = [r[1] for r in rows]
        self.verse_key: list[str] = [r[3] for r in rows]
        self.page: list[int] = [r[4] for r in rows]
        self.line: list[int] = [r[5] for r in rows]
        self.surah: list[int] = [r[6] for r in rows]
        self.ayah: list[int] = [r[7] for r in rows]
        self.position: list[int] = [r[8] for r in rows]
        self.size = len(rows)

        self.verse_start: dict[str, int] = {}
        for g, vk in enumerate(self.verse_key):
            self.verse_start.setdefault(vk, g)

        self._bigrams: dict[tuple[str, str], list[int]] = defaultdict(list)
        self._unigrams: dict[str, list[int]] = defaultdict(list)
        for g in range(self.size):
            self._unigrams[self.norm[g]].append(g)
            if g + 1 < self.size:
                self._bigrams[(self.norm[g], self.norm[g + 1])].append(g)
        self._vocab: list[str] = list(self._unigrams.keys())

    def fold_word(self, w: str) -> str:
        return fold_phonetic(w) if self._fold else w

    def fold(self, words: list[str]) -> list[str]:
        return [self.fold_word(w) for w in words] if self._fold else words

    # ------------------------------------------------------------------ search
    def _vote(self, query: list[str]) -> dict[int, float]:
        votes: dict[int, float] = defaultdict(float)
        n_total = self.size
        for i in range(len(query) - 1):
            hits = self._bigrams.get((query[i], query[i + 1]))
            if not hits or len(hits) > 3000:
                continue
            w = math.log(n_total / len(hits))
            for g in hits:
                votes[g - i] += w
        # Rare unigrams help when ASR breaks every bigram.
        for i, q in enumerate(query):
            hits = self._unigrams.get(q)
            if not hits or len(hits) > 200:
                continue
            w = 0.5 * math.log(n_total / len(hits))
            for g in hits:
                votes[g - i] += w
        # Words the ASR misspelled (not in the Quran vocabulary): vote with the
        # closest vocabulary words instead, weighted by similarity.
        for i, q in enumerate(query):
            if q in self._unigrams:
                continue
            for cand, sim, _ in process.extract(q, self._vocab, scorer=Levenshtein.normalized_similarity,
                                                limit=3, score_cutoff=0.7):
                hits = self._unigrams[cand]
                if len(hits) > 200:
                    continue
                w = 0.5 * sim * math.log(n_total / len(hits))
                for g in hits:
                    votes[g - i] += w
        return votes

    def search(self, query: list[str], top_k: int = 5, n_candidates: int = 40) -> list[Candidate]:
        """Find where in the Quran `query` (normalized words) was recited."""
        if not query:
            return []
        query = self.fold(query)
        votes = self._vote(query)
        # Cluster nearby offsets (insertions/deletions shift the offset a little).
        ranked = sorted(votes.items(), key=lambda kv: -kv[1])
        offsets: list[int] = []
        for off, _ in ranked:
            if all(abs(off - o) > 3 for o in offsets):
                offsets.append(off)
            if len(offsets) >= n_candidates:
                break
        results: list[Candidate] = []
        slack = max(4, len(query) // 2)
        for off in offsets:
            lo = max(0, off - slack)
            hi = min(self.size, off + len(query) + slack)
            a = align(query, self.norm[lo:hi], lo)
            if a is None:
                continue
            results.append(Candidate(a.start, a.end, a.norm_score, self.verse_keys(a.start, a.end)))
        # De-duplicate overlapping spans, keep best.
        results.sort(key=lambda c: -c.score)
        unique: list[Candidate] = []
        for c in results:
            if all(c.end < u.start - 2 or c.start > u.end + 2 for u in unique):
                unique.append(c)
            if len(unique) >= top_k:
                break
        return unique

    # ----------------------------------------------------------------- helpers
    def verse_keys(self, start: int, end: int) -> list[str]:
        keys: list[str] = []
        for g in range(start, end + 1):
            vk = self.verse_key[g]
            if not keys or keys[-1] != vk:
                keys.append(vk)
        return keys

    def word_info(self, g: int) -> dict:
        return {
            "gidx": g,
            "word_id": self.word_id[g],
            "verse_key": self.verse_key[g],
            "page": self.page[g],
            "line": self.line[g],
            "position": self.position[g],
        }
