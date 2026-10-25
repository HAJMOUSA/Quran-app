# Quran Reader & Reciter — Design

Free, personal, non-commercial iOS/Android app for **reading**, **memorizing** and
**reciting** the Quran, with an AI "follow-along" that listens to the reciter and
finds/highlights the current position on the Mushaf page. Inspired by Tarteel.

Decisions (2026-10-24): React Native (Expo, TypeScript) · speech recognition on a
server first (on-device later) · free personal project · UI in Arabic + English.

---

## 1. Feature set (learned from Tarteel)

| Area | Feature | Phase |
|---|---|---|
| Read | 604-page Madani Mushaf, surah / juz / page navigation, bookmarks, last position | 1 |
| Read | Text search (diacritic-insensitive), translation per ayah | 1 |
| Listen | Reciter playback per surah, word-level highlight from timing segments, ayah repeat | 2 |
| Search | "Recite to search": record 3–10 s, server returns matching ayat | 3 |
| Follow | Live follow-along: streaming mic → server → live word highlight, auto page turn | 4 |
| Memorize | Hidden-text mode (words reveal as recited), mistake marks (missed/wrong word) | 5 |
| Memorize | Spaced-repetition review schedule per page, progress heat-map, streaks | 5 |
| Platform | On-device ASR (whisper.cpp / sherpa-onnx), offline follow-along | 6 |

## 2. Data sources

| Source | Used for | Notes |
|---|---|---|
| Quran.com API v4 (`api.quran.com/api/v4`) | Uthmani text, simple (imlaei) text, word list with **page + line** numbers, juz/hizb, translations | Pulled once by `server/scripts/build_quran_db.py` into SQLite |
| Quran.com QDC audio (`api.qurancdn.com/api/qdc/audio/reciters/{id}/audio_files?chapter=N&segments=true`) | Per-surah MP3 + per-word timestamps | Drives listening highlight **and** evaluation ground truth |
| EveryAyah.com | Per-ayah MP3s from many reciters | ASR evaluation clips |
| Tarteel `tarteel-ai/whisper-base-ar-quran` / `whisper-tiny-ar-quran` | Quran-tuned Whisper ASR | Apache-2.0 |
| Amiri Quran font (OFL) | Mushaf text rendering in the app | Upgrade path: QPC V2 per-page glyph fonts from QUL |

The Quran text is never modified; normalization (below) is applied only to a
*separate* matching column.

## 3. System architecture

```
┌──────────── Mobile app (Expo RN) ────────────┐        ┌────────── Server (FastAPI) ──────────┐
│ Mushaf pages  ← quran.db (bundled SQLite)    │        │ quran.db  →  QuranIndex (n-gram)     │
│ Listen (expo-audio + QDC segments)           │  REST  │ /api/search/text   (text → ayat)     │
│ Recite-to-search  (record clip) ─────────────┼───────►│ /api/search/audio  (clip → ASR → ayat)│
│ Follow-along (PCM16 16 kHz stream) ──────────┼──WS───►│ /ws/recite  StreamingSession:         │
│   ◄── {position, word statuses, candidates} ─┼────────│   rolling buffer → Whisper → Tracker │
│ Memorization (hide / reveal, SRS) user.db    │        │ Whisper (tarteel-ai, GPU if present) │
└──────────────────────────────────────────────┘        └──────────────────────────────────────┘
```

### 3.1 Quran database (`quran.db`)

```
surahs(id, name_arabic, name_simple, name_translated, revelation_place, verses_count, first_page)
verses(id, verse_key, surah, ayah, page, juz, hizb, text_uthmani, text_simple, translation_en)
words(id, verse_id, verse_key, surah, ayah, position, page, line, char_type,
      text_uthmani, text_simple, norm, gidx)   -- gidx = global index of recitable words (0..~77.4k), NULL for ayah-end markers
```

One file is shared by the server (index) and the app (rendering), so word ids /
global indices returned by the server map 1:1 to words drawn on screen.

### 3.2 Arabic normalization (matching only)

