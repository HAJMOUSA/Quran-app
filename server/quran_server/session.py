"""Streaming recitation session: PCM in → rolling-window Whisper → Tracker events out."""
from __future__ import annotations

import os

import numpy as np

from .asr import SAMPLE_RATE, QuranASR, rms_dbfs
from .normalize import normalize_words
from .quran_index import QuranIndex
from .tracker import Tracker

HOP_S = 1.0          # run recognition after this much new audio
WINDOW_S = 6.0       # recognize at most the trailing window (shorter = fresher)
VAD_DBFS = float(os.environ.get("QURAN_VAD_DBFS", "-45"))  # quieter windows = silence
SILENCE_RESET_S = 2.0  # this much trailing silence drops buffered audio


class StreamingSession:
    def __init__(self, asr: QuranASR, index: QuranIndex, start_gidx: int | None = None,
                 hop_s: float = HOP_S, window_s: float = WINDOW_S, vad_dbfs: float = VAD_DBFS):
        self.asr = asr
        self.index = index
        self.tracker = Tracker(index, start_gidx)
        self.hop = int(hop_s * SAMPLE_RATE)
        self.window = int(window_s * SAMPLE_RATE)
        self.vad_dbfs = vad_dbfs
        self.buffer = np.zeros(0, dtype=np.float32)
        self.pending = 0          # samples received since last recognition
        self.total = 0            # samples received in total

    def add_audio(self, audio: np.ndarray) -> None:
        self.buffer = np.concatenate([self.buffer, audio])[-self.window:]
        self.pending += len(audio)
        self.total += len(audio)

    def ready(self) -> bool:
        return self.pending >= self.hop

    def step(self) -> list[dict]:
        """Recognize the trailing window if enough new audio arrived. Blocking."""
        if not self.ready():
            return []
        self.pending = 0
        events: list[dict] = []
        tail = self.buffer[-int(SILENCE_RESET_S * SAMPLE_RATE):]
        if len(tail) >= int(SILENCE_RESET_S * SAMPLE_RATE) and rms_dbfs(tail) < self.vad_dbfs:
            # Reciter paused: forget old audio so it is not re-recognized forever.
            self.buffer = np.zeros(0, dtype=np.float32)
            return [{"type": "silence", "t": self.total / SAMPLE_RATE}]
        if rms_dbfs(self.buffer) < self.vad_dbfs or len(self.buffer) < SAMPLE_RATE // 2:
            return []
        text, latency = self.asr.transcribe(self.buffer)
        words = normalize_words(text)
        events.append({"type": "transcript", "text": text, "latency": round(latency, 3),
                       "t": round(self.total / SAMPLE_RATE, 2)})
        ev = self.tracker.update(words)
        events.append(ev)
        return events

    def lock(self, gidx: int) -> dict:
        self.tracker.lock(gidx)
        return self.tracker._event(changed=[])

    def reset(self) -> None:
        self.tracker.reset()
        self.buffer = np.zeros(0, dtype=np.float32)
        self.pending = 0
