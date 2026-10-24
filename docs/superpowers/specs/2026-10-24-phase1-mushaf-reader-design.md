# Phase 1 — Mushaf Reader (Design)

Status: approved for planning · Date: 2026-10-24 · Platform target verified on: Samsung Galaxy S24 Ultra (Expo Go over USB)

This spec covers **Phase 1 (Read)** of the Quran Reader & Reciter app (see `docs/DESIGN.md`).
It is the first of several per-phase spec → plan → build cycles. Phases 2–6 (Listen,
Recite-to-search, Follow-along, Memorize, on-device ASR) are out of scope here; the
server already serves the Phase 3–4 endpoints.

## 1. Goal & scope

A fully offline, pixel-accurate Mushaf reader — the foundation the later AI phases build on.

In scope:
- 604-page Madani Mushaf rendered with **QPC V2 per-page glyph fonts** (printed-page fidelity).
- Navigation: swipe between pages; an Index tab with surah / juz / page pickers; jump to any ayah.
- Resume to last-read page; bookmarks (add/remove/list).
- Tap an ayah → highlight + bottom sheet (translation, verse key, bookmark / copy / share).
- Local diacritic-insensitive text search; results jump into the Mushaf.
- Settings: UI language (ar/en), default translation visibility, light/dark theme.

Explicitly out of scope (later phases): audio playback, recite-to-search, live follow-along,
memorization/SRS. No server dependency in Phase 1 — everything runs from bundled assets.

## 2. Data & font pipeline

- **DB rebuild**: extend `server/scripts/build_quran_db.py` to also fetch Quran.com's per-word
  QPC glyph field (`code_v2`) and its `v2_page`, and store `code_v2` on the `words` table. All
  existing columns/values (including `gidx`, used by later phases) are preserved. Rebuild
  produces an updated `data/quran.db`.
- **Fonts**: source the 604 QCF2 per-page fonts plus surah-header / basmala glyph fonts from
  QUL (qul.tarteel.ai), OFL-licensed. Bundle them as Expo assets.
- **DB delivery**: bundle `quran.db` (~14 MB) in the app; on first launch copy it from assets
  into the app document directory, then open read-only with `expo-sqlite`.
- **Spike first** (chosen sequencing): before building the reader, a throwaway screen loads a
  *single* QCF2 page font via `expo-font` and renders that page's `code_v2` string, verified on
  the S24 by screenshot. This retires the one real technical unknown (per-page font loading and
  glyph rendering in Expo) before anything is built on top of it.

Assumptions to validate in the spike: (a) Quran.com API v4 exposes `code_v2` per word; (b) QUL's
QCF2 fonts render correctly under Expo / React Native new architecture on Android.

## 3. App architecture

Expo Router, bottom tabs, Mushaf-first (opens to last-read page).

```
mobile/
  src/app/                       Expo Router routes
    _layout.tsx                  root: RTL setup, font + db providers, theme
    (tabs)/_layout.tsx           bottom tabs: Mushaf, Index, Search, Settings
    (tabs)/index.tsx             Mushaf reader (default route)
    (tabs)/browse.tsx            Index: surah / juz / page pickers
    (tabs)/search.tsx            Search
    (tabs)/settings.tsx          Settings
  src/db/quranDb.ts              expo-sqlite open + typed queries (page, verse, search)
  src/db/schema.ts               row types
  src/store/userStore.ts         zustand + AsyncStorage: lastPage, bookmarks, settings
  src/fonts/pageFont.ts          per-page QCF2 font loader (lazy, LRU cache)
  src/components/MushafPage.tsx   renders one page: lines -> words, per-word press
  src/components/AyahSheet.tsx    bottom sheet (translation + actions)
  src/components/PagePager.tsx    horizontal pager over 604 pages
  src/i18n.ts                    ar / en strings
  src/theme.ts                   light / dark tokens
```

Unit responsibilities (each testable in isolation):
- `quranDb` — only SQL + typed rows. Depends on the bundled db.
- `pageFont` — only font load/cache lifecycle. Depends on `expo-font` + bundled fonts.
- `MushafPage` — pure render of one page from props (words + selection). No data fetching.
- `userStore` — only persisted UI state.

## 4. Mushaf rendering (core component)

- `PagePager`: windowed horizontal `FlatList` over 604 pages; only current ±1 mounted.
- For page N: `pageFont.ensureLoaded(N)` loads `QCF2{NNN}.ttf` (LRU cache, ~5 pages retained);
  show a skeleton while loading.
- `MushafPage`: queries words for page N, groups by `line`, renders each line as a row of
  `<Text>` spans in that page's font using `code_v2`; `char_type='end'` renders the ayah-number
  glyph. Page scaled to device width to preserve printed proportions.
- Each word span carries its `verse_key`; tapping sets `selectedVerseKey` → that ayah's words
  highlight and `AyahSheet` opens.
- Special layouts: page 1 / Al-Fatiha and surah-header + basmala lines render as centered rows.

## 5. State & persistence

`userStore` (zustand + AsyncStorage), rehydrated on launch:
- `lastPage: number` — reader opens here.
- `bookmarks: { verseKey: string; addedAt: number }[]`.
- `settings: { language: 'ar' | 'en'; theme: 'light' | 'dark'; translationDefault: boolean }`.

Language defaults from device locale; app is RTL-enforced regardless of UI language.

## 6. Search

- Query the existing diacritic-insensitive `norm` column: `SELECT ... WHERE norm LIKE ?` over
  verses (primary). Returns verse_key, surah name, page, translation snippet.
- Tap result → navigate Mushaf to that page and select the ayah.

## 7. Error handling & edge cases

- First-launch DB copy failure → retry with a clear error message; never open a half-copied db.
- Page font missing / fails to load → fall back to the bundled Amiri font for that page (never a
  blank page) and log; the reader stays usable.
- Unknown/!1..604 page requests clamped to range.
- RTL enforced app-wide via `I18nManager`; verify gesture direction on the pager.

## 8. Testing

- `quranDb`: query tests against the real bundled db — known page word counts, specific ayah
  lookups (e.g. 1:1, 2:255), search returns expected verse keys.
- `userStore`: state transition tests (set last page, add/remove bookmark, change settings) with
  a mocked AsyncStorage.
- `MushafPage`: render smoke test for a sample page (correct line grouping + word count).
- Manual verification on the S24 via the Expo/USB pipeline, with screenshots at each milestone:
  spike page → full QPC page → page navigation → search → ayah bottom sheet.

## 9. Build sequencing (summary)

1. Spike: one QCF2 page font rendering on the S24 (validate data + font assumptions).
2. DB rebuild with `code_v2`; bundle fonts + db; first-launch copy + open.
3. `quranDb` queries + types (tested).
4. `MushafPage` + `pageFont` + `PagePager` (QPC rendering, tested + screenshot).
5. Navigation shell (tabs, Index pickers), resume-to-last-page.
6. `AyahSheet` (translation + actions), bookmarks.
7. Search.
8. Settings (language, theme, translation default).
9. Full manual pass on the S24.
