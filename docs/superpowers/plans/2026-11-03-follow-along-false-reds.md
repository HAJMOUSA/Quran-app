# Follow-along False Reds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop correctly-recited words from being painted red in live follow-along by folding the ASR query consistently with the reference in the tracking path, on both the server and the mobile port.

**Architecture:** The green/red decision is per-word Levenshtein similarity against a `CORRECT_SIM = 0.8` gate. A `fold_phonetic` map (ص→س, ط/ث→ت, ذ/ظ→ز, ض→د, ق→ك, ح→ه) already exists to absorb ASR consonant confusions, but the tracker compares an **unfolded** ASR query against a (sometimes folded) reference. We fold the query once at the top of `Tracker.update()` on both ports, and build the server's live index folded so folding is actually active at runtime. `CORRECT_SIM` is unchanged; display is unaffected (always word ids / unfolded text).

**Tech Stack:** Python (faster-whisper, pytest) on the server; TypeScript (React Native, jest run via bun) on mobile.

**Shared reference example (used in tests both ports):** Al-Fatiha 1:6 «اهدنا الصراط المستقيم». With folding on, the reference word «الصراط» is stored as «السرات» and «المستقيم» as «المستكيم». A reciter saying «الصراط» correctly produces ASR text «الصراط»; compared raw against the folded reference «السرات» the similarity is 0.667 < 0.8 → wrongly red. Folding the query first makes «الصراط»→«السرات», matching exactly → correct.

---

### Task 1: Capture the baseline false-red number

No code change — record the current "correct %" so the fix is measured, not assumed.

**Files:** none (measurement only)

- [ ] **Step 1: Run the tracking eval on a professional recitation**

