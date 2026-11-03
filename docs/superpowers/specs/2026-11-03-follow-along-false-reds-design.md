# Follow-along false reds: consistent phonetic folding in the tracking path

**Date:** 2026-11-03
**Status:** approved (design)

## Problem

In live follow-along, correctly-recited words are frequently painted red
(`"wrong"`). The symptom is reported as common ("happens a lot").

A word is marked `"wrong"` when the aligner matches it to the right reference
slot but the per-word Levenshtein similarity is below `CORRECT_SIM = 0.8`
(`server/quran_server/tracker.py:101-104`, `mobile/src/match/align.ts:7`). The
similarity is computed on normalized words. Two causes make it fire on correct
recitation:

1. **Phonetic folding is applied inconsistently in the tracking path.** The
   `fold_phonetic` map (ص→س, ط/ث→ت, ذ/ظ→ز, ض→د, ق→ك, ح→ه) exists to absorb the
   consonant confusions Arabic ASR routinely makes, but:
   - **Device:** the index is built folded (`loadIndex.ts:8`, `fold=true`) yet
     the tracker aligns the **raw, unfolded** ASR query against the folded
     reference (`tracker.ts:63`). Only `search()` folds its query
     (`quranIndex.ts:89`); the tracker never does. A perfectly recited «الصراط»
     is compared against folded «السرات» → sim ≈ 0.67 → red on a flawless
     recitation. This is an outright bug.
   - **Server:** the live index is built `fold=False` (`app.py:74`), so folding
     is off entirely in tracking and any phonetic ASR slip drops a correct word
     below 0.8 → red.

2. (Noted, not addressed in this change) `CORRECT_SIM = 0.8` is harsh for short
   words; deferred until we measure whether folding alone is enough.

The model itself is not the problem; per-voice fine-tuning would not fix this.

## Change

Fold the ASR query the same way the reference is folded, everywhere the tracker
runs, so the green/red decision happens in folded space. `CORRECT_SIM` stays
0.8. Display is unaffected (always uses word ids / unfolded text).

### Server (`server/quran_server`)
- `app.py`: build the live index as `QuranIndex(DB_PATH, fold=True)`.
- `tracker.py`: in `update()`, fold the incoming `words` once via
  `self.index.fold(words)` before `_track`/`_search`. `search()` folds
  internally and folding is idempotent, so double-folding is safe. `align()`
  then compares folded query vs folded reference; `op.sim` (and thus the
  `CORRECT_SIM` gate) runs in folded space.

### Mobile (`mobile/src/match`)
- Index is already `fold=true`; only the query side is missing.
- `tracker.ts`: in `update()`, fold the incoming `words` via
  `this.index.foldQuery(words)` before `track`/`search`.

## Verification
- Unit tests, both ports: a correctly-recited word whose ASR output differs only
  by a folded consonant (e.g. «الصراط» → «السراط») returns `"correct"`.
  (server `test_tracker`, mobile `match.test.ts`).
- `scripts/eval_tracking.py` on a professional recitation **before and after** —
  "correct %" (anything else is a false mistake) is the false-red metric. Record
  the baseline before changing code.

## Risk
Folding is slightly lossy (distinct words may fold together), marginally raising
false greens. The device already runs fully folded for search at ~99% top-1, and
the tracking window is small (±30/40 words), so collision risk is low. Measured,
not assumed, via the eval harness.

## Out of scope
- Changing `CORRECT_SIM` or adding a length-aware threshold (revisit only if
  reds persist after folding is consistent).
- Any model/training/fine-tuning work.
