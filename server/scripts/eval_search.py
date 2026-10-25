"""Phase-0 gate: "recite to search" accuracy on real reciter audio.

For random ayat × reciters (EveryAyah per-ayah MP3s): cut a 3–8 s excerpt, run ASR
+ search, check the true ayah is in the top-1 / top-3 candidates.

Caveat: Tarteel's models were trained on EveryAyah reciters, so these numbers are
optimistic; use --noise-snr and your own recordings (--wav-dir) for a fair picture.

Usage: python scripts/eval_search.py --n 60 [--model tarteel-ai/whisper-tiny-ar-quran] [--noise-snr 10]
"""
import argparse
import random
import statistics
import sys
import time
from pathlib import Path

import httpx
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
from quran_server.asr import SAMPLE_RATE, QuranASR, load_audio  # noqa: E402
from quran_server.normalize import normalize_words  # noqa: E402
from quran_server.quran_index import QuranIndex, align  # noqa: E402

RECITERS = [
    "Alafasy_128kbps",
    "Husary_128kbps",
    "Abdul_Basit_Murattal_192kbps",
    "Minshawy_Murattal_128kbps",
    "Ghamadi_40kbps",
    "Saood_ash-Shuraym_128kbps",
]
AUDIO = ROOT / "data" / "audio" / "everyayah"


def fetch_ayah(client: httpx.Client, reciter: str, surah: int, ayah: int) -> Path:
    path = AUDIO / reciter / f"{surah:03d}{ayah:03d}.mp3"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        r = client.get(f"https://everyayah.com/data/{reciter}/{path.name}", timeout=60)
        r.raise_for_status()
        path.write_bytes(r.content)
    return path


def add_noise(audio: np.ndarray, snr_db: float, rng: np.random.Generator) -> np.ndarray:
    p = float(np.mean(audio ** 2)) or 1e-9
    noise = rng.normal(0, np.sqrt(p / 10 ** (snr_db / 10)), audio.shape)
    return (audio + noise).astype(np.float32)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=60)
    ap.add_argument("--model", default=None)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--noise-snr", type=float, default=None, help="add white noise at this SNR (dB)")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    nrng = np.random.default_rng(args.seed)
    index = QuranIndex(ROOT / "data" / "quran.db")
    asr = QuranASR(args.model)
    verse_keys = list(index.verse_start.keys())
    print(f"model={asr.model_name} device={asr.device} n={args.n} noise={args.noise_snr}")

    top1 = top3 = tie1 = 0
    latencies: list[float] = []
    failures: list[str] = []
    with httpx.Client() as client:
        for i in range(args.n):
            vk = rng.choice(verse_keys)
            reciter = RECITERS[i % len(RECITERS)]
            s, a = map(int, vk.split(":"))
            audio = load_audio(str(fetch_ayah(client, reciter, s, a)))
            clip_len = int(rng.uniform(3, 8) * SAMPLE_RATE)
            if len(audio) > clip_len:
                off = rng.randrange(len(audio) - clip_len)
                audio = audio[off:off + clip_len]
            if args.noise_snr is not None:
                audio = add_noise(audio, args.noise_snr, nrng)
            t0 = time.perf_counter()
            text, _ = asr.transcribe(audio)
            words = normalize_words(text)
            cands = index.search(words, top_k=3)
            latencies.append(time.perf_counter() - t0)
            hit = [vk in c.verse_keys for c in cands]
            top1 += bool(hit[:1] and hit[0])
            top3 += any(hit)
            # Text-indistinguishable: the true ayah scores as well as the winner
            # (identical wording elsewhere, e.g. 26:107 == 26:178).
            lo = index.verse_start[vk]
            hi = lo + sum(1 for k in index.verse_key[lo:lo + 200] if k == vk)
            true_a = align(words, index.norm[max(0, lo - 3):hi + 3], max(0, lo - 3)) if words else None
            tie1 += bool(cands and true_a and true_a.norm_score >= cands[0].score - 0.02)
            if not (hit[:1] and hit[0]):
                got = cands[0].verse_keys if cands else []
                failures.append(f"{vk:>8} {reciter:<32} got={got} text={text}")

    print(f"top-1 {top1 / args.n:.1%}   top-1 incl. identical-text ties {tie1 / args.n:.1%}   "
          f"top-3 {top3 / args.n:.1%}   "
          f"latency median {statistics.median(latencies):.2f}s p95 {sorted(latencies)[int(0.95 * len(latencies)) - 1]:.2f}s")
    if failures:
        print("misses (often repeated phrases — check whether the top-1 text is identical):")
        for f in failures:
            print("  " + f)


if __name__ == "__main__":
    main()
