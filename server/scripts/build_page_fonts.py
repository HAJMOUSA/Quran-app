#!/usr/bin/env python
"""Build per-page QCF2 V2 subset fonts for the Quran app.

Each Mushaf page (v2_page 1..604) uses its own page font. The full TTFs are
~350 KB each (~211 MB total) which is too large to bundle. This script
downloads the full fonts (cached under data/fonts_src/), subsets each one to
*only* the glyphs that page actually uses (collected from the `code_v2` column
of the `words` table), and writes the small subset fonts to the mobile assets
dir as bundled app assets. It also downloads an Amiri fallback once.

Usage:
    ./server/.venv/Scripts/python.exe server/scripts/build_page_fonts.py

Run with --verify-only to just re-check already-built subsets.
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

PAGES = range(1, 605)  # 1..604

FONT_URL = "https://static.qurancdn.com/fonts/quran/hafs/v2/ttf/p{n}.ttf"
FONT_URL_MIRROR = (
    "https://raw.githubusercontent.com/quran/quran.com-frontend-next/"
    "master/public/fonts/quran/hafs/v2/ttf/p{n}.ttf"
)

AMIRI_URLS = [
    # Original spec URLs (currently 404 -- repo layout changed) kept first so the
    # script self-heals if upstream restores them:
    "https://raw.githubusercontent.com/alif-type/amiri/master/AmiriQuran-Regular.ttf",
    "https://github.com/aliftype/amiri/releases/latest/download/AmiriQuran-Regular.ttf",
    # Working mirror (Google Fonts OFL repo) -- verified 200, 136 KB:
    "https://raw.githubusercontent.com/google/fonts/main/ofl/amiriquran/AmiriQuran-Regular.ttf",
]

VERIFY_PAGES = [1, 100, 300, 604]

HTTP_TIMEOUT = httpx.Timeout(60.0)
MAX_RETRIES = 4


def codepoints_for_page(db: sqlite3.Connection, page: int) -> set[int]:
    """Collect every Unicode codepoint used by any code_v2 glyph on this page.

    Includes both char_type='word' and char_type='end' rows (both carry
    renderable code_v2 glyphs) -- the query simply does not filter on char_type.
    """
    cps: set[int] = set()
    rows = db.execute(
        "SELECT code_v2 FROM words "
        "WHERE v2_page=? AND code_v2 IS NOT NULL AND code_v2 != ''",
        (page,),
    )
    for (code,) in rows:
        for ch in code:
            cp = ord(ch)
            # Some code_v2 strings use U+0020 (and occasionally other ASCII
            # whitespace/controls) purely as a separator between glyph
            # codepoints. No QCF2 page font maps U+0020 to a glyph -- it renders
            # as blank whitespace, never tofu -- so it is not a required glyph
            # and must be excluded from the subset/VERIFY set.
            if ch.isspace() or cp < 0x20:
                continue
            cps.add(cp)
    return cps


def download_one(client: httpx.Client, page: int, dst: Path) -> tuple[int, str | None]:
    """Download the full font for a page, trying primary then mirror URL.

    Returns (page, error_message_or_None).
    """
    urls = [FONT_URL.format(n=page), FONT_URL_MIRROR.format(n=page)]
    last_err: str | None = None
    for url in urls:
        for attempt in range(MAX_RETRIES):
            try:
                resp = client.get(url, follow_redirects=True)
                if resp.status_code == 200 and resp.content:
                    tmp = dst.with_suffix(".ttf.part")
                    tmp.write_bytes(resp.content)
                    tmp.replace(dst)
                    return page, None
                last_err = f"HTTP {resp.status_code} from {url}"
                if resp.status_code == 404:
                    break  # try next url, 404 won't fix with retries
            except (httpx.HTTPError, OSError) as exc:  # transient
                last_err = f"{type(exc).__name__}: {exc} ({url})"
            time.sleep(0.5 * (attempt + 1))
    return page, last_err


def ensure_source_fonts(src_dir: Path) -> list[int]:
    """Download any missing full page fonts into src_dir. Returns failed pages."""
    src_dir.mkdir(parents=True, exist_ok=True)
    missing = [n for n in PAGES if not (src_dir / f"p{n}.ttf").exists()]
    if not missing:
        print(f"All {len(list(PAGES))} source fonts already cached in {src_dir}")
        return []

    print(f"Downloading {len(missing)} missing source fonts into {src_dir} ...")
    failed: list[int] = []
    with httpx.Client(timeout=HTTP_TIMEOUT) as client:
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {
                pool.submit(download_one, client, n, src_dir / f"p{n}.ttf"): n
                for n in missing
            }
            done = 0
            for fut in as_completed(futures):
                page, err = fut.result()
                done += 1
                if err:
                    failed.append(page)
                    print(f"  [FAIL] p{page}: {err}")
                if done % 50 == 0:
                    print(f"  ...{done}/{len(missing)} downloaded")
    if failed:
        print(f"WARNING: {len(failed)} source fonts failed to download: "
              f"{sorted(failed)}")
    return sorted(failed)


def _build_subset_options() -> Options:
    opt = Options()
    opt.glyph_names = False          # smaller output
    opt.notdef_outline = True
    opt.recalc_bounds = True
    opt.drop_tables = []             # keep defaults; do NOT strip cmap/GSUB/GPOS
    return opt


def subset_page(src_path: Path, dst_path: Path, codepoints: set[int]) -> None:
    opt = _build_subset_options()
    f = TTFont(str(src_path))
    ss = Subsetter(options=opt)
    ss.populate(unicodes=sorted(codepoints))
    ss.subset(f)
    dst_path.parent.mkdir(parents=True, exist_ok=True)
    f.save(str(dst_path))
    f.close()


def download_amiri(dst: Path) -> None:
    if dst.exists():
        print(f"Amiri fallback already present: {dst}")
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=HTTP_TIMEOUT) as client:
        for url in AMIRI_URLS:
            try:
                resp = client.get(url, follow_redirects=True)
                if resp.status_code == 200 and resp.content:
                    dst.write_bytes(resp.content)
                    print(f"Downloaded Amiri fallback from {url} -> {dst} "
                          f"({len(resp.content)/1024:.0f} KB)")
                    return
                print(f"  Amiri {url} -> HTTP {resp.status_code}")
            except httpx.HTTPError as exc:
                print(f"  Amiri {url} -> {type(exc).__name__}: {exc}")
    print("WARNING: failed to download Amiri fallback from all sources.")


def verify(db: sqlite3.Connection, out_dir: Path, pages: list[int]) -> list[str]:
    """Re-open sample subset fonts and assert all required codepoints are in cmap.

    Returns a list of failure messages (empty => all good).
    """
    failures: list[str] = []
    for page in pages:
        needed = codepoints_for_page(db, page)
        dst = out_dir / f"QCF2{page:03d}.ttf"
        if not dst.exists():
            failures.append(f"page {page}: subset font missing ({dst})")
            continue
        font = TTFont(str(dst))
        cmap = font.getBestCmap()
        font.close()
        missing = sorted(cp for cp in needed if cp not in cmap)
        if missing:
            miss_hex = ", ".join(f"U+{cp:04X}" for cp in missing[:20])
            more = "" if len(missing) <= 20 else f" (+{len(missing)-20} more)"
            failures.append(
                f"page {page}: {len(missing)}/{len(needed)} required codepoints "
                f"MISSING from subset cmap: {miss_hex}{more}"
            )
        else:
            print(f"  VERIFY page {page}: OK ({len(needed)} codepoints present)")
    return failures


def total_size_mb(out_dir: Path) -> float:
    files = list(out_dir.glob("QCF2*.ttf"))
    return sum(f.stat().st_size for f in files) / (1024 * 1024)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", default="data/quran.db", type=Path)
    ap.add_argument("--out", default="mobile/assets/fonts/qcf2", type=Path)
    ap.add_argument("--src", default="data/fonts_src", type=Path)
    ap.add_argument("--amiri", default="mobile/assets/fonts/AmiriQuran-Regular.ttf",
                    type=Path)
    ap.add_argument("--verify-only", action="store_true",
                    help="skip download/subset; only run VERIFY on existing output")
    args = ap.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    db_path = args.db if args.db.is_absolute() else repo_root / args.db
    out_dir = args.out if args.out.is_absolute() else repo_root / args.out
    src_dir = args.src if args.src.is_absolute() else repo_root / args.src
    amiri_path = args.amiri if args.amiri.is_absolute() else repo_root / args.amiri

    if not db_path.exists():
        print(f"ERROR: db not found: {db_path}", file=sys.stderr)
        return 2

    db = sqlite3.connect(str(db_path))

    if args.verify_only:
        print("VERIFY-only mode")
        failures = verify(db, out_dir, VERIFY_PAGES)
        if failures:
            print("\nVERIFY FAILED:")
            for f in failures:
                print("  " + f)
            return 1
        print("VERIFY passed.")
        return 0

    # 1. Ensure source fonts are downloaded/cached.
    dl_failed = ensure_source_fonts(src_dir)

    # 2/3. Subset each page.
    out_dir.mkdir(parents=True, exist_ok=True)
    written = 0
    empty_pages: list[int] = []
    subset_failed: list[int] = []
    for n in PAGES:
        src_path = src_dir / f"p{n}.ttf"
        if not src_path.exists():
            subset_failed.append(n)
            continue
        cps = codepoints_for_page(db, n)
        if not cps:
            empty_pages.append(n)
        dst_path = out_dir / f"QCF2{n:03d}.ttf"
        try:
            subset_page(src_path, dst_path, cps)
            written += 1
        except Exception as exc:  # noqa: BLE001 -- report and keep going
            subset_failed.append(n)
            print(f"  [SUBSET FAIL] p{n}: {type(exc).__name__}: {exc}")
        if n % 100 == 0:
            print(f"  ...subset {n}/604")

    # 4. Report count + total size.
    size_mb = total_size_mb(out_dir)
    print(f"\nFonts written: {written}/604")
    print(f"Total size of {out_dir}: {size_mb:.1f} MB "
          f"(avg {size_mb*1024/max(written,1):.1f} KB/font)")
    if empty_pages:
        print(f"NOTE: {len(empty_pages)} pages had no code_v2 glyphs: {empty_pages}")
    if subset_failed:
        print(f"WARNING: {len(subset_failed)} pages failed to subset: {subset_failed}")

    # 5. Amiri fallback.
    download_amiri(amiri_path)

    # VERIFY step -- fail loudly if any required codepoint is missing.
    print("\nVERIFY step (sample pages " + str(VERIFY_PAGES) + "):")
    failures = verify(db, out_dir, VERIFY_PAGES)
    db.close()

    if dl_failed or subset_failed:
        print("\nBUILD INCOMPLETE: some pages failed download/subset (see above).")
        return 1
    if failures:
        print("\nVERIFY FAILED (would cause tofu on-device):")
        for f in failures:
            print("  " + f)
        return 1

    print("\nVERIFY passed. Build complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
