# Phase 1 Mushaf Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully-offline, pixel-accurate 604-page Mushaf reader in the Expo app, with navigation, local search, bookmarks, resume, and an ayah translation bottom sheet.

**Architecture:** Expo Router bottom-tab app, Mushaf-first. Each page renders from the bundled `quran.db` (expo-sqlite) using QPC V2 per-page glyph fonts (one `QCF2{NNN}.ttf` per page, lazy-loaded + LRU-cached). UI state (last page, bookmarks, settings) in zustand + AsyncStorage. No server dependency.

**Tech Stack:** Expo SDK 58, React Native 0.88, TypeScript, Expo Router, expo-sqlite, expo-font, expo-asset, expo-file-system, zustand, @react-native-async-storage/async-storage, @gorhom/bottom-sheet, jest-expo + @testing-library/react-native. Package manager: **bun** (npm is broken on this machine — see memory `mobile-dev-environment`).

**Device loop:** verify on the Samsung Galaxy S24 Ultra (adb id `R5CX327XC5L`) over USB. Metro: `bunx expo start` then push `exp://127.0.0.1:8081` via adb (adb reverse tcp:8081/tcp:8000 already set). Screenshot: `adb -s R5CX327XC5L exec-out screencap -p > data/shot.png`.

---

## File Structure

Created in `mobile/`:
- `src/app/_layout.tsx` — root layout: RTL enforcement, DB + font providers, theme.
- `src/app/(tabs)/_layout.tsx` — bottom tab navigator (Mushaf, Index, Search, Settings).
- `src/app/(tabs)/index.tsx` — Mushaf reader screen (default).
- `src/app/(tabs)/browse.tsx` — Index screen (surah / juz / page pickers).
- `src/app/(tabs)/search.tsx` — Search screen.
- `src/app/(tabs)/settings.tsx` — Settings screen.
- `src/db/schema.ts` — row types.
- `src/db/quranDb.ts` — open DB (first-launch copy) + typed queries.
- `src/store/userStore.ts` — zustand + AsyncStorage: lastPage, bookmarks, settings.
- `src/fonts/pageFont.ts` — per-page QCF2 font loader (LRU cache).
- `src/components/MushafPage.tsx` — render one page (lines → word spans, per-word press).
- `src/components/PagePager.tsx` — horizontal pager over 604 pages.
- `src/components/AyahSheet.tsx` — bottom sheet with translation + actions.
- `src/i18n.ts` — ar/en strings + helper.
- `src/theme.ts` — light/dark tokens.
- `assets/quran.db` — bundled database (built by server script).
- `assets/fonts/qcf2/QCF2{001..604}.ttf`, `assets/fonts/qcf2/QCF2BSML.ttf` (header/basmala).

Modified:
- `server/scripts/build_quran_db.py` — add `code_v2` + `v2_page` to the `words` table.
- `mobile/package.json`, `mobile/app.json`, `mobile/index.ts` — Expo Router entry + plugins + test scripts.

---

## Task 1: QPC font + data spike (device-validated, throwaway)

Validates the two project assumptions before building anything: (a) Quran.com API v4 returns `code_v2` per word; (b) a QCF2 page font renders those glyph codes correctly in Expo on the S24.

**Files:**
- Create (throwaway): `mobile/spike/page1.json`, `mobile/assets/fonts/qcf2/QCF2001.ttf`, temp route `mobile/src/app/spike.tsx`.

- [ ] **Step 1: Fetch page-1 words with `code_v2` from the API**

Run from repo root:
```bash
./server/.venv/Scripts/python.exe - <<'PY'
import json, httpx
params = {"words":"true","word_fields":"code_v2,v2_page,char_type_name","per_page":"50"}
r = httpx.get("https://api.quran.com/api/v4/verses/by_page/1", params=params, timeout=60)
r.raise_for_status()
words = [w for v in r.json()["verses"] for w in v["words"]]
line1 = "".join(w["code_v2"] for w in words if w.get("v2_page")==1 and w.get("line_number")==2)
print("has code_v2:", all("code_v2" in w for w in words))
json.dump({"words": words}, open("mobile/spike/page1.json","w",encoding="utf-8"), ensure_ascii=False)
PY
```
Expected: `has code_v2: True` and a non-empty `mobile/spike/page1.json`. If `code_v2` is missing, STOP — the font pipeline is not viable and the design needs revisiting.

- [ ] **Step 2: Download the QCF2 page-1 font (TTF, direct)**

The QPC V2 per-page fonts are served as TTF at `https://static.qurancdn.com/fonts/quran/hafs/v2/ttf/p{N}.ttf` (verified; the `.woff2` variants exist too but React Native cannot load woff2 — use TTF). Download page 1:
```bash
mkdir -p mobile/assets/fonts/qcf2
curl -sL "https://static.qurancdn.com/fonts/quran/hafs/v2/ttf/p1.ttf" -o mobile/assets/fonts/qcf2/QCF2001.ttf
file mobile/assets/fonts/qcf2/QCF2001.ttf
```
Expected: `TrueType Font` and size ≈ 600 KB. (Mirror if the CDN is down: `https://raw.githubusercontent.com/quran/quran.com-frontend-next/master/public/fonts/quran/hafs/v2/ttf/p1.ttf`.)

- [ ] **Step 3: Render the page-1 glyphs in a temp screen on the S24**

Create `mobile/src/app/spike.tsx`:
```tsx
import { useFonts } from "expo-font";
import { Text, View } from "react-native";
import page1 from "../../spike/page1.json";

export default function Spike() {
  const [loaded] = useFonts({ QCF2001: require("../../assets/fonts/qcf2/QCF2001.ttf") });
  if (!loaded) return <Text>loading font…</Text>;
  const line2 = (page1.words as any[])
    .filter((w) => w.line_number === 2)
    .map((w) => w.code_v2)
    .join("");
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" }}>
      <Text style={{ fontFamily: "QCF2001", fontSize: 32, writingDirection: "rtl" }}>{line2}</Text>
    </View>
  );
}
```

