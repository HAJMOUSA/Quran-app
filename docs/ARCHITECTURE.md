# Quran Reader & Reciter — Architecture & Technical Documentation

A mobile Qur'an application that renders the authentic Madani Muṣḥaf, plays
reciters with live word highlighting, and — its distinguishing feature — uses
**speech recognition to follow a user's recitation in real time**, tracking their
place word‑by‑word, flagging mistakes, and driving spaced‑repetition
memorization.

This document explains the system structure, the technologies used, the core
recognition/tracking algorithm, and how everything is deployed. For *setup*
instructions see [README.md](../README.md); this file is the *why* and *how*.

---

## 1. What the app does (feature areas)

| Area | What it does | Needs the server? |
|---|---|---|
| **Muṣḥaf reader** | Page‑accurate Madani muṣḥaf, per‑page QCF2 fonts, RTL paging | No |
| **Reciter audio** | Streams a reciter, highlights the current word from timing data | No (uses Quran.com CDN) |
| **Recite‑to‑search** | Record a few words → server ASR → jump to the ayah | Yes |
| **Live follow‑along** | Stream the mic → server tracks your place word‑by‑word, marks mistakes, turns pages | Yes (or on‑device) |
| **Memorization** | Hidden‑text mode; words reveal as recited; SM‑2 spaced repetition | Yes (reveal uses the tracker) |
| **Offline ASR** | On‑device Whisper (whisper.rn) so follow‑along works with no server | No (after model download) |

The app and the recognition server are **two deployables** sharing one piece of
data (`quran.db`) and one matching algorithm (implemented twice — Python on the
server, TypeScript on the device).

---

## 2. Repository layout

```
quran-app/
├─ mobile/                 React Native (Expo, TypeScript) app
│  ├─ src/
│  │  ├─ app/              Expo Router file-based routes
│  │  │  ├─ _layout.tsx        root: forces app-wide RTL, GestureHandler
│  │  │  └─ (tabs)/            bottom-tab navigator
│  │  │     ├─ _layout.tsx         tab bar + Ionicons
│  │  │     ├─ index.tsx           Muṣḥaf reader (home)
│  │  │     ├─ browse.tsx          Surah/juz index
│  │  │     ├─ search.tsx          text + recite-to-search
│  │  │     ├─ memorize.tsx        memorization / SRS
│  │  │     └─ settings.tsx        reciter, server URL, offline toggle, language
│  │  ├─ components/       MushafPage, PagePager, AyahSheet, PlayerBar, FollowBar
│  │  ├─ audio/            playback, follow-along, recite-search, on-device whisper
│  │  ├─ match/            on-device matcher/tracker (TS port of the server's)
│  │  ├─ db/               expo-sqlite access + schema
│  │  ├─ fonts/            on-demand QCF2 page-font loader
│  │  ├─ memorize/         SM-2 spaced-repetition scheduler
│  │  ├─ store/            zustand store (persisted settings, bookmarks, session)
│  │  └─ i18n.ts, theme.ts
│  ├─ assets/             app icon set + adaptive/monochrome variants
│  ├─ scripts/gen-icons.cjs   SVG → icon PNG/webp generator (sharp)
│  └─ android/            prebuilt native project (gitignored)
├─ server/                Python FastAPI: index, ASR, live tracker
│  ├─ quran_server/
│  │  ├─ app.py               HTTP + WebSocket endpoints, lifespan
│  │  ├─ asr.py               Whisper ASR (faster-whisper/CTranslate2) + audio decode
│  │  ├─ session.py           streaming rolling-window session
│  │  ├─ tracker.py           position tracker (search → lock → advance)
│  │  ├─ quran_index.py       in-memory searchable index of words
│  │  └─ normalize.py         Arabic text normalization
│  ├─ scripts/            build_quran_db.py, eval_*, benchmark_realclips.py, ws_client.py
│  ├─ tests/              pytest suite
│  └─ Dockerfile
├─ data/                  generated: quran.db, ggml/CT2 models, audio cache (gitignored)
├─ docs/                  DESIGN.md, this file, superpowers specs/plans
├─ docker-compose.yml     server deploy (CPU by default)
└─ README.md
```

