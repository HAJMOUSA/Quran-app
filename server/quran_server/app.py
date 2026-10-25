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
import io
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .asr import SAMPLE_RATE, QuranASR, pcm16_to_float, resample
from .normalize import normalize_words
from .quran_index import QuranIndex
from .session import StreamingSession

log = logging.getLogger("quran_server")
DB_PATH = Path(os.environ.get("QURAN_DB", Path(__file__).resolve().parents[2] / "data" / "quran.db"))
MAX_UPLOAD_S = 30

state: dict = {}


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
    text: str
    top_k: int = 5


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
    if request.headers.get("content-type", "").startswith("audio/pcm"):
        audio = resample(pcm16_to_float(body), sample_rate)
    else:
        try:
            data, sr = sf.read(io.BytesIO(body), dtype="float32", always_2d=True)
        except Exception as exc:  # soundfile raises a generic RuntimeError subclass
            raise HTTPException(415, f"unsupported audio: {exc}") from exc
        audio = resample(data.mean(axis=1), sr)
    audio = audio[: MAX_UPLOAD_S * SAMPLE_RATE]
    text, latency = await asyncio.to_thread(_asr().transcribe, audio)
    words = normalize_words(text)
    return {"text": text, "latency": round(latency, 3), "candidates": _candidates(words, top_k)}


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
                    sample_rate = int(cmd.get("sample_rate", SAMPLE_RATE))
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
                audio = pcm16_to_float(msg["bytes"])
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
