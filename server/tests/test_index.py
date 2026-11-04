import random
from pathlib import Path

import pytest

from quran_server.normalize import normalize_text, normalize_words
from quran_server.quran_index import QuranIndex, word_correct
from quran_server.tracker import Tracker

DB = Path(__file__).resolve().parents[2] / "data" / "quran.db"


@pytest.fixture(scope="module")
def index():
    if not DB.exists():
        pytest.skip("data/quran.db missing: run server/scripts/build_quran_db.py")
    return QuranIndex(DB)


def test_normalize_strips_tashkeel_and_unifies_alef():
    assert normalize_text("بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ") == "بسم الله الرحمن"
    assert normalize_words("إِيَّاكَ نَعْبُدُ") == ["اياك", "نعبد"]
    assert normalize_text("هُدًى لِّلْمُتَّقِينَ") == "هدي للمتقين"


def test_index_size(index):
    assert index.size == 77429
    assert index.verse_key[0] == "1:1"
    assert index.verse_key[-1] == "114:6"


def test_search_exact_ayah(index):
    # Ayat al-Kursi opening
    q = normalize_words("الله لا إله إلا هو الحي القيوم لا تأخذه سنة ولا نوم")
    best = index.search(q)[0]
    assert best.verse_keys[0] == "2:255"
    assert best.score > 0.9


def test_search_with_asr_errors(index):
    # Al-Mulk 67:1 with two corrupted words and one missing word
    q = normalize_words("تبارك الذي بيدة الملك وهو على كل شي")
    best = index.search(q)[0]
    assert best.verse_keys == ["67:1"]


def test_search_random_excerpts(index):
    rng = random.Random(42)
    ok = 0
    trials = 200
    for _ in range(trials):
        start = rng.randrange(index.size - 12)
        q = index.norm[start:start + 8]
        res = index.search(q)
        if res and res[0].start <= start + 1 and res[0].end >= start + 6:
            ok += 1
    # Exact 8-word excerpts: only genuinely repeated passages may miss.
    assert ok / trials > 0.95


def test_repeated_phrase_is_ambiguous(index):
    q = normalize_words("فبأي آلاء ربكما تكذبان")
    res = index.search(q, top_k=5)
    assert len(res) >= 2
    assert abs(res[0].score - res[1].score) < 0.05


def test_tracker_locks_and_follows(index):
    tr = Tracker(index)
    s = index.verse_start["36:1"]  # Ya-Sin
    ev = tr.update(index.norm[s:s + 6])
    assert tr.state.mode == "track"
    assert ev["position"] == s + 6
    # Overlapping sliding windows, as the streaming session produces them.
    for end in range(s + 9, s + 40, 3):
        ev = tr.update(index.norm[max(s, end - 10):end])
        assert ev["position"] == end
    assert all(v == "correct" for v in tr.state.statuses.values())


def test_tracker_flags_skipped_and_wrong_words(index):
    s = index.verse_start["112:1"]
    tr = Tracker(index, start_gidx=s)
    words = list(index.norm[s:s + 12])
    words[3] = "زززز"      # wrong word
    del words[7]           # skipped word (index 7 in reference)
    tr.update(words)
    st = tr.state.statuses
    assert st[s + 3] == "wrong"
    assert st[s + 7] == "missed"
    assert st[s + 0] == "correct"


def test_tracker_recovers_after_jump(index):
    s = index.verse_start["1:1"]
    tr = Tracker(index, start_gidx=s)
    tr.update(index.norm[s:s + 6])
    far = index.verse_start["18:10"]
    ev = None
    for k in range(6):
        ev = tr.update(index.norm[far:far + 6 + k])
    assert tr.state.mode == "track"
    assert index.verse_key[tr.state.position - 1].startswith("18:")


def test_split_asr_word_matches_joined_mushaf_word(index):
    s = index.verse_start["36:20"]
    ref = index.norm[s:s + 12]
    k = ref.index("ياقوم")
    words = ref[:k] + ["يا", "قوم"] + ref[k + 1:]
    tr = Tracker(index, start_gidx=s)
    tr.update(words)
    assert tr.state.statuses[s + k] == "correct"


def test_tracker_folds_query_so_correct_recitation_stays_correct():
    if not DB.exists():
        pytest.skip("data/quran.db missing")
    idx = QuranIndex(DB, fold=True)            # folds reference: الصراط -> السرات
    s = idx.verse_start["1:6"]                 # اهدنا الصراط المستقيم
    tr = Tracker(idx, start_gidx=s)
    tr.update(["اهدنا", "الصراط", "المستقيم"])  # ASR output = correct orthography
    assert tr.state.statuses[s + 1] == "correct"  # الصراط; was "wrong" before the fix


def test_word_correct_is_length_aware():
    assert word_correct(0.75, 4) is True    # 4-letter word, one edit → correct
    assert word_correct(0.75, 3) is False   # 3-letter word stays strict
    assert word_correct(0.80, 5) is True
    assert word_correct(0.79, 6) is False
    assert word_correct(0.50, 4) is False   # two edits on a 4-letter word