Run (from repo root; use the server's Python environment):
```bash
cd server && python scripts/eval_tracking.py --surah 112 --reciter 7 --max-seconds 120
```
Note: this downloads the Tarteel model (first run converts it to CTranslate2) and the surah audio, then streams it through the tracker. Requires network on first run.

Expected output includes a line like:
```
words scored: NN  correct XX.X% (professional recitation → anything else is a false mistake)
```
Record that `correct %` (e.g. in the PR description). On a flawless professional recitation this number *should* be ~100%; the gap below 100% is the false-red rate we are fixing.

- [ ] **Step 2: Also run surah 36 for a larger sample (optional but preferred)**

Run:
```bash
cd server && python scripts/eval_tracking.py --surah 36 --reciter 7 --max-seconds 180
```
Record the `correct %` line. Keep both numbers for the before/after comparison in Task 6.

---

### Task 2: Mobile — fold the query in the tracker (failing test first)

**Files:**
- Test: `mobile/src/match/match.test.ts` (append one test)
- Modify: `mobile/src/match/tracker.ts` (method `update`, around line 35)

- [ ] **Step 1: Write the failing test**

Append to `mobile/src/match/match.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run:
```bash
cd mobile && bun run test -- src/match/match.test.ts -t "folded reference"
```
Expected: FAIL — `tr.statuses.get(1)` is `"wrong"` (0.667 similarity because the raw query «الصراط» is compared against the folded reference «السرات»).

- [ ] **Step 3: Fold the query in `update`**

In `mobile/src/match/tracker.ts`, change the `update` method so the first line folds the incoming words:

```ts
  update(words: string[]): TrackerEvent {
    words = this.index.foldQuery(words);
    if (this.mode === "track") {
      const ev = this.track(words);
      if (ev !== null) return ev;
    }
    return this.search(words);
  }
```

(`search()` calls `this.index.search()`, which folds its query again; `foldPhonetic` is idempotent, so the double call is a no-op.)

- [ ] **Step 4: Run the test and confirm it passes**

Run:
```bash
cd mobile && bun run test -- src/match/match.test.ts -t "folded reference"
```
Expected: PASS.

- [ ] **Step 5: Run the full match suite to confirm no regressions**

Run:
```bash
cd mobile && bun run test -- src/match/match.test.ts
```
Expected: all tests PASS (the existing `Tracker locks, follows, and flags a wrong word` test uses a `fold=false` index, so `foldQuery` is a no-op there).

- [ ] **Step 6: Commit**

```bash
git add mobile/src/match/tracker.ts mobile/src/match/match.test.ts
git commit -m "fix(mobile): fold ASR query in tracker so correct words aren't flagged red"
```

---

### Task 3: Server — fold the query in the tracker (failing test first)

**Files:**
- Test: `server/tests/test_index.py` (append one test)
- Modify: `server/quran_server/tracker.py` (method `update`, lines 49-55)

- [ ] **Step 1: Write the failing test**

Append to `server/tests/test_index.py`:

```python
def test_tracker_folds_query_so_correct_recitation_stays_correct():
    if not DB.exists():
        pytest.skip("data/quran.db missing")
    idx = QuranIndex(DB, fold=True)            # folds reference: الصراط -> السرات
    s = idx.verse_start["1:6"]                 # اهدنا الصراط المستقيم
    tr = Tracker(idx, start_gidx=s)
    tr.update(["اهدنا", "الصراط", "المستقيم"])  # ASR output = correct orthography
    assert tr.state.statuses[s + 1] == "correct"  # الصراط; was "wrong" before the fix
```

- [ ] **Step 2: Run it and confirm it fails**

Run:
```bash
cd server && python -m pytest tests/test_index.py -k folds_query -v
```
Expected: FAIL — `statuses[s+1]` is `"wrong"` (raw «الصراط» vs folded «السرات» = 0.667).

- [ ] **Step 3: Fold the query in `update`**

In `server/quran_server/tracker.py`, change `update`:

```python
    def update(self, words: list[str]) -> dict:
        """Feed normalized words of the latest transcript window. Returns an event dict."""
        words = self.index.fold(words)
        if self.state.mode == "track":
            ev = self._track(words)
            if ev is not None:
                return ev
        return self._search(words)
```

(`_search` calls `self.index.search(words)`, which folds again; folding is idempotent. For a `fold=False` index, `self.index.fold(words)` returns `words` unchanged, so existing tests are unaffected.)

- [ ] **Step 4: Run the test and confirm it passes**

Run:
```bash
cd server && python -m pytest tests/test_index.py -k folds_query -v
```
Expected: PASS.

- [ ] **Step 5: Run the whole index/tracker test file**

Run:
```bash
cd server && python -m pytest tests/test_index.py -v
```
Expected: all PASS (existing tracker tests build `QuranIndex(DB)` with `fold=False`, so `fold()` is a no-op and behavior is unchanged).

- [ ] **Step 6: Commit**

```bash
git add server/quran_server/tracker.py server/tests/test_index.py
git commit -m "fix(server): fold ASR query in tracker so correct words aren't flagged red"
```

---

### Task 4: Server — build the live index folded

The tracker now folds the query, but the server's runtime index is still `fold=False`, so folding does nothing in production. Turn it on (matching what mobile already does).

**Files:**
- Modify: `server/quran_server/app.py:74`

- [ ] **Step 1: Enable folding on the live index**

In `server/quran_server/app.py`, change the index construction:

```python
    state["index"] = QuranIndex(DB_PATH, fold=True)
```

- [ ] **Step 2: Run the full server suite**

Run:
```bash
cd server && python -m pytest -v
```
Expected: all PASS. Pay attention to `tests/test_api.py` (the audio-search endpoint now runs on a folded index). If a search-audio assertion tightened on an exact unfolded string regresses, that is a real behavior change to review — folded search is how mobile already runs, so results should be equal or better. Do not loosen a test to make it pass without understanding why it moved.

- [ ] **Step 3: Commit**

```bash
git add server/quran_server/app.py
git commit -m "fix(server): run live follow-along index phonetically folded"
```

---

### Task 5: Mobile — confirm the runtime index is already folded

No change expected; this is a verification guard so the two ports stay in sync.

**Files:** none (read-only check)

- [ ] **Step 1: Confirm the loader default**

Open `mobile/src/match/loadIndex.ts` and confirm line 8 reads `export async function loadQuranIndex(fold = true)` and that follow-along calls it without overriding `fold`. If anything passes `fold=false` on the live path, change it to use the default `true` and note it in the commit. Otherwise, no commit.

---

### Task 6: Re-measure and record the improvement

**Files:** none (measurement only)

- [ ] **Step 1: Re-run the same evals as Task 1**

Run:
```bash
cd server && python scripts/eval_tracking.py --surah 112 --reciter 7 --max-seconds 120
cd server && python scripts/eval_tracking.py --surah 36 --reciter 7 --max-seconds 180
```
Expected: the `correct %` lines are **higher** than the Task 1 baseline (fewer false reds). Record before/after both surahs.

- [ ] **Step 2: Sanity-check false greens didn't balloon**

Inspect the `flagged` lines printed by the eval. The remaining flagged words should be genuine model errors, not correct recitation. If `correct %` jumped to a suspicious ~100% with obviously-wrong words now green, that signals folding is too lossy for the window — note it; the fallback (out of scope here) is a length-aware `CORRECT_SIM`.

- [ ] **Step 3: Record results in the branch**

Add the before/after numbers to the PR description (or a short note in the spec file) when opening the PR.

---

## Notes for the implementer

- The two trackers (`server/quran_server/tracker.py` and `mobile/src/match/tracker.ts`) are hand-ported mirrors of each other. The change must stay identical in spirit on both — fold the query once at the entry of `update()`.
- `foldPhonetic` / `fold_phonetic` is idempotent (there are existing tests asserting this), which is why folding at `update()` and again inside `search()` is safe.
- Nothing here touches the ASR model, decoding, or any training. If false reds persist after this change, the next lever (out of scope) is a length-aware `CORRECT_SIM`, not model work.
