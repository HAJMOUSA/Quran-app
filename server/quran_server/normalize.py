"""Arabic normalization used ONLY for matching (never for display)."""
import re

# Tashkeel, superscript alef, Quranic annotation marks, tatweel.
_DIACRITICS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")
_NON_ARABIC = re.compile(r"[^ء-ي\s]")
_SPACES = re.compile(r"\s+")

_CHAR_MAP = str.maketrans({
    "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ٲ": "ا", "ٳ": "ا",
    "ى": "ي", "ی": "ي", "ئ": "ي",
    "ؤ": "و",
    "ة": "ه",
    "ک": "ك",
})


def normalize_text(text: str) -> str:
    text = _DIACRITICS.sub("", text)
    text = text.translate(_CHAR_MAP)
    text = _NON_ARABIC.sub(" ", text)
    return _SPACES.sub(" ", text).strip()


def normalize_words(text: str) -> list[str]:
    norm = normalize_text(text)
    return norm.split() if norm else []


# Phonetic folding for MATCHING ONLY (never display): collapse consonants that
# Arabic ASR routinely confuses, so a wrong letter still aligns. Targets are
# fixed points, so folding is idempotent.
_FOLD_MAP = str.maketrans({
    "ث": "ت", "ط": "ت",          # ت ث ط
    "ص": "س",                     # س ص
    "ذ": "ز", "ظ": "ز",          # ز ذ ظ
    "ض": "د",                     # د ض
    "ق": "ك",                     # ك ق
    "ح": "ه",                     # ه ح
    "ى": "ا",                     # alef maqsura already -> ي in normalize; guard anyway
    "ء": "ا",
    "ة": "ه",
})


def fold_phonetic(norm: str) -> str:
    return norm.translate(_FOLD_MAP)
