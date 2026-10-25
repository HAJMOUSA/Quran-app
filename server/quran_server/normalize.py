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
