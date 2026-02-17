# ChatICU 2026

[![CI](https://github.com/ZymoMed/ChatICU_YU/actions/workflows/ci.yml/badge.svg)](https://github.com/ZymoMed/ChatICU_YU/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/Python-3.12-3776AB)
![Node](https://img.shields.io/badge/Node.js-20-5FA04E)

ChatICU is a production-oriented ICU clinical collaboration platform with a React frontend and a FastAPI backend. It supports bedside workflows, medication and monitoring APIs, auditability, and evidence-aware AI features.

## Highlights

- ICU patient timeline and care-team workflows
- Medication APIs with administration-level persistence
- Data freshness and evidence-confidence gating for AI responses
- Request/trace ID propagation for cross-layer debugging
- Contract, integration, and E2E quality gates in CI

## Repository Structure

- `src/`: frontend (Vite + React + TypeScript)
- `backend/app/`: FastAPI application, routers, services, schemas, models
- `backend/alembic/`: DB migrations
- `backend/seeds/`: seed and datamock validation pipeline
- `datamock/`: offline dataset and deterministic seed inputs
- `e2e/`: Playwright end-to-end tests
- `docs/operations/`: operational runbooks

## Quick Start

### Prerequisites

- Node.js 20+
- Python 3.12
- PostgreSQL 16+ (for DB mode)
- Redis 7+

### 1) Backend

```bash
cd backend
cp .env.example .env
```

Set required values in `backend/.env` (at minimum: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`).

```bash
cd backend
./.venv312/bin/python -m alembic upgrade head
SEED_PASSWORD_STRATEGY=username ./.venv312/bin/python -m seeds.seed_if_empty
./.venv312/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### 2) Frontend

```bash
npm ci
VITE_API_URL=http://127.0.0.1:8000 npm run dev -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173`.

## Docker (Safe Defaults)

Default runtime is `DATA_SOURCE_MODE=db`:

```bash
cd backend
docker compose -p chaticu up --build
```

Offline JSON mode is explicit opt-in:

```bash
cd backend
docker compose -p chaticu-offline -f docker-compose.yml -f docker-compose.offline.yml up --build
```

## Quality Gates

```bash
# Frontend
npm run typecheck
npm run build

# Backend
cd backend
./.venv312/bin/pytest tests/test_api -q

# Datamock validation
cd backend
./.venv312/bin/python -m seeds.validate_datamock
```

## Security and Operations

- Security policy: `SECURITY.md`
- Offline JSON runbook: `docs/operations/json-offline-dev-runbook.md`
- CI workflow: `.github/workflows/ci.yml`

## Contributing

Please read `CONTRIBUTING.md` before opening a pull request.

## Project Status

Active development. Current engineering tracking artifacts are under `reports/`.
