"""Stream an audio file to a running server's /ws/recite, like the app does.

Usage: python scripts/ws_client.py data/audio/qdc/7/067.mp3 [--url ws://localhost:8000/ws/recite] [--seconds 30] [--fast]
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

import numpy as np
import websockets

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from quran_server.asr import SAMPLE_RATE, load_audio  # noqa: E402

CHUNK_S = 0.25


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--url", default="ws://localhost:8000/ws/recite")
    ap.add_argument("--seconds", type=float, default=30)
    ap.add_argument("--fast", action="store_true", help="do not pace in real time")
    args = ap.parse_args()

    audio = load_audio(args.file, 0, args.seconds)
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
    chunk = int(CHUNK_S * SAMPLE_RATE) * 2

    async with websockets.connect(args.url, max_size=None) as ws:
        await ws.send(json.dumps({"type": "start", "sample_rate": SAMPLE_RATE}))
        print(await ws.recv())

        async def reader():
            async for msg in ws:
                ev = json.loads(msg)
                if ev["type"] == "transcript":
                    print(f"[{ev['t']:6.2f}s] asr ({ev['latency']}s): {ev['text']}")
                elif ev["type"] == "track":
                    cur = ev.get("current") or {}
                    bad = [c for c in ev["changed"] if c["status"] != "correct"]
                    print(f"          track → {cur.get('verse_key')} word {cur.get('position')} page {cur.get('page')}"
                          f"{'  LOCKED' if ev.get('locked') else ''}{'  flags=' + str(bad) if bad else ''}")
                elif ev["type"] == "search":
                    print("          search:", [(c["verse_keys"][0], c["score"]) for c in ev["candidates"]])

        rt = asyncio.create_task(reader())
        for off in range(0, len(pcm), chunk):
            await ws.send(pcm[off:off + chunk])
            if not args.fast:
                await asyncio.sleep(CHUNK_S)
        await asyncio.sleep(2)
        await ws.send(json.dumps({"type": "stop"}))
        rt.cancel()


if __name__ == "__main__":
    asyncio.run(main())