- [ ] **Step 4: Launch and screenshot on the S24**

Run:
```bash
cd mobile && bunx expo start &
adb -s R5CX327XC5L shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081/--/spike"
sleep 6 && adb -s R5CX327XC5L exec-out screencap -p > ../data/spike.png
```
Read `data/spike.png`. Expected: the first line of Surah Al-Fatiha (`الحمد لله رب العالمين`) rendered in the Mushaf glyph style — **not** tofu boxes (□□□). If boxes appear, the font/codepoint pairing is wrong — resolve before proceeding (common fix: the font family name must match the file; confirm the QCF2 variant matches `code_v2` vs `code_v1`).

- [ ] **Step 5: Record the result and remove the throwaway**

```bash
rm -rf mobile/spike mobile/src/app/spike.tsx
git add -A && git commit -m "chore: QPC font spike validated on S24 (removed scaffold)"
```
Keep `mobile/assets/fonts/qcf2/QCF2001.ttf` only if Task 3 will reuse it; otherwise it is re-added in Task 3.

---

## Task 2: Add `code_v2` to the Quran DB build

**Files:**
- Modify: `server/scripts/build_quran_db.py`
- Test: `server/tests/test_build_db_codev2.py`

- [ ] **Step 1: Write the failing test**

Create `server/tests/test_build_db_codev2.py`:
```python
import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parents[2] / "data" / "quran.db"

def test_words_have_code_v2():
    c = sqlite3.connect(DB).cursor()
    cols = [r[1] for r in c.execute("PRAGMA table_info(words)")]
    assert "code_v2" in cols and "v2_page" in cols
    # Every recitable word must carry a glyph code.
    missing = c.execute(
        "SELECT COUNT(*) FROM words WHERE char_type='word' AND (code_v2 IS NULL OR code_v2='')"
    ).fetchone()[0]
    assert missing == 0
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && .venv/Scripts/python.exe -m pytest tests/test_build_db_codev2.py -v`
Expected: FAIL (`code_v2` not in columns — DB not yet rebuilt).

- [ ] **Step 3: Add the fields to the schema and fetch params**

In `server/scripts/build_quran_db.py`, change the `words` table in `SCHEMA` (line 34-37) to add two columns after `text_simple TEXT`:
```python
CREATE TABLE words(
  id INTEGER PRIMARY KEY, verse_id INTEGER, verse_key TEXT, surah INTEGER, ayah INTEGER,
  position INTEGER, page INTEGER, line INTEGER, char_type TEXT,
  text_uthmani TEXT, text_simple TEXT, code_v2 TEXT, v2_page INTEGER,
  norm TEXT, gidx INTEGER, translation_en TEXT);
```
Update `word_fields` in `fetch_page` (line 66) to include the glyph fields:
```python
"word_fields": "text_uthmani,text_imlaei_simple,line_number,page_number,code_v2,v2_page",
```

- [ ] **Step 4: Update the words INSERT**

Replace the `db.execute("INSERT INTO words ...")` call (lines 127-133) so column count matches (now 16 values):
```python
db.execute(
    "INSERT INTO words VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    (w["id"], v["id"], v["verse_key"], surah, ayah, w["position"],
     w["page_number"], w["line_number"], w["char_type_name"],
     w["text_uthmani"], w["text_imlaei_simple"], w.get("code_v2"), w.get("v2_page"),
     norm, g, (w.get("translation") or {}).get("text")),
)
```

- [ ] **Step 5: Rebuild the DB (force re-fetch so new word_fields are pulled)**

The raw page cache must be cleared so the new `word_fields` are fetched:
```bash
cd server && rm -rf ../data/raw && .venv/Scripts/python.exe scripts/build_quran_db.py
```
Expected: `wrote ...quran.db: 6236 verses, 77429 recitable words`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd server && .venv/Scripts/python.exe -m pytest tests/test_build_db_codev2.py tests/ -v`
Expected: all PASS (new test + existing `test_index.py`/`test_api.py` still green).

- [ ] **Step 7: Commit**

```bash
git add server/scripts/build_quran_db.py server/tests/test_build_db_codev2.py
git commit -m "feat(server): add code_v2 glyph codes to quran.db words table"
```

---

## Task 3: Install deps, configure Expo Router + tests

**Files:**
- Modify: `mobile/package.json`, `mobile/app.json`, `mobile/index.ts` (delete), `mobile/App.tsx` (delete)
- Create: `mobile/jest.config.js`, `mobile/jest.setup.js`

- [ ] **Step 1: Install runtime + dev dependencies with bun**

```bash
cd mobile
bunx expo install expo-router expo-sqlite expo-font expo-asset expo-file-system \
  @react-native-async-storage/async-storage react-native-gesture-handler \
  react-native-reanimated react-native-safe-area-context react-native-screens \
  @gorhom/bottom-sheet zustand
