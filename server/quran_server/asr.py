"""Quran speech recognition (Tarteel's Quran-tuned Whisper, Apache-2.0)."""
from __future__ import annotations

import io
import os
import threading
import time
from math import gcd

import av
import ctranslate2
import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel
from scipy.signal import resample_poly

SAMPLE_RATE = 16_000
# faster-whisper (CTranslate2) runs base fast enough on CPU (int8) that there's no
# reason to drop to tiny; on a GPU it loads in float16. Override with QURAN_ASR_MODEL.
DEFAULT_MODEL = os.environ.get("QURAN_ASR_MODEL", "tarteel-ai/whisper-base-ar-quran")


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


def _ensure_ct2(model_name: str, quant: str) -> str:
    """Return a CTranslate2 model dir for `model_name`, converting from the HF
    checkpoint on first use. Cached under QURAN_CT2_DIR (or HF_HOME/ct2) so it
    survives restarts; conversion needs torch+transformers but inference doesn't."""
    from pathlib import Path
    # Prefer an explicit dir, then the HF cache (a private volume in Docker); fall
    # back to a user-private cache — never a world-writable /tmp path an attacker
    # could pre-seed with a poisoned model.
    if os.environ.get("QURAN_CT2_DIR"):
        base = Path(os.environ["QURAN_CT2_DIR"])
    elif os.environ.get("HF_HOME"):
        base = Path(os.environ["HF_HOME"]) / "ct2"
    else:
        base = Path.home() / ".cache" / "quran_server" / "ct2"
    base.mkdir(parents=True, exist_ok=True)
    try:
        base.chmod(0o700)
    except OSError:
        pass
    out = base / (model_name.replace("/", "__").strip("./") + "-" + quant)
    if (out / "model.bin").exists():
        return str(out)
    out.mkdir(parents=True, exist_ok=True)
    from ctranslate2.converters import TransformersConverter
    from transformers import WhisperProcessor
    TransformersConverter(model_name, copy_files=["preprocessor_config.json"]).convert(
        str(out), quantization=quant, force=True)
    if not (out / "tokenizer.json").exists():  # faster-whisper needs the fast tokenizer
        WhisperProcessor.from_pretrained(model_name).tokenizer.save_pretrained(str(out))
    return str(out)


class QuranASR:
    def __init__(self, model_name: str | None = None, device: str | None = None):
        model_name = model_name or DEFAULT_MODEL
        has_cuda = ctranslate2.get_cuda_device_count() > 0
        self.device = device or ("cuda" if has_cuda else "cpu")
        compute_type = "float16" if self.device == "cuda" else "int8"
        ct2_dir = _ensure_ct2(model_name, compute_type)
        self.model = WhisperModel(ct2_dir, device=self.device, compute_type=compute_type,
                                  cpu_threads=os.cpu_count() or 4)
        self.model_name = model_name
        self.default_beams = int(os.environ.get("QURAN_ASR_BEAMS", "1"))
        self._lock = threading.Lock()  # one inference at a time

    def transcribe(self, audio: np.ndarray, prompt: str | None = None,
                   num_beams: int | None = None) -> tuple[str, float]:
        """Return (text, seconds taken). `audio` is mono float32 16 kHz, ≤ 30 s."""
        t0 = time.perf_counter()
        beams = self.default_beams if num_beams is None else num_beams
        with self._lock:
            segments, _ = self.model.transcribe(
                audio, language="ar", task="transcribe", beam_size=max(1, beams),
                without_timestamps=True, condition_on_previous_text=False,
                vad_filter=False, initial_prompt=prompt or None)
            text = "".join(s.text for s in segments)
        return text.strip(), time.perf_counter() - t0