Strip tashkeel (U+064B–U+065F, U+0670, U+06D6–U+06ED), tatweel; unify
`أ إ آ ٱ → ا`, `ى → ي`, `ة → ه`, `ؤ → و`, `ئ → ي`; drop non-Arabic chars. Applied
identically to Quran words and ASR output.

## 4. Locating the reciter (the core problem)

Key insight: this is **constrained search over a known ~77,400-word text**, not
open-vocabulary recognition. ASR only needs to be good enough to find and follow.

**Mode A — Search (position unknown)**
1. Normalize ASR words.
2. Candidate generation: inverted index of word **bigrams** (and unigrams of rare
   words) → each hit votes for a start offset `gidx - i`; keep the top-K offsets.
3. Verification: semi-global word alignment (query fully aligned, free ends on the
   reference) with fuzzy word similarity (char-level Levenshtein ratio); score
   normalized to 0..1.
4. Rank; confidence = best score and margin over the best *different* location.
   Repeated phrases (e.g. «فبأي آلاء ربكما تكذبان» ×31) produce near-ties → app
   shows top candidates and the server keeps listening until the margin opens.

**Mode B — Track (position locked)**
1. Every hop (~1 s) the server transcribes the trailing audio window (≤ 8 s).
2. The transcript is aligned against a reference window around the current
   position (`pos-30 … pos+40`).
3. Position advances to the end of the aligned span; each reference word gets a
   status: `correct` (similarity ≥ 0.8), `wrong` (aligned but dissimilar),
   `missed` (passed over without a match).
4. Poor alignment for N consecutive hops → **lost** → back to Mode A using the
   recent transcript. Big jumps (reciter skipped ahead) are caught the same way.

**Streaming ASR on Whisper** (not natively streaming): rolling 16 kHz buffer,
energy-based VAD gate (no transcription on silence → avoids Whisper
hallucinations), hop 1 s, window ≤ 8 s. Optional decoder prompt with the expected
upcoming text in tracking mode (off by default; evaluated in Phase 0).

## 5. Mobile app structure

```
mobile/
  App.tsx                       navigation container (tabs + stack), RTL-aware
  src/db/quranDb.ts             open bundled quran.db (expo-sqlite), queries
  src/db/userStore.ts           zustand + AsyncStorage: bookmarks, last page, settings, SRS, progress
  src/i18n.ts                   ar / en strings
  src/api/server.ts             REST client (search text/audio)
  src/api/reciteSocket.ts       WebSocket client for follow-along
  src/audio/micStream.ts        PCM16 16 kHz mic streaming
  src/components/MushafPage.tsx renders one page line-by-line, per-word styling (highlight/hidden/mistake)
  src/screens/                  Home, Mushaf, Search, Recite, Listen, Memorize, Settings
  src/memorize/srs.ts           SM-2 scheduler
```

## 6. Memorization model

- Unit = Mushaf page (also usable per surah).
- Each recitation session on a page produces a grade 0–5 from the mistake rate
  (`correct / total` words) → SM-2 updates `{ease, interval, due}`.
- Hidden-text mode: words render invisible (placeholder) until the tracker marks
  them `correct`; `wrong`/`missed` words reveal in red.

## 7. Evaluation (Phase 0 gate)

`server/scripts/eval_search.py`: random ayat × several reciters (EveryAyah), take
a 3–8 s excerpt, ASR → search. Metrics: top-1 / top-3 verse accuracy, latency.
`server/scripts/eval_tracking.py`: stream a whole surah (QDC audio) in real time
through `StreamingSession`, compare reported position with ground-truth word
timestamps: tracking accuracy, lag, false mistake rate.

## 8. Risks

| Risk | Mitigation |
|---|---|
| ASR errors on non-professional / children's voices | Fuzzy alignment; later fine-tune on own recordings |
| Whisper latency on CPU | GPU server; tiny model; hop/window tuning; on-device in Phase 6 |
| Repeated phrases → wrong location | Margin-based confidence, locality prior while tracking |
| Mic streaming library compatibility (RN new architecture) | Isolated in `micStream.ts`; Expo dev build |
| Religious accuracy | Unmodified certified text; mistake flags are hints, not rulings |
