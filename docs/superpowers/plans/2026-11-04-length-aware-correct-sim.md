# Length-aware CORRECT_SIM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce remaining follow-along false reds by allowing a single edit on words of length ≥ 4 when deciding correct-vs-wrong, while keeping the strict 0.8 gate for 2–3 letter words.

**Architecture:** A pure helper `word_correct(sim, ref_len)` / `wordCorrect(sim, refLen)` replaces the bare `op.sim >= CORRECT_SIM` check in each tracker. Threshold = `min(CORRECT_SIM, 1 − 1/refLen)` for `refLen ≥ 4`, else `CORRECT_SIM`. Mirrored on the Python server and the TypeScript mobile port. Folding preserves word length (1:1 char substitution), so the folded reference length is accurate.

**Tech Stack:** Python (pytest) on the server; TypeScript (React Native, jest via bun) on mobile.

**Threshold truth table (used in tests):** `(0.75,4)→true`, `(0.75,3)→false`, `(0.80,5)→true`, `(0.79,6)→false`, `(0.50,4)→false`.

---

### Task 1: Server — `word_correct` helper (failing test first)

**Files:**
- Modify: `server/quran_server/quran_index.py` (add next to `CORRECT_SIM`, line 25)
- Test: `server/tests/test_index.py` (append one test + extend imports)

- [ ] **Step 1: Write the failing test**

In `server/tests/test_index.py`, change the import line
`from quran_server.quran_index import QuranIndex` to
`from quran_server.quran_index import QuranIndex, word_correct`, then append:

```python
def test_word_correct_is_length_aware():
    assert word_correct(0.75, 4) is True    # 4-letter word, one edit → correct
    assert word_correct(0.75, 3) is False   # 3-letter word stays strict
    assert word_correct(0.80, 5) is True
    assert word_correct(0.79, 6) is False
    assert word_correct(0.50, 4) is False   # two edits on a 4-letter word
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd server && python -m pytest tests/test_index.py -k word_correct -v`
Expected: FAIL at import — `ImportError: cannot import name 'word_correct'`.

- [ ] **Step 3: Implement the helper**

In `server/quran_server/quran_index.py`, immediately after the line
`CORRECT_SIM = 0.8  # similarity at or above which a word counts as recited correctly`
add:

```python
MIN_LEN_FOR_EDIT = 4  # words this long or longer may differ by one edit and still count correct


def word_correct(sim: float, ref_len: int) -> bool:
    """Whether a matched word counts as correctly recited.

    For words of length >= MIN_LEN_FOR_EDIT, allow a single edit
    (sim >= 1 - 1/ref_len); shorter words still require full CORRECT_SIM, where
    one edit is too large a share of the word and Arabic has many minimal pairs.
    """
    threshold = min(CORRECT_SIM, 1.0 - 1.0 / ref_len) if ref_len >= MIN_LEN_FOR_EDIT else CORRECT_SIM
    return sim >= threshold
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd server && python -m pytest tests/test_index.py -k word_correct -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/quran_server/quran_index.py server/tests/test_index.py
git commit -m "feat(server): length-aware word_correct helper for correctness gate"
```

---

### Task 2: Server — use `word_correct` in the tracker (failing test first)

**Files:**
- Modify: `server/quran_server/tracker.py` (import line 12; match branch lines 101-104)
- Test: `server/tests/test_index.py` (append one test)

- [ ] **Step 1: Write the failing test**

Append to `server/tests/test_index.py`:

```python
def test_tracker_accepts_four_letter_word_with_single_slip():
    if not DB.exists():
        pytest.skip("data/quran.db missing")
    idx = QuranIndex(DB, fold=True)
    s = idx.verse_start["1:5"]                     # اياك نعبد واياك نستعين
    tr = Tracker(idx, start_gidx=s)
    # "نعبد" (4 letters) recited as "يعبد" — a single non-folding slip (ن→ي).
    tr.update(["اياك", "يعبد", "واياك", "نستعين"])
    assert tr.state.statuses[s + 1] == "correct"   # was "wrong" at the 0.8 gate (sim 0.75)
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd server && python -m pytest tests/test_index.py -k four_letter -v`
Expected: FAIL — `statuses[s+1]` is `"wrong"` (sim 0.75 < 0.8).