---

## 3. Technology stack

**Mobile**
- **Expo SDK 58 / React Native 0.88 / React 19**, TypeScript, new architecture (Fabric/TurboModules) enabled.
- **expo-router** — file-based navigation (tabs).
- **zustand** + persist (AsyncStorage) — app state, with a deep-merge migration so new settings keys pick up defaults.
- **expo-sqlite** — bundled `quran.db` read on-device (surahs, verses, words, timings).
- **expo-audio** — reciter playback *and* `useAudioStream` for mic PCM capture (works in Expo Go, no custom build needed for the streaming path).
- **whisper.rn 0.7.4** — on-device Whisper (CTranslate2/ggml) for offline ASR. Native module → only runs in a dev/release build, not Expo Go.
- **@gorhom/bottom-sheet**, **react-native-gesture-handler**, **reanimated**, **@expo/vector-icons** (Ionicons).
- Jest + `@testing-library/react-native` for unit tests.

**Server**
- **FastAPI + Uvicorn** (ASGI), WebSocket for streaming.
- **faster-whisper (CTranslate2)** — int8 on CPU, float16 on GPU. Converts the Tarteel HF checkpoint to a cached CT2 model on first use. (~2–4× faster than the HuggingFace transformers path it replaced.)
- **PyAV (bundled ffmpeg)** — decodes phone audio (AAC/m4a/opus) for the upload path, with demuxer/protocol whitelisting against SSRF.
- **NumPy / SciPy** — resampling, VAD (RMS dBFS), windowing.
- **rapidfuzz** — fuzzy string matching for the index search.

**Models & data**
- ASR: `tarteel-ai/whisper-base-ar-quran` (Quran-tuned Whisper, Apache-2.0). Falls back to the tiny variant where configured.
- Quran text/word/timing data: **Quran.com / Quran Foundation API v4**; audio from EveryAyah / QuranicAudio; per-page **QCF2** fonts from the Quran.com CDN.

