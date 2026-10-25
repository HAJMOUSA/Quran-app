# Quran Reader & Reciter

Free, personal (non-commercial) iOS/Android app to **read**, **listen**, **memorize**
and **recite** the Quran, with AI follow-along that listens to your recitation and
highlights where you are on the Mushaf page (inspired by Tarteel).

```
quran-app/
  docs/DESIGN.md          architecture, data sources, algorithms, phases
  server/                 Python FastAPI: Quran index, Whisper ASR, live tracker
  mobile/                 React Native (Expo, TypeScript) app
  data/                   generated: quran.db, audio cache (git-ignored)
  docker-compose.yml      deploy the server on a Linux host
```

## 1. Build the Quran database (once)

```bash
cd server
python -m venv .venv
.venv/Scripts/pip install torch --index-url https://download.pytorch.org/whl/cu128   # GPU (or /whl/cpu)
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python scripts/build_quran_db.py        # → data/quran.db (6236 ayat, 77429 words)
```

On Linux/macOS use `.venv/bin/` instead of `.venv/Scripts/`.

## 2. Run the server

### Development (this Windows PC, RTX GPU)

```bash
cd server
.venv/Scripts/python -m uvicorn quran_server.app:app --host 0.0.0.0 --port 8000
```

- Model: `tarteel-ai/whisper-base-ar-quran` on GPU, `whisper-tiny-ar-quran` on CPU
  (override with `QURAN_ASR_MODEL`).
- Allow inbound TCP 8000 in Windows Firewall so the phone can connect over Wi-Fi.
- Check: `curl http://localhost:8000/api/health`

### Always-on (Linux server, Docker)

```bash
git clone <repo> quran-app && cd quran-app
docker compose up -d --build          # CPU + tiny model; builds data/quran.db on first start
docker compose logs -f
```

NVIDIA GPU host: build with `--build-arg TORCH_INDEX=https://download.pytorch.org/whl/cu128`,
uncomment the `deploy:` block in `docker-compose.yml` and set
`QURAN_ASR_MODEL=tarteel-ai/whisper-base-ar-quran`.

### Reaching the server from the phone

Recommended: **Tailscale** on the phone + server; in the app's Settings set
`http://<server-name>.<tailnet>.ts.net:8000`. Nothing is exposed to the internet.
For public access put Caddy/nginx with HTTPS in front (iOS requires TLS outside
local/VPN networks).

## 3. Server API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | model, device, word count |
| `POST /api/search/text` `{"text": "..."}` | text → matching ayat |
| `POST /api/search/audio` (wav/mp3/flac body, or `audio/pcm` PCM16 16 kHz) | recite-to-search |
| `WS /ws/recite` | live follow-along (protocol in `server/quran_server/app.py`) |

## 4. Evaluation (Phase 0 results, 2026-10-24, RTX 4070, base model)

```bash
.venv/Scripts/python scripts/eval_search.py --n 120 [--noise-snr 10]
.venv/Scripts/python scripts/eval_tracking.py --surah 67
.venv/Scripts/python scripts/ws_client.py ../data/audio/qdc/7/067.mp3   # against a running server
```

| Test | Result |
|---|---|
| Recite-to-search, 3–8 s clips, 6 reciters | top-1 82.5 %, **99.2 % counting identical-wording ties**, top-3 89 %, 0.32 s median |
| Same with white noise at 10 dB SNR | top-1 76.7 %, 95.0 % incl. ties |
| Live tracking, Al-Mulk (Alafasy, 240 s) | locked after 3 s, 98.7 % of updates within ±3 words, 0 false mistakes |
| Live tracking, Ya-Sin 13+ (another reciter, 180 s) | locked after 5 s, 98.1 % within ±3 words, 0 false mistakes |

Caveat: Tarteel's models were trained on these professional reciters; expect lower
accuracy on everyday voices — test with your own recordings.

## 5. Mobile app

See `mobile/README.md`.

## Credits & licences

- Quran text, word data, translations, audio timings: [Quran.com / Quran Foundation API](https://api.quran.com).
- Audio: [EveryAyah](https://everyayah.com), [QuranicAudio](https://quranicaudio.com).
- ASR: [Tarteel AI](https://huggingface.co/tarteel-ai) Quran Whisper models (Apache-2.0).
- Font: Amiri Quran (SIL OFL).
- The Quran text is used unmodified; mistake marks are learning hints, not rulings.
