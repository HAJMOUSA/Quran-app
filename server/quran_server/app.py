"""FastAPI server: text/audio search + WebSocket live follow-along.

Run:  uvicorn quran_server.app:app --host 0.0.0.0 --port 8000   (from server/)

WebSocket /ws/recite protocol
  client → server  text  {"type":"start","sample_rate":16000,"start_gidx":null}
                   binary PCM16 little-endian mono frames (any size)
                   text  {"type":"lock","gidx":123}   user picked a candidate
                   text  {"type":"reset"} | {"type":"stop"}
  server → client  {"type":"ready","model":...}
                   {"type":"transcript","text":...,"latency":...}
                   {"type":"search","candidates":[{start,end,score,verse_keys,page}]}
                   {"type":"track","position":g,"current":{...},"changed":[{gidx,word_id,status}],"locked"?:true}
                   {"type":"silence"} | {"type":"error","message":...}
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .asr import SAMPLE_RATE, QuranASR, decode_audio_bytes, pcm16_to_float, resample, save_wav
from .normalize import normalize_words
from .quran_index import QuranIndex
from .session import StreamingSession

log = logging.getLogger("quran_server")
DB_PATH = Path(os.environ.get("QURAN_DB", Path(__file__).resolve().parents[2] / "data" / "quran.db"))
MAX_UPLOAD_S = 30
MIN_SR, MAX_SR = 8_000, 48_000     # accepted input sample rates
MAX_BODY_BYTES = 12 * 1024 * 1024  # ~30 s of 16-bit 48 kHz mono + file overhead
MAX_WS_FRAME_BYTES = 1024 * 1024   # one streamed PCM frame
MAX_QUERY_WORDS = 64               # cap the O(n*m) alignment DP (see quran_index)
SAVE_UPLOADS = os.environ.get("QURAN_SAVE_UPLOADS")  # dir to capture a real-voice eval set

state: dict = {}


def _save_upload(audio: np.ndarray, text: str, cands: list[dict]) -> None:
    """Persist the decoded clip + ASR/match result for offline model benchmarking."""
    try:
        import datetime
        import json
        d = Path(SAVE_UPLOADS)
        d.mkdir(parents=True, exist_ok=True)
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        save_wav(str(d / f"{stamp}.wav"), audio)
        top = cands[0] if cands else {}
        with open(d / "log.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps({"file": f"{stamp}.wav", "text": text,
                                "top": top.get("verse_keys"), "score": top.get("score")},
                               ensure_ascii=False) + "\n")
    except Exception as exc:  # capture must never break the request
        log.warning("save upload failed: %s", exc)


def _check_sr(sr: int) -> int:
    if not (MIN_SR <= sr <= MAX_SR):
        raise HTTPException(400, f"sample_rate must be in [{MIN_SR}, {MAX_SR}]")
    return sr


@asynccontextmanager
async def lifespan(_: FastAPI):
    state["index"] = QuranIndex(DB_PATH)
    if os.environ.get("QURAN_NO_ASR") != "1":
        state["asr"] = await asyncio.to_thread(QuranASR)
        # Warm-up so the first user request is not slow.
        await asyncio.to_thread(state["asr"].transcribe, np.zeros(SAMPLE_RATE, dtype=np.float32))
    yield
    state.clear()


app = FastAPI(title="Quran Recitation Server", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _asr() -> QuranASR:
    asr = state.get("asr")
    if asr is None:
        raise HTTPException(503, "ASR disabled (QURAN_NO_ASR=1)")
    return asr


def _candidates(words: list[str], top_k: int) -> list[dict]:
    index: QuranIndex = state["index"]
    words = words[:MAX_QUERY_WORDS]          # bound the alignment DP
    top_k = max(1, min(int(top_k), 20))
    return [
        {"start": c.start, "end": c.end, "score": round(c.score, 3), "verse_keys": c.verse_keys,
         "page": index.page[c.start], "start_word_id": index.word_id[c.start],
         "end_word_id": index.word_id[c.end]}
        for c in index.search(words, top_k=top_k)
    ]


@app.get("/api/health")
def health():
    asr = state.get("asr")
    return {"ok": True, "words": state["index"].size,
            "model": asr.model_name if asr else None, "device": asr.device if asr else None}


class TextQuery(BaseModel):
    text: str = Field(max_length=4000)
    top_k: int = Field(default=5, ge=1, le=20)


@app.post("/api/search/text")
def search_text(q: TextQuery):
    words = normalize_words(q.text)
    return {"query": " ".join(words), "candidates": _candidates(words, q.top_k)}


@app.post("/api/search/audio")
async def search_audio(request: Request, top_k: int = 5, sample_rate: int = SAMPLE_RATE):
    """Body: an audio file (wav/flac/mp3/ogg) or raw PCM16 mono (Content-Type: audio/pcm)."""
    body = await request.body()
    if not body:
        raise HTTPException(400, "empty body")
    if len(body) > MAX_BODY_BYTES:
        raise HTTPException(413, f"body exceeds {MAX_BODY_BYTES} bytes")
    if request.headers.get("content-type", "").startswith("audio/pcm"):
        _check_sr(sample_rate)
        raw = pcm16_to_float(body)[: MAX_UPLOAD_S * sample_rate]  # truncate before resample
        audio = resample(raw, sample_rate)
    else:
        # PyAV (bundled ffmpeg) decodes any container the phone produces — notably
        # AAC/m4a from Android/iOS recording — straight to mono 16 kHz, capping the
        # decoded length internally so a compressed "bomb" can't exhaust memory.
        try:
            audio = await asyncio.to_thread(decode_audio_bytes, body, MAX_UPLOAD_S)
        except Exception as exc:
            raise HTTPException(415, f"unsupported audio: {exc}") from exc
    audio = audio[: MAX_UPLOAD_S * SAMPLE_RATE]
    text, latency = await asyncio.to_thread(_asr().transcribe, audio)
    words = normalize_words(text)
    cands = _candidates(words, top_k)
    # Opt-in capture for building a real-voice eval set (QURAN_SAVE_UPLOADS=<dir>).
    if SAVE_UPLOADS:
        _save_upload(audio, text, cands)
    return {"text": text, "latency": round(latency, 3), "candidates": cands}


@app.websocket("/ws/recite")
async def ws_recite(ws: WebSocket):
    await ws.accept()
    asr = state.get("asr")
    if asr is None:
        await ws.send_json({"type": "error", "message": "ASR disabled"})
        await ws.close()
        return
    session: StreamingSession | None = None
    sample_rate = SAMPLE_RATE
    busy = False

    async def run_step():
        nonlocal busy
        busy = True
        try:
            events = await asyncio.to_thread(session.step)
            for ev in events:
                await ws.send_json(ev)
        finally:
            busy = False

    task: asyncio.Task | None = None
    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("text") is not None:
                cmd = json.loads(msg["text"])
                kind = cmd.get("type")
                if kind == "start":
                    sr = int(cmd.get("sample_rate", SAMPLE_RATE))
                    if not (MIN_SR <= sr <= MAX_SR):
                        await ws.send_json({"type": "error", "message": f"sample_rate must be in [{MIN_SR}, {MAX_SR}]"})
                        continue
                    sample_rate = sr
                    session = StreamingSession(asr, state["index"], cmd.get("start_gidx"))
                    await ws.send_json({"type": "ready", "model": asr.model_name, "device": asr.device})
                elif kind == "lock" and session:
                    await ws.send_json(session.lock(int(cmd["gidx"])))
                elif kind == "reset" and session:
                    session.reset()
                    await ws.send_json({"type": "search", "candidates": []})
                elif kind == "stop":
                    break
            elif msg.get("bytes") is not None and session is not None:
                frame = msg["bytes"][:MAX_WS_FRAME_BYTES]
                audio = pcm16_to_float(frame)
                if sample_rate != SAMPLE_RATE:
                    audio = resample(audio, sample_rate)
                session.add_audio(audio)
                # Recognition runs in a worker thread; while it runs, audio keeps
                # buffering and the next step covers everything that arrived.
                if session.ready() and not busy:
                    task = asyncio.create_task(run_step())
    except WebSocketDisconnect:
        pass
    finally:
        if task:
            try:
                await task
            except Exception:  # connection already gone
                pass
