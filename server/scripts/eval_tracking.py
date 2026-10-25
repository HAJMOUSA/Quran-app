"""Phase-0 gate: live follow-along accuracy, simulated from a full-surah recording.

Streams a QDC surah MP3 through StreamingSession in 250 ms chunks (as the app
would) and compares the tracker position with Quran.com per-word timestamps.

Usage: python scripts/eval_tracking.py --surah 67 [--reciter 7] [--model ...] [--start-ayah 1]
Reciter ids: GET https://api.quran.com/api/v4/resources/recitations (7 = Mishary Alafasy).
"""
import argparse
import bisect
import statistics
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "server"))
from quran_server.asr import SAMPLE_RATE, QuranASR, load_audio  # noqa: E402
from quran_server.quran_index import QuranIndex  # noqa: E402
from quran_server.session import StreamingSession  # noqa: E402

CHUNK_S = 0.25


def fetch_surah(reciter: int, surah: int) -> tuple[Path, list]:
    url = f"https://api.qurancdn.com/api/qdc/audio/reciters/{reciter}/audio_files"
    meta = httpx.get(url, params={"chapter": surah, "segments": "true"}, timeout=60).json()["audio_files"][0]
    path = ROOT / "data" / "audio" / "qdc" / str(reciter) / f"{surah:03d}.mp3"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(httpx.get(meta["audio_url"], timeout=300, follow_redirects=True).content)
    return path, meta["verse_timings"]


def ground_truth(index: QuranIndex, timings: list) -> tuple[list[float], list[int]]:
    """Sorted (start_ms, gidx) of every word spoken."""
    pts: list[tuple[float, int]] = []
    for vt in timings:
        base = index.verse_start[vt["verse_key"]]
        for seg in vt["segments"]:
            if len(seg) >= 3:
                pts.append((seg[1], base + seg[0] - 1))
    pts.sort()
    return [p[0] for p in pts], [p[1] for p in pts]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--surah", type=int, default=67)
    ap.add_argument("--reciter", type=int, default=7)
    ap.add_argument("--model", default=None)
    ap.add_argument("--start-ayah", type=int, default=1, help="skip audio before this ayah")
    ap.add_argument("--max-seconds", type=float, default=180)
    args = ap.parse_args()

    index = QuranIndex(ROOT / "data" / "quran.db")
    path, timings = fetch_surah(args.reciter, args.surah)
    t_ms, gidx = ground_truth(index, timings)
    start_ms = next(vt["timestamp_from"] for vt in timings if vt["verse_key"].endswith(f":{args.start_ayah}"))
    audio = load_audio(str(path), start_ms / 1000, start_ms / 1000 + args.max_seconds)

    asr = QuranASR(args.model)
    sess = StreamingSession(asr, index)
    print(f"model={asr.model_name} device={asr.device} surah={args.surah} audio={len(audio) / SAMPLE_RATE:.0f}s")

    chunk = int(CHUNK_S * SAMPLE_RATE)
    lock_t = None
    lags: list[int] = []
    latencies: list[float] = []
    for off in range(0, len(audio), chunk):
        sess.add_audio(audio[off:off + chunk])
        for ev in sess.step():
            t = start_ms + (off + chunk) / SAMPLE_RATE * 1000
            if ev["type"] == "transcript":
                latencies.append(ev["latency"])
            if ev["type"] == "track" and ev["position"] is not None:
                if lock_t is None:
                    lock_t = (t - start_ms) / 1000
                    print(f"locked after {lock_t:.1f}s at {ev['current']['verse_key']}")
                k = bisect.bisect_right(t_ms, t) - 1
                if k >= 0:
                    truth_next = gidx[k] + 1  # word being recited now has started
                    lags.append(truth_next - ev["position"])

    st = sess.tracker.state.statuses
    covered = [g for g in gidx if g in st]
    correct = sum(1 for g in covered if st[g] == "correct")
    print(f"position updates: {len(lags)}  |lag| median {statistics.median(map(abs, lags)) if lags else 'n/a'} words, "
          f"within ±3 words {sum(abs(x) <= 3 for x in lags) / max(1, len(lags)):.1%}")
    print(f"words scored: {len(covered)}  correct {correct / max(1, len(covered)):.1%} "
          f"(professional recitation → anything else is a false mistake)")
    print(f"ASR latency median {statistics.median(latencies):.2f}s max {max(latencies):.2f}s")
    bad = [(index.verse_key[g], index.position[g], index.norm[g], st[g]) for g in covered if st[g] != "correct"]
    for b in bad[:20]:
        print("  flagged", b)


if __name__ == "__main__":
    main()
