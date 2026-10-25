"""Quran speech recognition (Tarteel's Quran-tuned Whisper, Apache-2.0)."""
from __future__ import annotations

import os
import threading
import time
from math import gcd

import numpy as np
import soundfile as sf
import torch
from scipy.signal import resample_poly
from transformers import GenerationConfig, WhisperForConditionalGeneration, WhisperProcessor

SAMPLE_RATE = 16_000
# base is more accurate; tiny is ~3.5x faster and is the default without a GPU.
DEFAULT_MODEL = os.environ.get(
    "QURAN_ASR_MODEL",
    "tarteel-ai/whisper-base-ar-quran" if torch.cuda.is_available() else "tarteel-ai/whisper-tiny-ar-quran",
)


def load_audio(path: str, start_s: float = 0.0, end_s: float | None = None) -> np.ndarray:
    """Read any soundfile-supported file (wav/flac/mp3/ogg) → mono float32 16 kHz."""
    data, sr = sf.read(path, dtype="float32", always_2d=True)
    data = data.mean(axis=1)
    a = int(start_s * sr)
    b = int(end_s * sr) if end_s is not None else len(data)
    return resample(data[a:b], sr)


def resample(data: np.ndarray, sr: int) -> np.ndarray:
    if sr == SAMPLE_RATE:
        return data.astype(np.float32)
    g = gcd(sr, SAMPLE_RATE)
    return resample_poly(data, SAMPLE_RATE // g, sr // g).astype(np.float32)


def pcm16_to_float(buf: bytes) -> np.ndarray:
    return np.frombuffer(buf, dtype="<i2").astype(np.float32) / 32768.0


def rms_dbfs(audio: np.ndarray) -> float:
    if audio.size == 0:
        return -120.0
    rms = float(np.sqrt(np.mean(np.square(audio))))
    return 20 * np.log10(max(rms, 1e-6))


class QuranASR:
    def __init__(self, model_name: str | None = None, device: str | None = None):
        model_name = model_name or DEFAULT_MODEL
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.dtype = torch.float16 if self.device == "cuda" else torch.float32
        self.processor = WhisperProcessor.from_pretrained(model_name)
        self.model = WhisperForConditionalGeneration.from_pretrained(model_name, torch_dtype=self.dtype)
        if not hasattr(self.model.generation_config, "lang_to_id"):
            # Tarteel checkpoints predate the multilingual generation config; borrow it
            # from the matching OpenAI base model so language/task can be forced.
            size = next((s for s in ("tiny", "base", "small", "medium") if s in model_name), "base")
            self.model.generation_config = GenerationConfig.from_pretrained(f"openai/whisper-{size}")
        self.model.to(self.device).eval()
        self.model_name = model_name
        self._lock = threading.Lock()  # one GPU/CPU inference at a time

    def transcribe(self, audio: np.ndarray, prompt: str | None = None) -> tuple[str, float]:
        """Return (text, seconds taken). `audio` is mono float32 16 kHz, ≤ 30 s."""
        t0 = time.perf_counter()
        feats = self.processor(audio, sampling_rate=SAMPLE_RATE, return_tensors="pt").input_features
        feats = feats.to(self.device, self.dtype)
        kwargs: dict = {"language": "ar", "task": "transcribe"}
        if prompt:
            kwargs["prompt_ids"] = torch.tensor(self.processor.get_prompt_ids(prompt), device=self.device)
        with self._lock, torch.inference_mode():
            ids = self.model.generate(feats, **kwargs)
        text = self.processor.batch_decode(ids, skip_special_tokens=True)[0]
        if prompt and text.strip().startswith(prompt.strip()):
            text = text.strip()[len(prompt.strip()):]
        return text.strip(), time.perf_counter() - t0
