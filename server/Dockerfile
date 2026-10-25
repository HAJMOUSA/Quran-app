# CPU image by default. For an NVIDIA GPU host:
#   docker compose build --build-arg TORCH_INDEX=https://download.pytorch.org/whl/cu128
FROM python:3.11-slim
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
ENV PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8 HF_HOME=/cache/hf QURAN_DB=/data/quran.db
WORKDIR /app/server
RUN pip install --no-cache-dir torch --index-url ${TORCH_INDEX}
COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server/ .
EXPOSE 8000
# Build quran.db on first start if the data volume is empty.
CMD ["sh", "-c", "[ -f \"$QURAN_DB\" ] || python scripts/build_quran_db.py --out \"$QURAN_DB\"; exec uvicorn quran_server.app:app --host 0.0.0.0 --port 8000"]