bun add -d jest-expo jest @testing-library/react-native @types/jest
```
Expected: installs succeed, `package.json` updated.

- [ ] **Step 2: Switch the entry point to Expo Router**

Set `"main"` in `mobile/package.json` to `"expo-router/entry"`, add test scripts:
```json
"main": "expo-router/entry",
"scripts": {
  "start": "expo start",
  "android": "expo start --android",
  "test": "jest"
},
```
Delete `mobile/App.tsx` and `mobile/index.ts` (Expo Router replaces them):
```bash
rm mobile/App.tsx mobile/index.ts
```

- [ ] **Step 3: Configure app.json (scheme + plugins)**

In `mobile/app.json`, add inside `"expo"`:
```json
"scheme": "quranapp",
"plugins": ["expo-router", "expo-sqlite", "expo-font"],
"newArchEnabled": true
```

- [ ] **Step 4: Configure Jest**

Create `mobile/jest.config.js`:
```js
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@react-navigation/.*|@gorhom/.*|zustand))",
  ],
};
```
Create `mobile/jest.setup.js`:
```js
require("@testing-library/react-native/extend-expect");
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
```

- [ ] **Step 5: Create the minimal router tree so the app boots**

Create `mobile/src/app/_layout.tsx`:
```tsx
import { Stack } from "expo-router";
export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```
Create `mobile/src/app/index.tsx`:
```tsx
import { Text, View } from "react-native";
export default function Index() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text>Quran app — router online</Text>
    </View>
  );
}
```
Set `app.json` `expo.extra.router.root` is not required; Expo Router auto-detects `src/app`. Add to `app.json` `"expo"`: nothing more needed — Expo Router 4+ finds `src/app` automatically.

- [ ] **Step 6: Launch on the S24 and verify boot**

```bash
cd mobile && bunx expo start &
adb -s R5CX327XC5L shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081"
sleep 8 && adb -s R5CX327XC5L exec-out screencap -p > ../data/shot.png
```
Read `data/shot.png`. Expected: "Quran app — router online".

- [ ] **Step 7: Commit**

```bash
git add mobile/package.json mobile/app.json mobile/jest.config.js mobile/jest.setup.js mobile/src/app bun.lock
git rm --cached mobile/App.tsx mobile/index.ts 2>/dev/null; true
git commit -m "chore(mobile): expo-router + sqlite/font deps + jest setup"
```

---

## Task 4: Bundle DB + typed DB module with first-launch copy

**Files:**
- Create: `mobile/assets/quran.db` (copy of built DB), `mobile/src/db/schema.ts`, `mobile/src/db/quranDb.ts`
- Test: `mobile/src/db/quranDb.test.ts`

- [ ] **Step 1: Copy the built DB into app assets**

```bash
cp data/quran.db mobile/assets/quran.db
```

- [ ] **Step 2: Define row types**

Create `mobile/src/db/schema.ts`:
```ts
export interface WordRow {
  id: number; verse_key: string; surah: number; ayah: number;
  position: number; page: number; line: number; char_type: "word" | "end";
  code_v2: string | null; gidx: number | null;
}
export interface VerseRow {
  verse_key: string; surah: number; ayah: number; page: number;
  juz: number; text_uthmani: string; translation_en: string | null;
}
export interface SurahRow {
  id: number; name_arabic: string; name_simple: string;
  verses_count: number; first_page: number; last_page: number;
}
export interface SearchHit { verse_key: string; surah: number; page: number; translation_en: string | null; }
```

- [ ] **Step 3: Write the failing test for query logic**

Create `mobile/src/db/quranDb.test.ts` (tests pure helpers that don't need the native module):
```ts
import { buildSearchQuery, groupWordsByLine } from "./quranDb";
import type { WordRow } from "./schema";

test("search query normalizes and wraps with wildcards", () => {
  const { sql, params } = buildSearchQuery("الْحَمْدُ");
  expect(sql).toContain("WHERE norm LIKE ?");
  expect(params[0]).toBe("%الحمد%");
});

test("groupWordsByLine groups and orders by position", () => {
  const rows = [
    { line: 2, position: 2 }, { line: 1, position: 1 }, { line: 1, position: 2 },
  ] as WordRow[];
  const lines = groupWordsByLine(rows);
  expect(lines.map((l) => l.line)).toEqual([1, 2]);
  expect(lines[0].words.map((w) => w.position)).toEqual([1, 2]);
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd mobile && bun run test -- quranDb`
Expected: FAIL (`buildSearchQuery` not exported).

- [ ] **Step 5: Implement the DB module**

Create `mobile/src/db/quranDb.ts`:
```ts
import * as SQLite from "expo-sqlite";
import { Asset } from "expo-asset";
import * as FileSystem from "expo-file-system";
import { normalizeArabic } from "../i18n";
import type { WordRow, VerseRow, SurahRow, SearchHit } from "./schema";

const DB_NAME = "quran.db";
let db: SQLite.SQLiteDatabase | null = null;

export async function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  const dir = `${FileSystem.documentDirectory}SQLite`;
  const target = `${dir}/${DB_NAME}`;
  const info = await FileSystem.getInfoAsync(target);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const asset = Asset.fromModule(require("../../assets/quran.db"));
    await asset.downloadAsync();
    await FileSystem.copyAsync({ from: asset.localUri!, to: target });
  }
  db = await SQLite.openDatabaseAsync(DB_NAME);
  return db;
}

export interface MushafLine { line: number; words: WordRow[]; }
export function groupWordsByLine(rows: WordRow[]): MushafLine[] {
  const byLine = new Map<number, WordRow[]>();
  for (const w of rows) (byLine.get(w.line) ?? byLine.set(w.line, []).get(w.line)!).push(w);
  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, words]) => ({ line, words: words.sort((a, b) => a.position - b.position) }));
}

export function buildSearchQuery(text: string): { sql: string; params: string[] } {
  const norm = normalizeArabic(text).replace(/\s+/g, "");
  return {
    sql: `SELECT verse_key, surah, page, translation_en FROM verses WHERE norm LIKE ? LIMIT 50`,
    params: [`%${norm}%`],
  };
}

