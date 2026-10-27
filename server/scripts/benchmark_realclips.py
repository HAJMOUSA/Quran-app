"""Benchmark ASR models on the user's own recordings (data/realclips/).

Measures what matters for each phase:
- WER (word error rate) vs the recited reference  -> Phase 4 follow-along quality
- top-1 / top-3 correct-surah match               -> Phase 3 recite-to-search quality
- latency

Usage: python scripts/benchmark_realclips.py
"""
import gc
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from rapidfuzz.distance import Levenshtein

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
from quran_server.asr import QuranASR  # noqa: E402
from quran_server.normalize import normalize_words  # noqa: E402
from quran_server.quran_index import QuranIndex  # noqa: E402

CLIPS = ROOT / "data" / "realclips"
# Ground truth per clip, in recording order (from the recited content).
REFS = [
    ["1:4", "1:5"],            # Al-Fatiha (…مالك يوم الدين إياك نعبد وإياك نستعين)
    ["112:2", "112:3", "112:4"],  # Al-Ikhlas
    ["113:2", "113:3"],        # Al-Falaq
    ["2:255"],                 # Ayat al-Kursi
    ["2:7"],                   # Al-Baqara
    ["18:4", "18:5"],          # Al-Kahf
    ["36:12"],                 # Ya-Sin
    ["55:21", "55:22"],        # Ar-Rahman
    ["67:5"],                  # Al-Mulk
    ["78:13", "78:14"],        # An-Naba
    ["108:3"],                 # Al-Kawthar
]
MODELS = sys.argv[1:] or [
    "tarteel-ai/whisper-base-ar-quran",
    "openai/whisper-large-v3-turbo",
    "openai/whisper-large-v3",
]


def ref_text(index: QuranIndex, verse_keys: list[str]) -> list[str]:
    words: list[str] = []
    for vk in verse_keys:
        g = index.verse_start[vk]
        while g < index.size and index.verse_key[g] == vk:
            words.append(index.norm[g])
            g += 1
    return words


def main() -> None:
    index = QuranIndex(ROOT / "data" / "quran.db")
    clips = sorted(CLIPS.glob("*.wav"))
    assert len(clips) == len(REFS), f"{len(clips)} clips vs {len(REFS)} refs"
    refs = [ref_text(index, r) for r in REFS]
    ref_surahs = [{int(k.split(':')[0]) for k in r} for r in REFS]
    audios = [sf.read(str(c), dtype="float32")[0] for c in clips]

    print(f"clips={len(clips)}  (WER vs recited ref; match = correct surah in candidates)\n")
    for model in MODELS:
        asr = QuranASR(model)
        wer_num = wer_den = 0
        top1 = top3 = 0
        lat = []
        hyps = []
        for audio, ref, surahs in zip(audios, refs, ref_surahs):
            t0 = time.perf_counter()
            text, _ = asr.transcribe(audio)
            lat.append(time.perf_counter() - t0)
            hyp = normalize_words(text)
            hyps.append(" ".join(hyp))
            wer_num += Levenshtein.distance(ref, hyp)
            wer_den += len(ref)
            cands = index.search(hyp, top_k=3)
            hit = [bool(surahs & {int(k.split(':')[0]) for k in c.verse_keys}) for c in cands]
            top1 += bool(hit[:1] and hit[0])
            top3 += any(hit)
        n = len(clips)
        print(f"=== {model} ===", flush=True)
        print(f"  WER {wer_num / wer_den:.1%}   top-1 {top1}/{n}   top-3 {top3}/{n}   "
              f"latency median {np.median(lat):.2f}s", flush=True)
        for i, (h, r) in enumerate(zip(hyps, REFS), 1):
            print(f"   {i:2}. {r}: {h}", flush=True)
        del asr
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
