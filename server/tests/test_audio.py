"""Decoding of compressed uploads, notably AAC/m4a as recorded by phones."""
import io

import av
import numpy as np

from quran_server.asr import SAMPLE_RATE, decode_audio_bytes


def _encode_m4a(tone: np.ndarray, sr: int) -> bytes:
    buf = io.BytesIO()
    buf.name = "x.m4a"
    with av.open(buf, "w", format="mp4") as c:
        st = c.add_stream("aac", rate=sr)
        st.layout = "mono"
        frame = av.AudioFrame.from_ndarray(tone.reshape(1, -1), format="flt", layout="mono")
        frame.rate = sr
        for p in st.encode(frame):
            c.mux(p)
        for p in st.encode():
            c.mux(p)
    return buf.getvalue()


def test_decode_m4a_to_mono_16k():
    sr = 44100
    t = np.linspace(0, 2, 2 * sr, endpoint=False)
    tone = (0.2 * np.sin(2 * np.pi * 220 * t)).astype("float32")
    audio = decode_audio_bytes(_encode_m4a(tone, sr))
    assert audio.dtype == np.float32
    assert abs(len(audio) - 2 * SAMPLE_RATE) < SAMPLE_RATE // 2  # ~2 s at 16 kHz


def test_decode_caps_length():
    sr = 16000
    tone = np.zeros(10 * sr, dtype="float32")  # 10 s
    audio = decode_audio_bytes(_encode_m4a(tone, sr), max_seconds=3)
    assert len(audio) <= 3 * SAMPLE_RATE


def test_decode_rejects_non_audio():
    import pytest
    with pytest.raises(Exception):
        decode_audio_bytes(b"not audio at all")


def test_decode_rejects_extreme_sample_rate():
    # A file declaring a very high input rate is rejected before resampling, so a
    # crafted header can't inflate intermediate buffers.
    import pytest
    sr = 96000
    tone = np.zeros(sr, dtype="float32")
    with pytest.raises(Exception):
        decode_audio_bytes(_encode_m4a(tone, sr))


def test_decode_rejects_playlist_ssrf_vector():
    # An HLS playlist referencing a remote URL must not be demuxed (SSRF guard):
    # the format whitelist excludes hls/concat so ffmpeg won't fetch the URL.
    import pytest
    m3u8 = b"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttp://169.254.169.254/latest/meta-data\n"
    with pytest.raises(Exception):
        decode_audio_bytes(m3u8)