export async function getPageWords(page: number): Promise<WordRow[]> {
  const d = await openDb();
  return d.getAllAsync<WordRow>(
    `SELECT id,verse_key,surah,ayah,position,page,line,char_type,code_v2,gidx
     FROM words WHERE page=? ORDER BY line, position`, [page]);
}
export async function getVerse(verseKey: string): Promise<VerseRow | null> {
  const d = await openDb();
  return d.getFirstAsync<VerseRow>(
    `SELECT verse_key,surah,ayah,page,juz,text_uthmani,translation_en FROM verses WHERE verse_key=?`,
    [verseKey]);
}
export async function getSurahs(): Promise<SurahRow[]> {
  const d = await openDb();
  return d.getAllAsync<SurahRow>(
    `SELECT id,name_arabic,name_simple,verses_count,first_page,last_page FROM surahs ORDER BY id`);
}
export async function search(text: string): Promise<SearchHit[]> {
  const d = await openDb();
  const { sql, params } = buildSearchQuery(text);
  return d.getAllAsync<SearchHit>(sql, params);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd mobile && bun run test -- quranDb`
Expected: PASS (both tests).

- [ ] **Step 7: Commit**

```bash
git add mobile/assets/quran.db mobile/src/db
git commit -m "feat(mobile): bundle quran.db + typed db module with first-launch copy"
```

---

## Task 5: i18n + Arabic normalization helper

**Files:**
- Create: `mobile/src/i18n.ts`
- Test: `mobile/src/i18n.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mobile/src/i18n.test.ts`:
```ts
import { normalizeArabic, t, setLanguage } from "./i18n";

test("normalizeArabic strips tashkeel and unifies letters", () => {
  expect(normalizeArabic("الْحَمْدُ")).toBe("الحمد");
  expect(normalizeArabic("إِنَّ")).toBe("ان");
});
test("t returns the string for the active language", () => {
  setLanguage("en"); expect(t("tab.mushaf")).toBe("Mushaf");
  setLanguage("ar"); expect(t("tab.mushaf")).toBe("المصحف");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd mobile && bun run test -- i18n`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement i18n**

Create `mobile/src/i18n.ts` (normalization mirrors `server/quran_server/normalize.py`):
```ts
const TASHKEEL = /[ً-ٰٟۖ-ۭـ]/g;
export function normalizeArabic(s: string): string {
  return s
    .replace(TASHKEEL, "")
    .replace(/[أإآٱ]/g, "ا") // أ إ آ ٱ -> ا
    .replace(/ى/g, "ي") // ى -> ي
    .replace(/ة/g, "ه") // ة -> ه
    .replace(/ؤ/g, "و") // ؤ -> و
    .replace(/ئ/g, "ي") // ئ -> ي
    .replace(/[^ء-ي\s]/g, "")
    .trim();
}

type Lang = "ar" | "en";
let lang: Lang = "en";
export function setLanguage(l: Lang) { lang = l; }
const STRINGS: Record<string, Record<Lang, string>> = {
  "tab.mushaf": { en: "Mushaf", ar: "المصحف" },
  "tab.index": { en: "Index", ar: "الفهرس" },
  "tab.search": { en: "Search", ar: "بحث" },
  "tab.settings": { en: "Settings", ar: "الإعدادات" },
  "search.placeholder": { en: "Search the Quran", ar: "ابحث في القرآن" },
  "sheet.bookmark": { en: "Bookmark", ar: "علامة" },
  "sheet.copy": { en: "Copy", ar: "نسخ" },
  "sheet.share": { en: "Share", ar: "مشاركة" },
  "settings.language": { en: "Language", ar: "اللغة" },
  "settings.theme": { en: "Theme", ar: "المظهر" },
};
export function t(key: string): string { return STRINGS[key]?.[lang] ?? key; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && bun run test -- i18n`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/i18n.ts mobile/src/i18n.test.ts
git commit -m "feat(mobile): i18n strings + Arabic normalization helper"
```

---

## Task 6: userStore (zustand + AsyncStorage)

**Files:**
- Create: `mobile/src/store/userStore.ts`
- Test: `mobile/src/store/userStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `mobile/src/store/userStore.test.ts`:
```ts
import { useUserStore } from "./userStore";

beforeEach(() => useUserStore.setState({ lastPage: 1, bookmarks: [],
  settings: { language: "en", theme: "light", translationDefault: true } }));

test("setLastPage clamps to 1..604", () => {
  useUserStore.getState().setLastPage(999);
  expect(useUserStore.getState().lastPage).toBe(604);
  useUserStore.getState().setLastPage(0);
  expect(useUserStore.getState().lastPage).toBe(1);
});
test("toggleBookmark adds then removes", () => {
  const { toggleBookmark } = useUserStore.getState();
  toggleBookmark("2:255");
  expect(useUserStore.getState().bookmarks.map((b) => b.verseKey)).toEqual(["2:255"]);
  toggleBookmark("2:255");
  expect(useUserStore.getState().bookmarks).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd mobile && bun run test -- userStore`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the store**

Create `mobile/src/store/userStore.ts`:
```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface Bookmark { verseKey: string; addedAt: number; }
export interface Settings { language: "ar" | "en"; theme: "light" | "dark"; translationDefault: boolean; }
interface UserState {
  lastPage: number;
  bookmarks: Bookmark[];
  settings: Settings;
  setLastPage: (p: number) => void;
  toggleBookmark: (verseKey: string) => void;
  setSettings: (s: Partial<Settings>) => void;
}
const clampPage = (p: number) => Math.min(604, Math.max(1, Math.round(p)));

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      lastPage: 1,
      bookmarks: [],
      settings: { language: "en", theme: "light", translationDefault: true },
      setLastPage: (p) => set({ lastPage: clampPage(p) }),
      toggleBookmark: (verseKey) => {
        const exists = get().bookmarks.some((b) => b.verseKey === verseKey);
        set({
          bookmarks: exists
            ? get().bookmarks.filter((b) => b.verseKey !== verseKey)
            : [...get().bookmarks, { verseKey, addedAt: Date.now() }],
        });
      },
      setSettings: (s) => set({ settings: { ...get().settings, ...s } }),
    }),
    { name: "quran-user", storage: createJSONStorage(() => AsyncStorage) },
  ),
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && bun run test -- userStore`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/store
git commit -m "feat(mobile): persisted user store (last page, bookmarks, settings)"
```

---

## Task 7: Per-page font loader

**Files:**
- Create: `mobile/src/fonts/pageFont.ts`, `mobile/src/fonts/fontMap.ts` (generated require map)
- Test: `mobile/src/fonts/pageFont.test.ts`
- Add fonts: `mobile/assets/fonts/qcf2/QCF2{001..604}.ttf`

- [ ] **Step 1: Download all 604 QCF2 page fonts + the Amiri fallback**

Fetch the full QPC V2 TTF set from the CDN into `mobile/assets/fonts/qcf2/`, named `QCF2{001..604}.ttf`:
```bash
mkdir -p mobile/assets/fonts/qcf2
for p in $(seq 1 604); do
  n=$(printf "%03d" "$p")
  f="mobile/assets/fonts/qcf2/QCF2${n}.ttf"
  [ -s "$f" ] || curl -sfL "https://static.qurancdn.com/fonts/quran/hafs/v2/ttf/p${p}.ttf" -o "$f" || echo "FAILED p${p}"
done
ls mobile/assets/fonts/qcf2/QCF2*.ttf | wc -l   # expect 604
```
Fetch the Amiri Quran fallback (SIL OFL) used when a page font fails to load:
```bash
curl -sfL "https://raw.githubusercontent.com/alif-type/amiri/master/AmiriQuran-Regular.ttf" \
  -o mobile/assets/fonts/AmiriQuran-Regular.ttf || \
curl -sfL "https://github.com/aliftype/amiri/releases/latest/download/AmiriQuran-Regular.ttf" \
  -o mobile/assets/fonts/AmiriQuran-Regular.ttf
ls -l mobile/assets/fonts/AmiriQuran-Regular.ttf   # expect the file
```
If any `FAILED p#` lines appear, retry those pages before continuing (the CDN occasionally rate-limits; a second pass of the loop fills gaps).

- [ ] **Step 2: Generate the static require map**

React Native `require` needs static literals, so generate `fontMap.ts`:
```bash
cd mobile && node -e '
let o="export const FONT_MODULES: Record<number, number> = {\n";
for (let p=1;p<=604;p++){const n=String(p).padStart(3,"0");
o+=`  ${p}: require(\"../../assets/fonts/qcf2/QCF2${n}.ttf\"),\n`;}
o+="};\n";require("fs").writeFileSync("src/fonts/fontMap.ts",o);'
```

- [ ] **Step 3: Write the failing test**

Create `mobile/src/fonts/pageFont.test.ts`:
```ts
import { fontFamilyForPage, _lruForTest } from "./pageFont";

test("fontFamilyForPage formats the family name", () => {
  expect(fontFamilyForPage(1)).toBe("QCF2001");
  expect(fontFamilyForPage(604)).toBe("QCF2604");
});
test("LRU evicts least-recently-used beyond capacity", () => {
  const lru = _lruForTest(2);
  lru.touch(1); lru.touch(2); lru.touch(3);
  expect(lru.has(1)).toBe(false);
  expect(lru.has(2)).toBe(true);
  expect(lru.has(3)).toBe(true);
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd mobile && bun run test -- pageFont`
Expected: FAIL (module not found).

- [ ] **Step 5: Implement the loader**

Create `mobile/src/fonts/pageFont.ts`:
```ts
import * as Font from "expo-font";
import { FONT_MODULES } from "./fontMap";

export const fontFamilyForPage = (page: number) => `QCF2${String(page).padStart(3, "0")}`;

class Lru {
  private order: number[] = [];
  constructor(private cap: number) {}
  touch(p: number) {
    this.order = this.order.filter((x) => x !== p);
    this.order.push(p);
    return this.order.length > this.cap ? this.order.shift()! : undefined;
  }
  has(p: number) { return this.order.includes(p); }
}
export const _lruForTest = (cap: number) => new Lru(cap);

const loaded = new Set<number>();
const lru = new Lru(6);
export const FALLBACK_FAMILY = "AmiriQuran";
let fallbackLoaded = false;

export async function ensurePageFont(page: number): Promise<string> {
  const family = fontFamilyForPage(page);
  try {
    if (!loaded.has(page)) {
      await Font.loadAsync({ [family]: FONT_MODULES[page] });
      loaded.add(page);
    }
    lru.touch(page); // eviction is advisory; expo-font keeps fonts resident, LRU bounds preloading
    return family;
  } catch (e) {
    // Never show a blank page: fall back to the bundled Amiri font (design §7).
    console.warn(`page font ${family} failed, using Amiri`, e);
    if (!fallbackLoaded) {
      await Font.loadAsync({ [FALLBACK_FAMILY]: require("../../assets/fonts/AmiriQuran-Regular.ttf") });
      fallbackLoaded = true;
    }
    return FALLBACK_FAMILY;
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd mobile && bun run test -- pageFont`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add mobile/assets/fonts/qcf2 mobile/src/fonts
git commit -m "feat(mobile): QCF2 per-page font assets + lazy loader"
```

---

## Task 8: MushafPage component

**Files:**
- Create: `mobile/src/components/MushafPage.tsx`
- Test: `mobile/src/components/MushafPage.test.tsx`

- [ ] **Step 1: Write the failing render test**

Create `mobile/src/components/MushafPage.test.tsx`:
```tsx
import { render, fireEvent } from "@testing-library/react-native";
import { MushafPage } from "./MushafPage";
import type { WordRow } from "../db/schema";

const words: WordRow[] = [
  { id: 1, verse_key: "1:1", surah: 1, ayah: 1, position: 1, page: 1, line: 2, char_type: "word", code_v2: "", gidx: 0 },
  { id: 2, verse_key: "1:1", surah: 1, ayah: 1, position: 2, page: 1, line: 2, char_type: "word", code_v2: "", gidx: 1 },
];

test("renders words and fires onSelectAyah on press", () => {
  const onSelect = jest.fn();
  const { getByText } = render(
    <MushafPage words={words} fontFamily="QCF2001" selectedVerseKey={null} onSelectAyah={onSelect} />,
  );
  fireEvent.press(getByText(""));
  expect(onSelect).toHaveBeenCalledWith("1:1");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd mobile && bun run test -- MushafPage`
Expected: FAIL (component not found).

- [ ] **Step 3: Implement the component**

Create `mobile/src/components/MushafPage.tsx`:
```tsx
import { memo, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { groupWordsByLine } from "../db/quranDb";
import type { WordRow } from "../db/schema";

interface Props {
  words: WordRow[];
  fontFamily: string;
  selectedVerseKey: string | null;
  onSelectAyah: (verseKey: string) => void;
}

export const MushafPage = memo(function MushafPage({ words, fontFamily, selectedVerseKey, onSelectAyah }: Props) {
  const lines = useMemo(() => groupWordsByLine(words), [words]);
  return (
    <View style={styles.page}>
      {lines.map((line) => (
        <View key={line.line} style={styles.line}>
          {line.words.map((w) => (
            <Pressable key={w.id} onPress={() => onSelectAyah(w.verse_key)} hitSlop={4}>
              <Text
                style={[
                  styles.word,
                  { fontFamily },
                  w.verse_key === selectedVerseKey && styles.selected,
                ]}
              >
                {w.code_v2 ?? ""}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 12, paddingVertical: 20, justifyContent: "space-evenly" },
  line: { flexDirection: "row-reverse", flexWrap: "nowrap", justifyContent: "center", alignItems: "center" },
  word: { fontSize: 28, color: "#111", lineHeight: 46 },
  selected: { backgroundColor: "#fdf0c8" },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && bun run test -- MushafPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/MushafPage.tsx mobile/src/components/MushafPage.test.tsx
git commit -m "feat(mobile): MushafPage renders QPC lines with per-word selection"
```

---

## Task 9: PagePager + Mushaf screen (resume to last page)

**Files:**
- Create: `mobile/src/components/PagePager.tsx`
- Modify: `mobile/src/app/(tabs)/index.tsx` (created in Task 10's tab layout; if building this task first, create a temporary `src/app/index.tsx` host)

- [ ] **Step 1: Implement the pager**

Create `mobile/src/components/PagePager.tsx`:
```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Dimensions, FlatList, View } from "react-native";
import { MushafPage } from "./MushafPage";
import { getPageWords } from "../db/quranDb";
import { ensurePageFont } from "../fonts/pageFont";
import type { WordRow } from "../db/schema";

const { width } = Dimensions.get("window");
const PAGES = 604;

function PageHost({ page, selectedVerseKey, onSelectAyah }: {
  page: number; selectedVerseKey: string | null; onSelectAyah: (k: string) => void;
}) {
  const [data, setData] = useState<{ words: WordRow[]; family: string } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [words, family] = await Promise.all([getPageWords(page), ensurePageFont(page)]);
      if (alive) setData({ words, family });
    })();
    return () => { alive = false; };
  }, [page]);
  if (!data) return <View style={{ width, justifyContent: "center" }}><ActivityIndicator /></View>;
  return (
    <View style={{ width }}>
      <MushafPage words={data.words} fontFamily={data.family}
        selectedVerseKey={selectedVerseKey} onSelectAyah={onSelectAyah} />
    </View>
  );
}

export function PagePager({ initialPage, selectedVerseKey, onSelectAyah, onPageChange }: {
  initialPage: number; selectedVerseKey: string | null;
  onSelectAyah: (k: string) => void; onPageChange: (page: number) => void;
}) {
  const ref = useRef<FlatList>(null);
  // Mushaf page 1 is at the far right in RTL: index = PAGES - page.
  const toIndex = (page: number) => PAGES - page;
  const renderItem = useCallback(({ index }: { index: number }) => (
    <PageHost page={PAGES - index} selectedVerseKey={selectedVerseKey} onSelectAyah={onSelectAyah} />
  ), [selectedVerseKey, onSelectAyah]);
  return (
    <FlatList
      ref={ref}
      horizontal
      pagingEnabled
      inverted
      initialScrollIndex={toIndex(initialPage)}
      getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
      data={Array.from({ length: PAGES })}
      keyExtractor={(_, i) => String(PAGES - i)}
      renderItem={renderItem}
      showsHorizontalScrollIndicator={false}
      onMomentumScrollEnd={(e) => {
        const index = Math.round(e.nativeEvent.contentOffset.x / width);
        onPageChange(PAGES - index);
      }}
      windowSize={3}
    />
  );
}
```

- [ ] **Step 2: Host it in the Mushaf screen**

Create/replace `mobile/src/app/index.tsx` (temporary host until Task 10 adds tabs):
```tsx
import { useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { PagePager } from "../components/PagePager";
import { useUserStore } from "../store/userStore";

export default function MushafScreen() {
  const lastPage = useUserStore((s) => s.lastPage);
  const setLastPage = useUserStore((s) => s.setLastPage);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <PagePager
        initialPage={lastPage}
        selectedVerseKey={selected}
        onSelectAyah={setSelected}
        onPageChange={setLastPage}
      />
    </SafeAreaView>
  );
}
```

- [ ] **Step 3: Verify on the S24**

```bash
cd mobile && bunx expo start &
adb -s R5CX327XC5L shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081"
sleep 10 && adb -s R5CX327XC5L exec-out screencap -p > ../data/shot.png
```
Read `data/shot.png`. Expected: a real Mushaf page in QPC glyphs. Swipe test: `adb -s R5CX327XC5L shell input swipe 900 1000 100 1000 200` then screenshot — expect the next page. Confirm resume by killing Expo Go and relaunching: it should return to the last page.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/components/PagePager.tsx mobile/src/app/index.tsx
git commit -m "feat(mobile): swipeable 604-page pager with resume to last page"
```

---

## Task 10: Tab navigation shell + Index screen

**Files:**
- Create: `mobile/src/app/(tabs)/_layout.tsx`, `mobile/src/app/(tabs)/index.tsx`, `mobile/src/app/(tabs)/browse.tsx`, `mobile/src/app/(tabs)/search.tsx`, `mobile/src/app/(tabs)/settings.tsx`
- Delete: `mobile/src/app/index.tsx` (moves into `(tabs)/index.tsx`)
- Modify: `mobile/src/app/_layout.tsx` (RTL + language init)

- [ ] **Step 1: Enforce RTL + language in the root layout**

Replace `mobile/src/app/_layout.tsx`:
```tsx
import { useEffect } from "react";
import { I18nManager } from "react-native";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useUserStore } from "../store/userStore";
import { setLanguage } from "../i18n";

export default function RootLayout() {
  const language = useUserStore((s) => s.settings.language);
  useEffect(() => {
    setLanguage(language);
    if (!I18nManager.isRTL) { I18nManager.allowRTL(true); I18nManager.forceRTL(true); }
  }, [language]);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}
```

- [ ] **Step 2: Create the tab layout**

Create `mobile/src/app/(tabs)/_layout.tsx`:
```tsx
import { Tabs } from "expo-router";
import { t } from "../../i18n";

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: t("tab.mushaf") }} />
      <Tabs.Screen name="browse" options={{ title: t("tab.index") }} />
      <Tabs.Screen name="search" options={{ title: t("tab.search") }} />
      <Tabs.Screen name="settings" options={{ title: t("tab.settings") }} />
    </Tabs>
  );
}
```
Move the Task 9 Mushaf screen to `mobile/src/app/(tabs)/index.tsx` (same content, fix relative imports to `../../`), then `rm mobile/src/app/index.tsx`.

- [ ] **Step 3: Implement the Index (browse) screen**

Create `mobile/src/app/(tabs)/browse.tsx`:
```tsx
import { useEffect, useState } from "react";
import { FlatList, Pressable, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { getSurahs } from "../../db/quranDb";
import { useUserStore } from "../../store/userStore";
import type { SurahRow } from "../../db/schema";

export default function BrowseScreen() {
  const [surahs, setSurahs] = useState<SurahRow[]>([]);
  const setLastPage = useUserStore((s) => s.setLastPage);
  useEffect(() => { getSurahs().then(setSurahs); }, []);
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <FlatList
        data={surahs}
        keyExtractor={(s) => String(s.id)}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => { setLastPage(item.first_page); router.navigate("/(tabs)"); }}
            style={{ padding: 16, borderBottomWidth: 1, borderColor: "#eee" }}
          >
            <Text style={{ fontSize: 18, textAlign: "right" }}>
              {item.id}. {item.name_arabic} — {item.name_simple}
            </Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
```
Create placeholder `search.tsx` and `settings.tsx` returning a `SafeAreaView` with the tab title (filled in Tasks 12–13).

- [ ] **Step 4: Verify tabs + navigation on the S24**

Launch, screenshot. Expected: four-tab bar; tapping Index shows the 114-surah list; tapping a surah jumps the Mushaf to that surah's first page.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/app
git rm mobile/src/app/index.tsx 2>/dev/null; true
git commit -m "feat(mobile): bottom tabs, RTL root layout, surah index screen"
```

---

## Task 11: AyahSheet (translation + bookmark) wired into the Mushaf

**Files:**
- Create: `mobile/src/components/AyahSheet.tsx`
- Modify: `mobile/src/app/(tabs)/index.tsx`

- [ ] **Step 1: Implement the bottom sheet**

Create `mobile/src/components/AyahSheet.tsx`:
```tsx
import { forwardRef, useEffect, useState } from "react";
import { Pressable, Share, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { getVerse } from "../db/quranDb";
import { useUserStore } from "../store/userStore";
import { t } from "../i18n";
import type { VerseRow } from "../db/schema";

export const AyahSheet = forwardRef<BottomSheet, { verseKey: string | null }>(
  function AyahSheet({ verseKey }, ref) {
    const [verse, setVerse] = useState<VerseRow | null>(null);
    const bookmarks = useUserStore((s) => s.bookmarks);
    const toggleBookmark = useUserStore((s) => s.toggleBookmark);
    useEffect(() => { if (verseKey) getVerse(verseKey).then(setVerse); }, [verseKey]);
    const bookmarked = !!verseKey && bookmarks.some((b) => b.verseKey === verseKey);
    return (
      <BottomSheet ref={ref} index={-1} snapPoints={["35%"]} enablePanDownToClose>
        <BottomSheetView style={{ padding: 20 }}>
          {verse && (
            <>
              <Text style={{ fontSize: 14, color: "#888" }}>{verse.verse_key}</Text>
              <Text style={{ fontSize: 26, textAlign: "right", marginVertical: 8 }}>{verse.text_uthmani}</Text>
              <Text style={{ fontSize: 16, color: "#333" }}>{verse.translation_en}</Text>
              <View style={{ flexDirection: "row", gap: 24, marginTop: 16 }}>
                <Pressable onPress={() => toggleBookmark(verse.verse_key)}>
                  <Text style={{ color: bookmarked ? "#c08a00" : "#007aff" }}>
                    {bookmarked ? "★ " : "☆ "}{t("sheet.bookmark")}
                  </Text>
                </Pressable>
                <Pressable onPress={() => Clipboard.setStringAsync(`${verse.text_uthmani}\n${verse.translation_en ?? ""}`)}>
                  <Text style={{ color: "#007aff" }}>{t("sheet.copy")}</Text>
                </Pressable>
                <Pressable onPress={() => Share.share({ message: `${verse.text_uthmani} (${verse.verse_key})` })}>
                  <Text style={{ color: "#007aff" }}>{t("sheet.share")}</Text>
                </Pressable>
              </View>
            </>
          )}
        </BottomSheetView>
      </BottomSheet>
    );
  },
);
```
Add the dep: `cd mobile && bunx expo install expo-clipboard`.

- [ ] **Step 2: Open the sheet on ayah tap**

In `mobile/src/app/(tabs)/index.tsx`, hold a `BottomSheet` ref and expand it in `onSelectAyah`:
```tsx
import { useRef, useState } from "react";
import BottomSheet from "@gorhom/bottom-sheet";
import { AyahSheet } from "../../components/AyahSheet";
// ...
const sheetRef = useRef<BottomSheet>(null);
const [selected, setSelected] = useState<string | null>(null);
const onSelect = (k: string) => { setSelected(k); sheetRef.current?.expand(); };
// pass onSelectAyah={onSelect}; render <AyahSheet ref={sheetRef} verseKey={selected} /> after PagePager
```

- [ ] **Step 3: Verify on the S24**

Launch, tap an ayah, screenshot. Expected: sheet rises with Arabic text + translation; tapping Bookmark toggles the star and persists (re-open after relaunch — a Bookmarks list in Settings/Task 12 shows it).

- [ ] **Step 4: Commit**

```bash
git add mobile/src/components/AyahSheet.tsx mobile/src/app/(tabs)/index.tsx mobile/package.json
git commit -m "feat(mobile): ayah bottom sheet with translation, bookmark, copy, share"
```

---

## Task 12: Search screen

**Files:**
- Modify: `mobile/src/app/(tabs)/search.tsx`

- [ ] **Step 1: Implement search UI**

Replace `mobile/src/app/(tabs)/search.tsx`:
```tsx
import { useState } from "react";
import { FlatList, Pressable, Text, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { search } from "../../db/quranDb";
import { useUserStore } from "../../store/userStore";
import { t } from "../../i18n";
import type { SearchHit } from "../../db/schema";

export default function SearchScreen() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const setLastPage = useUserStore((s) => s.setLastPage);
  const run = async (text: string) => { setQ(text); setHits(text.trim() ? await search(text) : []); };
  return (
    <SafeAreaView style={{ flex: 1, padding: 12 }}>
      <TextInput
        value={q}
        onChangeText={run}
        placeholder={t("search.placeholder")}
        style={{ borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, textAlign: "right" }}
      />
      <FlatList
        data={hits}
        keyExtractor={(h) => h.verse_key}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => { setLastPage(item.page); router.navigate("/(tabs)"); }}
            style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: "#eee" }}
          >
            <Text style={{ color: "#888" }}>{item.verse_key} · p.{item.page}</Text>
            <Text numberOfLines={2}>{item.translation_en}</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Verify on the S24**

Launch, go to Search, type an Arabic word (e.g. الرحمن), screenshot. Expected: matching verses listed; tapping one jumps the Mushaf to that page.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/app/(tabs)/search.tsx
git commit -m "feat(mobile): local diacritic-insensitive search with jump-to-page"
```

---

## Task 13: Settings screen + bookmarks list

**Files:**
- Modify: `mobile/src/app/(tabs)/settings.tsx`
- Create: `mobile/src/theme.ts`

- [ ] **Step 1: Theme tokens**

Create `mobile/src/theme.ts`:
```ts
export const THEMES = {
  light: { bg: "#ffffff", text: "#111111", muted: "#888888", accent: "#007aff" },
  dark: { bg: "#111418", text: "#f2f2f2", muted: "#9aa0a6", accent: "#4f9dff" },
} as const;
export type ThemeName = keyof typeof THEMES;
```

- [ ] **Step 2: Implement settings + bookmarks**

Replace `mobile/src/app/(tabs)/settings.tsx`:
```tsx
import { FlatList, Pressable, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useUserStore } from "../../store/userStore";
import { getVerse } from "../../db/quranDb";
import { t } from "../../i18n";
import { useEffect, useState } from "react";

export default function SettingsScreen() {
  const { settings, setSettings, bookmarks, setLastPage } = useUserStore();
  const [pages, setPages] = useState<Record<string, number>>({});
  useEffect(() => {
    Promise.all(bookmarks.map((b) => getVerse(b.verseKey))).then((vs) =>
      setPages(Object.fromEntries(vs.filter(Boolean).map((v) => [v!.verse_key, v!.page]))));
  }, [bookmarks]);
  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 12 }}>
        <Text style={{ fontSize: 16 }}>{t("settings.language")}</Text>
        <Pressable onPress={() => setSettings({ language: settings.language === "ar" ? "en" : "ar" })}>
          <Text style={{ fontSize: 16, color: "#007aff" }}>{settings.language.toUpperCase()}</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 12 }}>
        <Text style={{ fontSize: 16 }}>{t("settings.theme")} (dark)</Text>
        <Switch
          value={settings.theme === "dark"}
          onValueChange={(on) => setSettings({ theme: on ? "dark" : "light" })}
        />
      </View>
      <Text style={{ fontSize: 18, marginTop: 20, marginBottom: 8 }}>★</Text>
      <FlatList
        data={bookmarks}
        keyExtractor={(b) => b.verseKey}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => { const p = pages[item.verseKey]; if (p) { setLastPage(p); router.navigate("/(tabs)"); } }}
            style={{ paddingVertical: 10 }}
          >
            <Text style={{ fontSize: 16 }}>{item.verseKey}</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
```

- [ ] **Step 3: Verify on the S24**

Launch, go to Settings. Expected: language toggle (EN/AR flips tab titles after reload), dark switch, and a bookmarks list that jumps to the page.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/app/(tabs)/settings.tsx mobile/src/theme.ts
git commit -m "feat(mobile): settings (language, theme) + bookmarks list"
```

---

## Task 14: Full-run tests + manual pass on the S24

- [ ] **Step 1: Run the whole unit suite**

Run: `cd mobile && bun run test`
Expected: all suites pass (quranDb, i18n, userStore, pageFont, MushafPage).

- [ ] **Step 2: Typecheck**

Run: `cd mobile && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual device pass**

On the S24, walk the full flow and screenshot each: open (resumes last page) → swipe pages → Index → pick a surah → tap an ayah (sheet + translation) → bookmark it → Search a word → jump to page → Settings (toggle theme, open bookmark). Confirm no tofu glyphs on at least 5 varied pages (1, 2, 255's page 42, 300, 604).

- [ ] **Step 4: Final commit / tag**

```bash
git add -A && git commit -m "test(mobile): Phase 1 reader verified on S24 (full manual pass)"
```

---

## Self-review notes

- **Spec coverage:** Mushaf rendering (Tasks 1,7,8,9) · navigation swipe + Index (9,10) · resume + bookmarks (6,9,11,13) · tap→translation sheet (11) · search (12) · settings language/theme (13) · DB rebuild with code_v2 (2) · fonts bundled+lazy (7) · offline db copy (4) · error fallbacks: first-launch copy guarded in Task 4; font-load failure falls back to bundled Amiri in `ensurePageFont` (Task 7, implemented), so `MushafPage` never renders blank.
- **Types:** `WordRow`/`VerseRow`/`SurahRow`/`SearchHit` defined in Task 4, used consistently in Tasks 8–13. `ensurePageFont(page)→family`, `getPageWords(page)→WordRow[]`, `search(text)→SearchHit[]` signatures match call sites.
