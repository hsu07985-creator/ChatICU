# ── Stage 1: Builder ──────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Stage 2: Runtime ─────────────────────────────────────────────
FROM python:3.12-slim AS runtime

WORKDIR /code

# Copy only installed packages from builder
COPY --from=builder /install /usr/local

# Copy application code (no gcc, no build artifacts)
COPY app/ app/
COPY alembic/ alembic/
COPY alembic.ini .
COPY seeds/ seeds/

# Non-root user
RUN groupadd -r chaticu && useradd -r -g chaticu chaticu
USER chaticu

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=300s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["sh", "-c", "alembic upgrade head || echo 'WARN: migration failed, starting anyway'; uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
