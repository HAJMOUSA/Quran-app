"""Build data/quran.db from the Quran.com API v4.

Usage:  python server/scripts/build_quran_db.py [--out data/quran.db]

Raw API responses are cached in data/raw/ so re-runs are offline and fast.
The same quran.db is used by the server (matching index) and bundled in the app.
"""
import argparse
import json
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
from quran_server.normalize import normalize_text  # noqa: E402

API = "https://api.quran.com/api/v4"
TRANSLATION_ID = 20  # Saheeh International
PAGES = 604

SCHEMA = """
CREATE TABLE surahs(
  id INTEGER PRIMARY KEY, name_arabic TEXT, name_simple TEXT, name_translated TEXT,
  revelation_place TEXT, verses_count INTEGER, first_page INTEGER, last_page INTEGER);
CREATE TABLE verses(
  id INTEGER PRIMARY KEY, verse_key TEXT UNIQUE, surah INTEGER, ayah INTEGER,
  page INTEGER, juz INTEGER, hizb INTEGER,
  text_uthmani TEXT, text_simple TEXT, norm TEXT, translation_en TEXT);
CREATE TABLE words(
  id INTEGER PRIMARY KEY, verse_id INTEGER, verse_key TEXT, surah INTEGER, ayah INTEGER,
  position INTEGER, page INTEGER, line INTEGER, char_type TEXT,
  text_uthmani TEXT, text_simple TEXT, code_v2 TEXT, v2_page INTEGER,
  norm TEXT, gidx INTEGER, translation_en TEXT);
CREATE INDEX idx_words_page ON words(page, line, id);
CREATE INDEX idx_words_gidx ON words(gidx);
CREATE INDEX idx_verses_page ON verses(page);
CREATE INDEX idx_verses_surah ON verses(surah, ayah);
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
"""


def fetch_json(client: httpx.Client, url: str, cache: Path, params: dict | None = None):
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    for attempt in range(5):
        try:
            r = client.get(url, params=params, timeout=60)
            r.raise_for_status()
            data = r.json()
            cache.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            return data
        except (httpx.HTTPError, ValueError) as exc:
            if attempt == 4:
                raise
            print(f"  retry {url}: {exc}")
            time.sleep(2 * (attempt + 1))


def fetch_page(client: httpx.Client, raw: Path, page: int):
    params = {
        "words": "true",
        "word_fields": "text_uthmani,text_imlaei_simple,line_number,page_number,code_v2,v2_page",
        "fields": "text_uthmani,text_imlaei_simple,juz_number,hizb_number,page_number",
        "translations": str(TRANSLATION_ID),
        "per_page": "50",
    }
    return fetch_json(client, f"{API}/verses/by_page/{page}", raw / f"page_{page:03d}.json", params)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "data" / "quran.db"))
    args = ap.parse_args()

    raw = ROOT / "data" / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    with httpx.Client(headers={"User-Agent": "quran-app-builder/0.1"}) as client:
        chapters = fetch_json(client, f"{API}/chapters", raw / "chapters.json")["chapters"]
        print(f"chapters: {len(chapters)}; fetching {PAGES} pages...")
        with ThreadPoolExecutor(max_workers=8) as pool:
            pages = list(pool.map(lambda p: fetch_page(client, raw, p), range(1, PAGES + 1)))

    if out.exists():
        out.unlink()
    db = sqlite3.connect(out)
    db.executescript(SCHEMA)

    for c in chapters:
        db.execute(
            "INSERT INTO surahs VALUES (?,?,?,?,?,?,?,?)",
            (c["id"], c["name_arabic"], c["name_simple"], c["translated_name"]["name"],
             c["revelation_place"], c["verses_count"], c["pages"][0], c["pages"][-1]),
        )

    gidx = 0
    n_verses = 0
    for page_data in pages:
        verses = page_data["verses"]
        if page_data["pagination"]["total_pages"] != 1:
            raise RuntimeError("page has more than one API page of verses; raise per_page")
        for v in verses:
            surah, ayah = map(int, v["verse_key"].split(":"))
            translation = (v.get("translations") or [{}])[0].get("text", "")
            db.execute(
                "INSERT INTO verses VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (v["id"], v["verse_key"], surah, ayah, v["page_number"], v["juz_number"],
                 v["hizb_number"], v["text_uthmani"], v["text_imlaei_simple"],
                 normalize_text(v["text_imlaei_simple"]), translation),
            )
            n_verses += 1
            for w in v["words"]:
                is_word = w["char_type_name"] == "word"
                norm = normalize_text(w["text_imlaei_simple"]) if is_word else ""
                # Some words normalize to two tokens (rare); keep them as one word.
                norm = norm.replace(" ", "")
                g = None
                if is_word and norm:
                    g = gidx
                    gidx += 1
                db.execute(
                    "INSERT INTO words VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (w["id"], v["id"], v["verse_key"], surah, ayah, w["position"],
                     w["page_number"], w["line_number"], w["char_type_name"],
                     w["text_uthmani"], w["text_imlaei_simple"], w.get("code_v2"), w.get("v2_page"),
                     norm, g, (w.get("translation") or {}).get("text")),
                )

    db.execute("INSERT INTO meta VALUES ('source', 'api.quran.com v4')")
    db.execute("INSERT INTO meta VALUES ('built', ?)", (time.strftime("%Y-%m-%d"),))
    db.execute("INSERT INTO meta VALUES ('word_count', ?)", (str(gidx),))
    db.commit()
    db.execute("VACUUM")
    db.close()
    print(f"wrote {out}: {n_verses} verses, {gidx} recitable words")
    if n_verses != 6236:
        raise SystemExit(f"expected 6236 verses, got {n_verses}")


if __name__ == "__main__":
    main()
