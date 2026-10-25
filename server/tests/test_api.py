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