**Infrastructure**
- **Docker** (server), **Caddy** (HTTPS reverse proxy, Let's Encrypt via Porkbun DNS-01), **Tailscale** (dev/off-cable access), GitHub Releases (APK distribution).

---

## 4. Mobile architecture

### 4.1 Navigation & RTL
`src/app/_layout.tsx` is the root: it wraps the app in `GestureHandlerRootView`
and forces **app-wide RTL** via `I18nManager.forceRTL(true)`. This has a
subtle consequence documented in the code: under forced RTL, Yoga flips
`flexDirection`, so the muṣḥaf line layout must pin direction explicitly
(`flexDirection: "row"` + `direction: "rtl"`) and scale over-wide lines
**uniformly** (`scaleX` *and* `scaleY`) to avoid distorting the glyphs.

`(tabs)/_layout.tsx` defines the five-tab bottom navigator with Ionicons
(filled when focused, outline otherwise), tinted the brand green `#1f6f43`.

### 4.2 State (`store/userStore.ts`)
A single zustand store, persisted to AsyncStorage:
- `settings` — language, theme, reciterId, **serverUrl**, **offlineFollow**, translation default.
- `lastPage`, `bookmarks`, `pendingJump` (cross-screen navigation), `memorizeSession`, SRS card state.
- Persist uses a **deep merge** so settings keys added in later versions acquire their defaults on upgrade (otherwise the stored object would mask them).

### 4.3 Data layer (`db/`)
`quran.db` (SQLite) is bundled and read with expo-sqlite. `schema.ts` types the
rows; `quranDb.ts` provides queries plus two pure helpers central to rendering
and matching:
- `getPageWords(page)` — words for a page, ordered `line, surah, ayah, position`.
- `groupWordsByLine(rows)` → `MushafLine[]` — groups words per line and sorts each line by **reading order** `(surah, ayah, position)` (note: Quran.com's global word id is *not* reading order).
- `buildSearchQuery(text)` — normalized `LIKE` over a `norm` column for text search.

### 4.4 Fonts (`fonts/pageFont.ts`)
The 604 QCF2 page fonts are ~350 KB each (~211 MB total) so they are **not
bundled**. `pageFont.ts` downloads `…/fonts/quran/hafs/v2/ttf/p{N}.ttf` to the
cache dir on first view (Amiri fallback) and registers it with expo-font. Each
word row carries a `code_v2` glyph string rendered in its page's font — this is
what makes the on-device muṣḥaf pixel-faithful to the printed page.

### 4.5 Reader rendering (`components/`)
- `PagePager` — an **inverted** horizontal paging `FlatList` of 604 pages. RTL
  paging is achieved by mapping `index = PAGES - page` (page 1 is rightmost).
- `MushafPage` / `MushafLineView` — renders each line as a row of `Pressable`
  words in the page font, applying highlight states: selected ayah, playing
  ayah, active word, and follow-along statuses (correct / wrong / missed), plus
  memorization masking.
- `AyahSheet` (bottom sheet) — translation, play-from-here, bookmark.
- `PlayerBar` / `FollowBar` — transport for playback and the follow-along status
  strip (preparing / listening / tracking / **error with retry**).

### 4.6 Audio subsystem (`audio/`)
- `usePlayback.ts` — reciter playback via expo-audio; maps the reciter's
  per-word timing (`timeline.ts`) to highlight the current word and auto-turn
  pages.
- `useFollowAlong.ts` — the live-recitation hook. Captures mic PCM via
  `useAudioStream` and routes frames either to the **server** (`reciteSocket.ts`
  → `/ws/recite`) or the **on-device** path (`localSession.ts` → whisper.rn),
  both emitting the *same* tracker events so the UI is identical. Includes a
  connection-failure detector and a no-audio **watchdog** that surfaces a
  dismissible error instead of spinning forever.
- `reciteSearch.ts` — the recite-to-search upload (binary `uploadAsync` of a
  recorded clip to the server).
- `localWhisper.ts` / `localSession.ts` — on-device Whisper (downloads the ggml
  model once; GPU→CPU fallback for Adreno devices) feeding the TS tracker.

### 4.7 On-device matcher (`match/`) — TS port of the server
So follow-along can run offline, the server's matching logic is ported to
TypeScript: `normalize.ts` (Arabic normalization), `quranIndex.ts` (the word
index), `tracker.ts` (the position tracker), `align.ts` (word alignment),
`loadIndex.ts` (builds the index from `quran.db`). See §6 for the algorithm.

### 4.8 Memorization (`memorize/srs.ts`)
Hidden-text mode masks words on a page; the follow-along tracker reveals each
word as it's recited correctly. At the end of a page, the correct-ratio maps to
an **SM-2** grade (`gradeFromRatio`) and the page's spaced-repetition card is
scheduled (`srs.ts`).

---

## 5. Server architecture (`server/quran_server/`)

### 5.1 `app.py` — API surface
FastAPI app with a lifespan that loads the Quran index and warms the ASR model.
Endpoints:
- `GET /api/health` → `{ ok, words, model, device }`.
- `POST /recognize` (recite-to-search) — decode uploaded audio (PyAV) → ASR →
  index search → candidate ayahs.
- `GET /model/{name}` — serves a ggml model for the on-device path (strict
  `<name>.bin` allowlist + resolved-path containment — hardened against traversal).
- `WS /ws/recite` — the streaming follow-along protocol (see §6).

### 5.2 `asr.py` — speech recognition
`QuranASR` wraps **faster-whisper**. On construction it detects CUDA
(`ctranslate2.get_cuda_device_count()`), converts the HF checkpoint to a cached
CTranslate2 model (`int8` CPU / `float16` GPU) via `_ensure_ct2`, and loads it.
`transcribe(audio) → (text, seconds)` runs a single decode (beam size 1,
`without_timestamps`, `condition_on_previous_text=False`). The module also holds
the audio utilities: `decode_audio_bytes` (PyAV, whitelisted), `resample`,
`pcm16_to_float`, VAD (`rms_dbfs`), and pre-processing (trim silence, normalize).

### 5.3 `session.py` — streaming session
A rolling-window recognizer. Tunables: `HOP_S = 1.0` (recognize after ~1 s of
new audio), `WINDOW_S = 6.0` (transcribe at most the trailing 6 s),
`VAD_DBFS = -45`, `SILENCE_RESET_S = 2.0` (drop stale buffer after a pause). Each
`step()` runs ASR on the trailing window (skipping silence) and feeds the
recognized words to the tracker, emitting `track` / `search` / `silence` events.

### 5.4 Index & tracker
`quran_index.py` builds an in-memory, normalized word index from `quran.db` for
fuzzy search (`rapidfuzz`). `tracker.py` is the stateful position tracker shared
by search and streaming (its TS twin lives in `mobile/src/match/tracker.ts`).

---

## 6. The recognition / tracking algorithm (core IP)

The hard problem: a noisy, partial ASR transcript of someone reciting must be
mapped to an exact position in 77k words, then advanced in real time.

**Normalization.** Arabic text is normalized (strip diacritics, unify
alef/hamza/ta-marbuta forms, collapse whitespace) on both the index and the ASR
output so fuzzy comparison is stable.

**Phonetic folding (matching only, never display).** On top of normalization,
both the index and the ASR query are *phonetically folded* — consonants the
Arabic ASR routinely confuses are collapsed to one class (ص→س, ط/ث→ت, ذ/ظ→ز,
ض→د, ق→ك, ح→ه). The query must be folded on the *same* path as the reference
(both the server tracker and the on-device tracker fold at `update()`); folding
the reference but comparing an unfolded query marked correct recitation red.
Folding is idempotent and length-preserving.

**Two phases per session:**

1. **Search (not yet located).** On each recognized window the tracker fuzzy-
   matches the normalized words against the index and emits `search` with
   ranked **candidates** (verse keys + page + score). The UI shows
   "Finding your place…".
2. **Track (locked).** Once a candidate is confident enough the tracker **locks**
   to a global word index (`gidx`) and switches to `track` events: it aligns each
   new recognized window to the expected upcoming words, advances the current
   position, and classifies words as **correct** (recited), **wrong** (said
   something different), or **missed** (skipped). `current` carries
   `word_id, verse_key, page, line, position`, which drives highlighting and
   auto page-turns. The correct/wrong gate is **length-aware** (`word_correct` /
   `wordCorrect`): a word passes at per-word similarity ≥ `CORRECT_SIM` (0.8), or
   with a single edit for words ≥ 4 letters (`min(CORRECT_SIM, 1−1/L)`) — short
   2–3 letter words stay strict to avoid false greens on minimal pairs.

**Streaming protocol (`/ws/recite`), client → server:** `start` (sample rate,
optional `start_gidx`), raw PCM16 frames, `lock`, `reset`, `stop`. Server →
client: `ready`, `transcript`, `search`, `track`, `silence`, `error`. The
on-device path (`localSession` + `match/tracker`) emits the same event shapes, so
`useFollowAlong` and the reader render identically online or offline.

**Window/latency trade-off.** Whisper always encodes a padded 30 s frame, so the
6 s window keeps decode cheap while giving the matcher enough context to lock.
On CPU the box transcribes a window in ~0.7 s (keeps up with the 1 s hop); on
GPU ~50–150 ms (instant).

---

## 7. Data model (`quran.db`)

Built once by `server/scripts/build_quran_db.py` from the Quran.com API (raw
responses cached in `data/raw/` for reproducible offline rebuilds). Core tables:
- **surahs** — id, Arabic/simple/translated names, revelation place, counts, page range.
- **verses** — verse_key, surah, ayah, page, juz, hizb, uthmani/simple text,
  `norm` (normalized, for search), English translation (Saheeh International).
- **words** — the render + match unit: verse_key, surah, ayah, position, page,
  line, `char_type` (word vs ayah-end marker), `code_v2` (page-font glyph),
  `norm`, `gidx` (global reading-order index), translation. Indexed on
  `(page, line, id)` and `gidx`.

The *same* `quran.db` is bundled in the app and read by the server, guaranteeing
the muṣḥaf layout and the matcher's index are identical.

---

## 8. Deployment & infrastructure

### 8.1 Local development
- **Mobile:** `bun` (not npm — npm is broken on the dev box). Metro over USB:
  `adb reverse tcp:8081` + push an `exp://127.0.0.1:8081` deep link. Bind Metro to
  `0.0.0.0` (not `--localhost`, which binds IPv6-only and breaks the IPv4 adb tunnel).
- **Server:** `uvicorn quran_server.app:app --host 0.0.0.0 --port 8000`, reached
  from the phone via `adb reverse tcp:8000`.

### 8.2 Production server (the "qatra" box)
An Ubuntu host (Docker, no working GPU currently) runs the server as a container:

```
docker build -t quran-server -f server/Dockerfile .
docker run -d --name quran-server --restart unless-stopped -p 8000:8000 \
  -e QURAN_ASR_MODEL=tarteel-ai/whisper-base-ar-quran \
  -v ~/quran-app/data:/data -v quran-hf-cache:/cache/hf quran-server
```
The container builds `quran.db` from the API on first start and caches the
CT2 model in the `hf-cache` volume.

- **Public HTTPS:** a **Caddy** site `quran.hajmousa.com:8443` reverse-proxies to
  the container on `:8000` (WebSocket auto-upgraded), with a Let's Encrypt cert
  issued via **Porkbun DNS-01**. Caddy serves several hostnames on `:8443` by SNI.
- **Off-cable dev:** **Tailscale** — the box is reachable on its tailnet IP, so a
  phone on the tailnet can hit `http://<tailscale-ip>:8000` directly.
- The app's default `serverUrl` is the public `https://quran.hajmousa.com:8443`
  (overridable in Settings to localhost/Tailscale for development).

### 8.3 Build & release
- The app is an **Expo prebuilt** project (native `android/` committed-ignored,
  regenerated from `app.json`/assets). Release APKs are built with
  `./gradlew assembleRelease`; the JS bundle is embedded at build time.
- **Signing:** currently debug-signed (installable sideload; needs a real upload
  key for Play Store). Cleartext is allowed in the manifest so dev overrides to
  `http://` LAN/Tailscale work; production uses HTTPS/WSS.
- **Distribution:** APKs are published as **GitHub Releases**
  (`gh release create vX.Y.Z …`) for a shareable sideload link.
- **Icons:** generated from SVG by `mobile/scripts/gen-icons.cjs` (sharp) into all
  Expo assets + native mipmap densities + the monochrome/themed variant.

---

## 9. Testing & evaluation

- **Mobile:** Jest unit tests across `db`, `fonts`, `i18n`, `match`, `memorize`,
  `store`, `audio/timeline`, and a `MushafPage` render test.
- **Server:** pytest (`test_api`, `test_audio`, `test_index`, `test_build_db_codev2`).
- **Evaluation scripts:** `eval_search.py` (recite-to-search WER/accuracy),
  `eval_tracking.py` (live-tracking accuracy), `benchmark_realclips.py`
  (real-clip model benchmark: WER + search + latency). Note: Tarteel models were
  trained on EveryAyah reciters, which biases these numbers optimistically.

---

## 10. Security notes

- `/recognize` and `/model/{name}` harden untrusted input: PyAV demuxer/protocol
  whitelisting (SSRF), bounded decode duration and channels/rate (DoS), and a
  strict model-name allowlist with resolved-path containment (traversal).
- The on-device model is currently downloaded over the configured server URL
  without a pinned hash — tracked as a follow-up (pin SHA-256 + download-to-temp-
  then-verify, and fetch from a fixed HTTPS/CDN origin when the model moves off
  the dev server).
- CT2 model cache defaults to a private dir (HF cache volume in Docker, or a
  user-private `~/.cache`), never a world-writable `/tmp` path.

---

## 11. Known follow-ups

- Proper **release signing** keystore + an **AAB** for Play Store.
- **Offline model**: a correctly-converted Tarteel ggml (the bundled one has a
  bad `n_text_ctx` header — the server-converted CT2 is the good path) hosted on
  a **CDN** with an integrity hash, so offline follow-along ships standalone.
- **GPU** on the server (driver reboot + nvidia-container-toolkit) → base model
  at ~50–150 ms/window.
- Dark theme, post-session mistake summaries, per-ayah memorization ranges.
