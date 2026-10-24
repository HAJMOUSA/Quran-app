import os, glob
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
FONTS = ROOT / "mobile" / "assets" / "fonts" / "qcf2"

def test_604_subset_fonts_exist_and_small():
    files = sorted(glob.glob(str(FONTS / "QCF2*.ttf")))
    assert len(files) == 604
    total_mb = sum(os.path.getsize(f) for f in files) / (1024*1024)
    assert total_mb < 80, f"subset fonts too large: {total_mb:.1f} MB"

def test_sample_font_has_required_glyphs():
    import sqlite3
    from fontTools.ttLib import TTFont
    db = sqlite3.connect(ROOT / "data" / "quran.db")
    for page in (1, 300, 604):
        needed = set()
        for (c,) in db.execute("SELECT code_v2 FROM words WHERE v2_page=? AND code_v2!=''", (page,)):
            needed.update(ord(ch) for ch in c)
        cmap = TTFont(FONTS / f"QCF2{page:03d}.ttf").getBestCmap()
        missing = [cp for cp in needed if cp not in cmap]
        assert not missing, f"page {page} missing {len(missing)} glyphs"
