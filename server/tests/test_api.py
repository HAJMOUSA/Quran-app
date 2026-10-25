import os
from pathlib import Path

import pytest

os.environ["QURAN_NO_ASR"] = "1"
DB = Path(__file__).resolve().parents[2] / "data" / "quran.db"


@pytest.fixture(scope="module")
def client():
    if not DB.exists():
        pytest.skip("data/quran.db missing")
    from fastapi.testclient import TestClient

    from quran_server.app import app

    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/api/health").json()
    assert r["ok"] and r["words"] == 77429 and r["model"] is None


def test_search_text(client):
    r = client.post("/api/search/text", json={"text": "قُلْ هُوَ اللَّهُ أَحَدٌ"}).json()
    assert r["candidates"][0]["verse_keys"] == ["112:1"]
    assert r["candidates"][0]["page"] == 604


def test_search_audio_without_asr_is_503(client):
    r = client.post("/api/search/audio", content=b"\x00\x00" * 100, headers={"content-type": "audio/pcm"})
    assert r.status_code == 503


def test_search_audio_rejects_bad_sample_rate(client):
    # Validation happens before ASR, so this is 400 even with ASR disabled.
    r = client.post("/api/search/audio?sample_rate=1000000",
                    content=b"\x00\x00" * 100, headers={"content-type": "audio/pcm"})
    assert r.status_code == 400


def test_search_audio_rejects_oversized_body(client):
    r = client.post("/api/search/audio", content=b"\x00" * (12 * 1024 * 1024 + 1),
                    headers={"content-type": "audio/pcm"})
    assert r.status_code == 413


def test_search_text_clamps_top_k(client):
    r = client.post("/api/search/text", json={"text": "الله", "top_k": 999})
    assert r.status_code == 422  # pydantic rejects top_k > 20
