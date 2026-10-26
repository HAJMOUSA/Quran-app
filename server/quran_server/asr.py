"""Quran speech recognition (Tarteel's Quran-tuned Whisper, Apache-2.0)."""
from __future__ import annotations

import io
import os
import threading
import time
from math import gcd

import av
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


# Containers we accept from uploads. The format_whitelist stops ffmpeg from
# selecting a demuxer like hls/concat that can reference external files/URLs
# (SSRF), and protocol_whitelist="" blocks all external IO — the body is already
# fully in memory, so no protocol access is ever legitimately needed.
_FORMAT_WHITELIST = "mov,mp4,m4a,3gp,3g2,mj2,wav,ogg,mp3,aac,flac,matroska,webm"
_ALLOWED_DEMUXERS = {"mov,mp4,m4a,3gp,3g2,mj2", "wav", "ogg", "mp3", "aac", "flac", "matroska,webm"}
DECODE_MIN_SR, DECODE_MAX_SR = 8_000, 48_000  # accepted input rates (phone mics are ≤48 kHz)
DECODE_MAX_CHANNELS = 8


def decode_audio_bytes(data: bytes, max_seconds: int = 30) -> np.ndarray:
    """Decode compressed audio (m4a/aac/mp3/ogg/opus/wav) → mono float32 16 kHz.

    Uses PyAV (bundled ffmpeg) so phone recordings (AAC/m4a) are accepted. Decoding
    stops after `max_seconds` so a crafted/looping file can't exhaust memory, and
    the demuxer/protocol are whitelisted to prevent SSRF via playlist/concat inputs.
    Input rate and channel count are bounded before resampling so a crafted header
    can't inflate intermediate buffers.
    """
    max_samples = max_seconds * SAMPLE_RATE
    chunks: list[np.ndarray] = []
    total = 0
    with av.open(io.BytesIO(data),
                 options={"format_whitelist": _FORMAT_WHITELIST, "protocol_whitelist": ""}) as container:
        if container.format.name not in _ALLOWED_DEMUXERS:
            raise ValueError(f"unsupported container: {container.format.name}")
        if not container.streams.audio:
            raise ValueError("no audio stream")
        stream = container.streams.audio[0]
        cc = stream.codec_context
        if cc.sample_rate and not (DECODE_MIN_SR <= cc.sample_rate <= DECODE_MAX_SR):
            raise ValueError(f"unsupported sample rate: {cc.sample_rate}")
        if cc.channels and cc.channels > DECODE_MAX_CHANNELS:
            raise ValueError(f"too many channels: {cc.channels}")
        resampler = av.AudioResampler(format="flt", layout="mono", rate=SAMPLE_RATE)
        for frame in container.decode(stream):
            # Rate/channels can change mid-stream; re-validate before resampling.
            if frame.sample_rate and not (DECODE_MIN_SR <= frame.sample_rate <= DECODE_MAX_SR):
                raise ValueError(f"unsupported sample rate: {frame.sample_rate}")
            if len(frame.layout.channels) > DECODE_MAX_CHANNELS:
                raise ValueError("too many channels")
            for rframe in resampler.resample(frame):
                arr = rframe.to_ndarray().reshape(-1)
                chunks.append(arr)
                total += arr.shape[0]
            if total >= max_samples:
                break
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks)[:max_samples].astype(np.float32)


def rms_dbfs(audio: np.ndarray) -> float:
    if audio.size == 0:
        return -120.0
    rms = float(np.sqrt(np.mean(np.square(audio))))
    return 20 * np.log10(max(rms, 1e-6))


def peak_normalize(audio: np.ndarray, target: float = 0.97) -> np.ndarray:
    """Scale so the loudest sample hits `target`. Helps quiet/distant recordings."""
    if audio.size == 0:
        return audio
    peak = float(np.max(np.abs(audio)))
    return (audio * (target / peak)).astype(np.float32) if peak > 1e-5 else audio


def trim_silence(audio: np.ndarray, frame: int = 512, thresh_db: float = -40.0) -> np.ndarray:
    """Drop leading/trailing near-silence (relative to the clip's own peak)."""
    if audio.size < frame * 2:
        return audio
    n = (len(audio) // frame) * frame
    frames = audio[:n].reshape(-1, frame)
    energy = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)
    keep = energy > (np.max(energy) * (10 ** (thresh_db / 20)))
    if not keep.any():
        return audio
    idx = np.where(keep)[0]
    return audio[idx[0] * frame: (idx[-1] + 1) * frame]


def preprocess_for_asr(audio: np.ndarray) -> np.ndarray:
    """Clip clean-up before recognition: trim silence, then normalize level."""
    return peak_normalize(trim_silence(audio))


def save_wav(path: str, audio: np.ndarray) -> None:
    """Write mono 16 kHz PCM16 — the exact signal the model saw — for eval sets."""
    sf.write(path, audio, SAMPLE_RATE, subtype="PCM_16")


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
        self.default_beams = int(os.environ.get("QURAN_ASR_BEAMS", "1"))
        self._lock = threading.Lock()  # one GPU/CPU inference at a time

    def transcribe(self, audio: np.ndarray, prompt: str | None = None,
                   num_beams: int | None = None) -> tuple[str, float]:
        """Return (text, seconds taken). `audio` is mono float32 16 kHz, ≤ 30 s."""
        t0 = time.perf_counter()
        feats = self.processor(audio, sampling_rate=SAMPLE_RATE, return_tensors="pt").input_features
        feats = feats.to(self.device, self.dtype)
        beams = self.default_beams if num_beams is None else num_beams
        kwargs: dict = {"language": "ar", "task": "transcribe"}
        if beams > 1:
            kwargs["num_beams"] = beams
        if prompt:
            kwargs["prompt_ids"] = torch.tensor(self.processor.get_prompt_ids(prompt), device=self.device)
        with self._lock, torch.inference_mode():
            ids = self.model.generate(feats, **kwargs)
        text = self.processor.batch_decode(ids, skip_special_tokens=True)[0]
        if prompt and text.strip().startswith(prompt.strip()):
            text = text.strip()[len(prompt.strip()):]
        return text.strip(), time.perf_counter() - t0
