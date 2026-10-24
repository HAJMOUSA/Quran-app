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
