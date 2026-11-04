# Length-aware correctness threshold (reduce follow-along false reds)

**Date:** 2026-11-04
**Status:** approved (design)

## Problem

After the phonetic-folding fix ([[2026-11-03-follow-along-false-reds-design]]),
some correctly-recited words still turn red. A matched word is marked `"correct"`
only when normalized Levenshtein similarity `sim ≥ CORRECT_SIM = 0.8`
(`server/quran_server/tracker.py` match branch, `mobile/src/match/tracker.ts`).

For a word of length L, a single character difference gives `sim = 1 − 1/L`:

| L | sim after 1 edit | verdict at 0.8 |
|---|---|---|
| 2 | 0.50 | red |
| 3 | 0.67 | red |
| 4 | 0.75 | **red** ← dominant remaining false red |
| 5 | 0.80 | green (already) |
| 6+ | ≥0.83 | green (already) |

So the main remaining false red is a **4-letter word with one residual
(non-foldable) ASR slip**. Words of 5+ letters already pass on a single edit.

## Change

Make the correctness threshold length-aware: allow exactly one edit on words of
length ≥ 4, keep the strict 0.8 gate for shorter words (2–3 letters, where one
edit is half the word and Arabic has many minimal pairs like من/عن, قل/كل).

Expressed as a threshold so it drops into the existing `sim ≥ …` comparison:

```
threshold(L) = min(CORRECT_SIM, 1 − 1/L)   for L ≥ MIN_LEN_FOR_EDIT (4)
             = CORRECT_SIM                   for L < 4
word_correct(sim, L) := sim ≥ threshold(L)
```

Properties: L=4 → 0.75; L=5 → 0.80; L≥6 → 0.80 (never looser than one edit, never
stricter than today); L≤3 → 0.80 (unchanged). Folding preserves word length (1:1
char substitution), so the reference-word length on the folded index is accurate.

### Server (`server/quran_server`)
- `quran_index.py`: add `MIN_LEN_FOR_EDIT = 4` next to `CORRECT_SIM`, and a pure
  helper `word_correct(sim: float, ref_len: int) -> bool` implementing the above.
- `tracker.py`: in `_track`, change the match-correct decision from
  `op.sim >= CORRECT_SIM` to `word_correct(op.sim, len(self.index.norm[op.gidx]))`.
  Nothing else (alignment, merge handling, status transitions) changes.

### Mobile (`mobile/src/match`)
- `align.ts`: mirror `MIN_LEN_FOR_EDIT` and `wordCorrect(sim, refLen)` next to
  `CORRECT_SIM`.
- `tracker.ts`: change `op.sim >= CORRECT_SIM` to
  `wordCorrect(op.sim, this.index.norm[op.gidx].length)`.

## Verification
- Unit tests on the helper, both ports: `(0.75,4)→true`, `(0.75,3)→false`,
  `(0.80,5)→true`, `(0.79,6)→false`, `(0.50,4)→false`.
- Tracker regression, both ports: a 4-letter correctly-recited word with one
  residual slip returns `"correct"`; a genuinely wrong 2–3 letter word stays
  `"wrong"` (false-green guard).
- `scripts/eval_tracking.py` before/after — `correct %` should rise; inspect the
  `flagged` list to confirm false greens didn't balloon.

## Rollout
Land on both ports with tests → redeploy the server (push → pull → rebuild →
recreate, see [[quran-server-deploy]]) → rebuild + reinstall the app.

## Risk
Slightly more lenient on 4-letter words → small false-green possibility, bounded
because leniency is capped at exactly one edit and only for length ≥ 4, and
measured against the eval harness rather than assumed.

## Out of scope
- Any change for words of length ≤ 3, or multi-edit leniency on long words
  (approaches B and C, rejected during brainstorming).
- Model / training / decoding changes.