- [ ] **Step 3: Wire the tracker to the helper**

In `server/quran_server/tracker.py`, change the import on line 12 from
`from .quran_index import CORRECT_SIM, QuranIndex, align` to
`from .quran_index import QuranIndex, align, word_correct`.

Then in `_track`, replace the match branch (currently):

```python
            if op.op == "match" and op.sim >= CORRECT_SIM:
                new = "correct"
            elif op.op == "match":
                new = "wrong"
```

with:

```python
            if op.op == "match" and word_correct(op.sim, len(self.index.norm[g])):
                new = "correct"
            elif op.op == "match":
                new = "wrong"
```

(`g = op.gidx` is already assigned just above; `self.index.norm[g]` is the folded
reference word, whose length equals the original since folding is 1:1. `CORRECT_SIM`
is no longer referenced in this file.)

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd server && python -m pytest tests/test_index.py -k four_letter -v`
Expected: PASS.

- [ ] **Step 5: Run the whole index/tracker file (no regressions)**

Run: `cd server && python -m pytest tests/test_index.py -v`
Expected: all PASS — including `test_tracker_flags_skipped_and_wrong_words` (the
wrong word there is `"زززز"`, sim far below any threshold, still `"wrong"`).

- [ ] **Step 6: Commit**

```bash
git add server/quran_server/tracker.py server/tests/test_index.py
git commit -m "fix(server): length-aware correctness gate in tracker"
```

---

### Task 3: Mobile — `wordCorrect` helper (failing test first)

**Files:**
- Modify: `mobile/src/match/align.ts` (add next to `CORRECT_SIM`, line 7)
- Test: `mobile/src/match/match.test.ts` (extend imports + append one test)

- [ ] **Step 1: Write the failing test**

In `mobile/src/match/match.test.ts`, change the import
`import { align, wordSim, CORRECT_SIM } from "./align";` to
`import { align, wordSim, CORRECT_SIM, wordCorrect } from "./align";`, then append:

```ts
test("wordCorrect allows one edit on words >= 4 letters, strict below", () => {
  expect(wordCorrect(0.75, 4)).toBe(true);
  expect(wordCorrect(0.75, 3)).toBe(false);
  expect(wordCorrect(0.80, 5)).toBe(true);
  expect(wordCorrect(0.79, 6)).toBe(false);
  expect(wordCorrect(0.5, 4)).toBe(false);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd mobile && bun run test -- src/match/match.test.ts -t "wordCorrect"`
Expected: FAIL — `wordCorrect` is not exported (TypeScript/runtime error).

- [ ] **Step 3: Implement the helper**

In `mobile/src/match/align.ts`, immediately after the line
`export const CORRECT_SIM = 0.8;  // similarity at/above which a word counts as correct`
add:

```ts
export const MIN_LEN_FOR_EDIT = 4; // words this long+ may differ by one edit and still count correct

// Whether a matched word counts as correctly recited. For words >= MIN_LEN_FOR_EDIT,
// allow one edit (sim >= 1 - 1/refLen); shorter words need full CORRECT_SIM.
export function wordCorrect(sim: number, refLen: number): boolean {
  const threshold = refLen >= MIN_LEN_FOR_EDIT ? Math.min(CORRECT_SIM, 1 - 1 / refLen) : CORRECT_SIM;
  return sim >= threshold;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd mobile && bun run test -- src/match/match.test.ts -t "wordCorrect"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/match/align.ts mobile/src/match/match.test.ts
git commit -m "feat(mobile): length-aware wordCorrect helper for correctness gate"
```

---

### Task 4: Mobile — use `wordCorrect` in the tracker (failing test first)

**Files:**
- Modify: `mobile/src/match/tracker.ts` (import line 3; match branch line 77)
- Test: `mobile/src/match/match.test.ts` (append one test)

- [ ] **Step 1: Write the failing test**

Append to `mobile/src/match/match.test.ts`:

```ts
// A 4-letter word recited with a single non-folding slip must stay green.
const lenRows: IndexRow[] = ["اياك", "نعبد", "واياك", "نستعين"].map((w, g) => ({
  gidx: g, wordId: 300 + g, norm: w,
  verseKey: "1:5", page: 1, line: 1, surah: 1, ayah: 5, position: g + 1,
}));

test("Tracker accepts a 4-letter word recited with a single slip", () => {
  const index = new QuranIndex(lenRows, false);
  const tr = new Tracker(index, 1);                     // lock on نعبد (gidx 1)
  tr.update(["اياك", "يعبد", "واياك", "نستعين"]);         // نعبد heard as يعبد (ن→ي, sim 0.75)
  expect(tr.statuses.get(1)).toBe("correct");           // was "wrong" at the 0.8 gate
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd mobile && bun run test -- src/match/match.test.ts -t "single slip"`
Expected: FAIL — `tr.statuses.get(1)` is `"wrong"` (sim 0.75 < 0.8).

- [ ] **Step 3: Wire the tracker to the helper**

In `mobile/src/match/tracker.ts`, change the import on line 3 from
`import { align, CORRECT_SIM } from "./align";` to
`import { align, wordCorrect } from "./align";`.

Then change the match branch (line 77) from:

```ts
      if (op.op === "match" && op.sim >= CORRECT_SIM) next = "correct";
```

to:

```ts
      if (op.op === "match" && wordCorrect(op.sim, this.index.norm[g].length)) next = "correct";
```

(`const g = op.gidx;` is already in scope just above; `this.index.norm[g]` is the
folded reference word. `CORRECT_SIM` is no longer referenced in this file.)

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd mobile && bun run test -- src/match/match.test.ts -t "single slip"`
Expected: PASS.

- [ ] **Step 5: Run the full match suite (no regressions)**

Run: `cd mobile && bun run test -- src/match/match.test.ts`
Expected: all PASS — including the existing "flags a wrong word" test (`"ZZ"` vs
`"gg"`, sim 0 → still `"wrong"`).

- [ ] **Step 6: Commit**

```bash
git add mobile/src/match/tracker.ts mobile/src/match/match.test.ts
git commit -m "fix(mobile): length-aware correctness gate in tracker"
```

---

### Task 5: Full-suite verification (both ports)

**Files:** none (verification)

- [ ] **Step 1: Server suite green**

Run: `cd server && python -m pytest -q`
Expected: all PASS (prior count was 23; now +2 new tests → 25).

- [ ] **Step 2: Mobile match suite green**

Run: `cd mobile && bun run test -- src/match/match.test.ts`
Expected: all PASS.

---

### Task 6: Merge to main and push

**Files:** none (git)

- [ ] **Step 1: Merge the branch to main**

```bash
cd c:/Repo/quran-app
git checkout main
git merge --no-ff fix/length-aware-correct-sim -m "Merge fix/length-aware-correct-sim: allow one edit on 4+ letter words"
```

- [ ] **Step 2: Verify merged main, then push**

```bash
cd server && python -m pytest -q    # expect all PASS on merged main
cd c:/Repo/quran-app && git push origin main
git branch -d fix/length-aware-correct-sim
```

---

### Task 7: Redeploy the recognition server

Follow the deploy procedure (box: `hajmousa@192.168.100.200`, SSH key `~/.ssh/id_ed25519`; container `quran-server`; code is baked into the image, so rebuild + recreate — a restart keeps old code).

**Files:** none (ops)

- [ ] **Step 1: Pull on the box**

```bash
ssh -o BatchMode=yes -i ~/.ssh/id_ed25519 hajmousa@192.168.100.200 'bash -lc "cd ~/quran-app && git pull --ff-only && git log --oneline -1"'
```
Expected: box HEAD is the new merge commit.

- [ ] **Step 2: Rebuild the image**

```bash
ssh -o BatchMode=yes -i ~/.ssh/id_ed25519 hajmousa@192.168.100.200 'bash -lc "cd ~/quran-app && docker build -t quran-server -f server/Dockerfile . 2>&1 | tail -5"'
```
Expected: `Successfully tagged quran-server:latest`.

- [ ] **Step 3: Recreate the container (preserve token/env/mounts)**

```bash
ssh -o BatchMode=yes -i ~/.ssh/id_ed25519 hajmousa@192.168.100.200 'bash -lc "
set -e
TOKEN=\$(docker inspect quran-server --format \"{{range .Config.Env}}{{println .}}{{end}}\" | sed -n \"s/^QURAN_API_TOKEN=//p\")
docker stop quran-server && docker rm quran-server
docker run -d --name quran-server --restart unless-stopped -p 8000:8000 \
  -e QURAN_ASR_MODEL=tarteel-ai/whisper-base-ar-quran -e QURAN_COMPUTE_TYPE=int8 \
  -e QURAN_API_TOKEN=\"\$TOKEN\" \
  -v \$HOME/quran-app/data:/data -v quran-hf-cache:/cache/hf quran-server
sleep 3; docker ps --filter name=quran-server --format \"{{.Status}}\"
"'
```
Expected: container `Up` a few seconds.

- [ ] **Step 4: Verify health + fix present**

```bash
ssh -o BatchMode=yes -i ~/.ssh/id_ed25519 hajmousa@192.168.100.200 'bash -lc "
curl -s -o /dev/null -w \"health HTTP %{http_code}\n\" http://localhost:8000/api/health
docker exec quran-server grep -c \"def word_correct\" quran_server/quran_index.py
curl -sk --resolve quran.hajmousa.com:8443:127.0.0.1 -o /dev/null -w \"caddy HTTP %{http_code}\n\" https://quran.hajmousa.com:8443/api/health
"'
```
Expected: `health HTTP 200`, helper count `1`, `caddy HTTP 200`.

---

### Task 8: Rebuild and install the app

**Files:** none (ops)

- [ ] **Step 1: Build + install the release APK on the S24**

```bash
cd c:/Repo/quran-app/mobile/android && ./gradlew installRelease 2>&1 | tail -6
```
Expected: `BUILD SUCCESSFUL`, `Installed on 1 device.` If multiple adb devices are
listed, the build still targets the connected S24 (`R5CX327XC5L`); if install fails
with "more than one device", run `adb -s R5CX327XC5L install -r android/app/build/outputs/apk/release/app-release.apk`.

- [ ] **Step 2: Confirm install**

```bash
adb -s R5CX327XC5L shell dumpsys package com.kelarev.mobile | grep -E "versionName|lastUpdateTime" | head -2
```
Expected: a fresh `lastUpdateTime`.

---

### Task 9: Measure (user-run, optional)

**Files:** none

- [ ] **Step 1: Before/after eval**

The eval downloads the model + audio and runs CPU inference (minutes). Run on a
machine with the server env:

```bash
cd server && python scripts/eval_tracking.py --surah 36 --reciter 7 --max-seconds 180
```
Compare the `correct %` line against the pre-change baseline; inspect the `flagged`
list to confirm false greens did not balloon (remaining flags should be genuine
model errors, not correct recitation).

---

## Notes for the implementer
- The two trackers are hand-ported mirrors; keep the helper and call site identical in spirit on both.
- `CORRECT_SIM` stays `0.8` and is still exported (other code/tests import it); only the *decision* becomes length-aware.
- Do not loosen the threshold for words < 4 letters — that is explicitly out of scope and raises false greens on minimal pairs.
